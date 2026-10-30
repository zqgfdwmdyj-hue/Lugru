import "server-only";
import { todayIso } from "@/lib/dates";
import type { Session } from "@/lib/auth/session";
import { clip, isDay, isTime, rating, type DateIdea, type DiaryEntry, type MoodEntry, type ObservationEntry, type PartnerKey, type TalkEntry, type TaskEntry, type ThanksEntry } from "./logic";
import { compact, saveNaehe, saveTouches, type SaveResult } from "./save";
import { addEntry, kindAllowed, loadEntries, myPartner, privateMembers, privateSettings, updateEntry, type PrivateKind } from "./service";

// Privat-Einträge der übrigen Arten anlegen (für Claude: privat_eintrag_anlegen). Gleiche Regeln wie im
// Privatbereich: nur mit Privat-Zugang, Umfang „nur Familie“ darf diese Arten nicht, Tagebuch/Stimmung je Tag einmal.

export const ANLEGBARE_ARTEN = ["intim", "zuwendung", "tagebuch", "beobachtung", "gespraech", "danke", "stimmung", "dateidee", "aufgabe"] as const;
export type AnlegbareArt = (typeof ANLEGBARE_ARTEN)[number];

export type EintragEingabe = { art: AnlegbareArt; tag?: string; uhrzeit?: string; person?: PartnerKey | "beide"; anPerson?: PartnerKey; text?: string; wert?: number; variante?: "streicheln" | "massage" };

const dmy = (d: string) => d.split("-").reverse().join(".");
const fail = (message: string): SaveResult => ({ ok: false, message });

export async function privatEintragAnlegen(session: Session, e: EintragEingabe): Promise<SaveResult> {
  if (!session.privateAccess) return fail("Kein Privat-Zugang.");
  if (!kindAllowed(session, e.art as PrivateKind)) return fail("Dafür reicht der Privat-Zugang nicht (Umfang „nur Familie“).");
  const heute = todayIso();
  const tag = e.tag && isDay(e.tag) ? e.tag : heute;
  const uhrzeit = e.uhrzeit && isTime(e.uhrzeit) ? e.uhrzeit : undefined;
  const text = clip(e.text ?? null, 2000);
  const s = await privateSettings(session.tenantId);
  const ich = myPartner(s, session);
  const fd = new FormData();
  const set = (k: string, v: string | number | undefined | null) => v !== undefined && v !== null && fd.set(k, String(v));

  switch (e.art) {
    case "intim": {
      set("day", tag);
      set("time", uhrzeit);
      set("initiative", e.person);
      set("closeness", e.wert);
      set("note", text?.slice(0, 500));
      return saveNaehe(session, fd);
    }
    case "zuwendung": {
      const kind = e.variante ?? "streicheln";
      const giver = e.person === "a" || e.person === "b" ? e.person : ich;
      if (!giver) return fail("Bitte angeben, wer gibt (person).");
      set("day", tag);
      set("time", uhrzeit);
      fd.set(`do-${kind}`, "on");
      set(`${kind}-giver`, giver);
      set("minutes", e.wert);
      set("note", text?.slice(0, 300));
      if (tag <= heute) set("status", tag < heute ? "stattgefunden" : undefined);
      return saveTouches(session, fd);
    }
    case "tagebuch": {
      if (tag > heute) return fail("Bitte kein Datum in der Zukunft.");
      const mine = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).find((x) => x.userId === session.userId && x.data.day === tag);
      const note = [mine?.data.note, text].filter(Boolean).join("\n").slice(0, 2000) || undefined;
      const entry = compact({ ...(mine?.data ?? { day: tag }), day: tag, note, mood: rating(e.wert ?? null) ?? mine?.data.mood }) as DiaryEntry;
      if (mine) await updateEntry(session, mine.id, "tagebuch", entry, true);
      else await addEntry(session, "tagebuch", entry);
      return { ok: true, message: `Tagebuch für ${dmy(tag)} gespeichert.`, id: mine?.id, day: tag };
    }
    case "beobachtung": {
      if (!text) return fail("Bitte die Beobachtung als Text angeben.");
      const ziel = e.anPerson ?? (ich === "a" ? "b" : ich === "b" ? "a" : undefined);
      const userId = Object.entries(s.userPartner).find(([, k]) => k === ziel)?.[0];
      if (!userId || !(await privateMembers(session.tenantId)).some((m) => m.userId === userId)) return fail("Über wen? (an_person: Name, „a“ oder „b“ mit Privat-Zugang)");
      const id = await addEntry(session, "beobachtung", { day: tag, aboutUserId: userId, text } satisfies ObservationEntry);
      return { ok: true, message: "Beobachtung gespeichert.", id, day: tag };
    }
    case "gespraech": {
      const id = await addEntry(session, "gespraech", compact({ day: tag, topic: text?.slice(0, 500) } satisfies TalkEntry));
      return { ok: true, message: "Paar-Gespräch gespeichert.", id, day: tag };
    }
    case "danke": {
      if (!text) return fail("Was hast du geschätzt? (text)");
      const von = e.person === "a" || e.person === "b" ? e.person : ich;
      if (!von) return fail("Von wem? (person)");
      const id = await addEntry(session, "danke", { day: tag, from: von, text: text.slice(0, 300) } satisfies ThanksEntry);
      return { ok: true, message: "Danke gespeichert – kommt beim nächsten Paar-Gespräch mit.", id, day: tag };
    }
    case "stimmung": {
      const value = rating(e.wert ?? null);
      if (!value) return fail("Stimmung als wert 1 bis 5 angeben.");
      if (!ich) return fail("Dein Konto ist im Privatbereich noch keiner Person (a/b) zugeordnet.");
      const entry: MoodEntry = compact({ day: tag, person: ich, value, note: text?.slice(0, 300) });
      const mine = (await loadEntries<MoodEntry>(session, ["stimmung"])).find((x) => x.userId === session.userId && x.data.day === tag);
      if (mine) await updateEntry(session, mine.id, "stimmung", entry, true);
      const id = mine?.id ?? (await addEntry(session, "stimmung", entry));
      return { ok: true, message: `Stimmung ${value}/5 für ${dmy(tag)} gespeichert.`, id, day: tag };
    }
    case "dateidee": {
      if (!text) return fail("Bitte die Idee als Text angeben.");
      const id = await addEntry(session, "dateidee", { text: text.slice(0, 300), done: false } satisfies DateIdea);
      return { ok: true, message: "Date-Idee gespeichert.", id };
    }
    case "aufgabe": {
      if (!text) return fail("Bitte die Aufgabe als Text angeben.");
      const task: TaskEntry = compact({ title: text.slice(0, 300), source: "sonst", forWhom: e.person ?? "beide", repeat: "einmal", due: e.tag && isDay(e.tag) ? e.tag : undefined, done: false, checks: [] });
      const id = await addEntry(session, "aufgabe", task);
      return { ok: true, message: "Private Aufgabe angelegt.", id };
    }
  }
}
