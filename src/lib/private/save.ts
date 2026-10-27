import "server-only";
import { randomUUID } from "node:crypto";
import { todayIso } from "@/lib/dates";
import type { Session } from "@/lib/auth/session";
import { addDays, clip, defaultStatus, durationOf, isDay, isTime, num, rating, statusOf, statusProblem, type AppointmentEntry, type EntryStatus, type PartnerKey } from "./logic";
import { eventRefFrom, isoWeekday, parseOccurrence, periodProblem, ritualOccurrences, slotKey, type PeriodEntry, type RitualEntry, type RitualSlot, type TouchEntry, type TouchKind } from "./kalender";
import { addEntry, loadEntries, loadEntry, myPartner, privateMembers, privateSettings, updateEntry, type PrivateKind } from "./service";

// Speichern der Kalender-Einträge (Termine, Familienzeiten, Nähe, Streicheln/Massage, Periode, Abendritual).
// Die Aufrufer (Server Actions) holen die Sitzung über requirePrivate(); hier nur Prüfen und Schreiben.

export type SaveResult = { ok: boolean; message: string; id?: string; day?: string };
const fail = (message: string): SaveResult => ({ ok: false, message });

export const partnerOf = (v: unknown): PartnerKey | undefined => (v === "a" || v === "b" ? v : undefined);
const otherOf = (p: PartnerKey): PartnerKey => (p === "a" ? "b" : "a");
const time = (v: unknown) => (isTime(v) ? (v as string).padStart(5, "0") : undefined);
const dmy = (d: string) => d.split("-").reverse().join(".");
const hoursText = (h: number) => `${String(h).replace(".", ",")} Std.`;
/** Leere Felder weglassen, damit die Einträge klein bleiben. */
export const compact = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))) as T;
export const parseStatus = (v: unknown): EntryStatus | undefined => (v === "geplant" || v === "stattgefunden" || v === "ausgefallen" ? v : undefined);
/** Status aus dem Formular, sonst der bisherige, sonst nach Datum (Zukunft = geplant). */
const statusFrom = (fd: FormData, day: string, today: string, current?: unknown) => parseStatus(fd.get("status")) ?? parseStatus(current) ?? defaultStatus(day, today);
/** Ausdrücklich in den verbundenen Kalender – nur angehakt, nie automatisch. */
const externFrom = (fd: FormData) => (fd.get("extern") === "on" ? true : undefined);
const fromEventOf = (fd: FormData, cur?: unknown) => eventRefFrom(fd.get("fromEvent")) ?? eventRefFrom(cur);

// ---- Kinderzeit, Ausschlafen, Auszeit, Paarzeit ---------------------------------------------------------

export type TimeKind = "kinder" | "ausschlafen" | "auszeit" | "paarzeit";
export const TIME_KINDS: TimeKind[] = ["kinder", "ausschlafen", "auszeit", "paarzeit"];
const MAX_HOURS: Record<TimeKind, number> = { kinder: 16, ausschlafen: 12, auszeit: 16, paarzeit: 24 };
const WHO_MISSING: Record<Exclude<TimeKind, "paarzeit">, string> = { kinder: "Bitte wählen, wer mit den Kindern unterwegs war.", ausschlafen: "Bitte wählen, wer ausgeschlafen hat.", auszeit: "Bitte wählen, wer Auszeit hatte." };

/**
 * Anlegen oder (mit `id`) ändern. Kinderzeit ↔ Auszeit als ein Vorgang („wer übernimmt die Kinder?“) – nur
 * wenn ausdrücklich gewählt, nie automatisch. Datum, Zeit und Status gelten dann für beide Einträge; jede
 * Person zählt nur in ihrer eigenen Auswertung (Auszeit bzw. Kinderzeit), nie doppelt.
 */
export async function saveTimeEntry(session: Session, kind: TimeKind, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const editId = String(fd.get("id") ?? "") || null;
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
  const cur = editId ? (await loadEntries<Record<string, unknown>>(session, [kind])).find((e) => e.id === editId) : undefined;
  if (editId && !cur) return fail("Eintrag nicht gefunden.");
  const status = statusFrom(fd, day, today, cur?.data.status);
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  // Kinderzeit auch „beide zusammen“ (zählt nicht als „allein mit den Kindern“).
  const person = kind === "paarzeit" ? undefined : kind === "kinder" && fd.get("person") === "beide" ? ("beide" as const) : partnerOf(fd.get("person"));
  if (kind !== "paarzeit" && !person) return fail(WHO_MISSING[kind]);
  const from = time(fd.get("from"));
  const to = time(fd.get("to"));
  const hoursIn = num(fd.get("hours"), 0, 72);
  const dur = durationOf({ day, from, to, hours: hoursIn }, MAX_HOURS[kind]);
  if ("error" in dur) return fail(dur.error);
  const settings = await privateSettings(session.tenantId);
  const extern = externFrom(fd);
  const base = { day, from, to, hours: from && to ? undefined : dur.hours, status, extern, fromEvent: fromEventOf(fd, cur?.data.fromEvent) };
  // „Wer übernimmt in dieser Zeit die Kinder?“ (Auszeit) bzw. „Hatte … währenddessen Auszeit?“ (Kinderzeit)
  const kidsBy = String(fd.get("kidsBy") ?? "");
  const wantsLink = (kind === "auszeit" && (kidsBy === "partner" || fd.get("linkKinder") === "on")) || (kind === "kinder" && fd.get("linkAuszeit") === "on");
  const asked = fd.get("linkQuestion") === "1";
  const data =
    kind === "paarzeit"
      ? compact({ ...base, what: clip(fd.get("what"), 200), sitter: clip(fd.get("sitter"), 60), costEur: num(fd.get("costEur"), 0, 10000), rating: rating(fd.get("rating")), note: clip(fd.get("note"), 500) })
      : kind === "kinder"
        ? compact({ ...base, person, what: clip(fd.get("what"), 200), kids: fd.getAll("kids").map(String).filter((k) => settings.kids.includes(k)) })
        : compact({ ...base, person, note: clip(fd.get("note"), kind === "auszeit" ? 200 : 300), kidsBy: kind === "auszeit" && kidsBy === "andere" ? clip(fd.get("kidsByName"), 60) ?? "jemand anderes" : undefined });
  const other = person && person !== "beide" ? otherOf(person) : undefined;
  const linkKind: TimeKind | null = kind === "kinder" ? "auszeit" : kind === "auszeit" ? "kinder" : null;
  const what = `${dmy(day)}, ${hoursText(dur.hours)}${dur.overnight ? ", über Mitternacht" : ""}${dur.clockShift ? `, inkl. Zeitumstellung ${dur.clockShift > 0 ? "+" : "−"}${String(Math.abs(dur.clockShift)).replace(".", ",")} Std` : ""}${status !== "stattgefunden" ? ` (${status})` : ""}`;
  const linkedPatch = { day, from, to, hours: base.hours, status, editedAt: new Date().toISOString() };

  if (cur) {
    let linkId = typeof cur.data.linkId === "string" ? cur.data.linkId : undefined;
    let note = "";
    if (linkKind && linkId && asked && !wantsLink) {
      // Verknüpfung ausdrücklich gelöst: beide Einträge bleiben, nur nicht mehr verbunden (nichts wird gelöscht).
      for (const e of (await loadEntries<Record<string, unknown>>(session, [linkKind])).filter((x) => x.data.linkId === linkId)) {
        const { linkId: _drop, ...rest } = e.data;
        await updateEntry(session, e.id, linkKind, rest, true);
      }
      linkId = undefined;
      note = ` – Verknüpfung gelöst, der ${linkKind === "kinder" ? "Kinderzeit" : "Auszeit"}-Eintrag bleibt bestehen (bei Bedarf dort löschen)`;
    }
    if (linkKind && !linkId && wantsLink && other) {
      linkId = randomUUID();
      await addEntry(session, linkKind, compact({ day, person: other, from, to, hours: base.hours, status, linkId }));
      note = ` – zugleich ${linkKind === "auszeit" ? "Auszeit" : "Kinderzeit"} für ${settings.partners[other]} eingetragen`;
    } else if (linkKind && linkId) {
      let n = 0;
      for (const e of (await loadEntries<Record<string, unknown>>(session, [linkKind])).filter((x) => x.data.linkId === linkId)) {
        await updateEntry(session, e.id, linkKind, linkedPatch);
        n++;
      }
      if (n) note = " – verknüpfter Eintrag angepasst";
    }
    await updateEntry(session, cur.id, kind, { ...data, ...(linkId ? { linkId } : {}), editedAt: new Date().toISOString() }, true);
    return { ok: true, message: `Geändert: ${what}${note}.`, id: cur.id, day };
  }

  const linkId = linkKind && wantsLink && other ? randomUUID() : undefined;
  const id = await addEntry(session, kind, linkId ? { ...data, linkId } : data);
  if (linkKind && linkId && other) await addEntry(session, linkKind, compact({ day, person: other, from, to, hours: base.hours, status, linkId }));
  const label = kind === "paarzeit" ? "Paarzeit" : person === "beide" ? "Kinderzeit zusammen" : `${settings.partners[person!]}`;
  const linkText = linkId && other ? ` – zugleich ${linkKind === "auszeit" ? "Auszeit" : "Kinderzeit"} für ${settings.partners[other]} (zählt dort, nicht doppelt)` : "";
  return { ok: true, message: `Eingetragen: ${label} am ${what}${linkText}.`, id, day };
}

// ---- Termine --------------------------------------------------------------------------------------------

const WITH = ["ads", "paar", "arzt", "familie", "privat", "sonst"] as const;

export async function saveAppointment(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  if (!isDay(fd.get("day"))) return fail("Bitte ein Datum angeben.");
  const day = String(fd.get("day"));
  const editId = String(fd.get("id") ?? "") || null;
  const cur = editId ? (await loadEntries<AppointmentEntry>(session, ["termin"])).find((e) => e.id === editId) : undefined;
  if (editId && !cur) return fail("Eintrag nicht gefunden.");
  const status = statusFrom(fd, day, today, cur?.data.status);
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  const from = time(fd.get("time"));
  const to = time(fd.get("to"));
  if (to && !from) return fail("Bitte auch die Anfangszeit angeben.");
  if (from && to && to <= from) return fail("Das Ende liegt vor dem Beginn – bitte prüfen.");
  const w = String(fd.get("with") ?? "");
  const p = fd.get("person");
  const entry: AppointmentEntry = {
    day,
    time: from,
    to,
    with: (WITH as readonly string[]).includes(w) ? (w as AppointmentEntry["with"]) : "privat",
    title: clip(fd.get("title"), 120),
    person: p === "a" || p === "b" ? p : "beide",
    notes: clip(fd.get("notes"), 4000),
    status,
    extern: externFrom(fd),
    fromEvent: fromEventOf(fd, cur?.data.fromEvent),
  };
  if (!entry.title && (entry.with === "privat" || entry.with === "familie")) return fail("Bitte einen Titel angeben.");
  if (cur) {
    await updateEntry(session, cur.id, "termin", compact({ ...cur.data, ...entry }), true);
    return { ok: true, message: `Termin am ${dmy(day)} geändert.`, id: cur.id, day };
  }
  const id = await addEntry(session, "termin", compact(entry));
  return { ok: true, message: `Termin am ${dmy(day)} gespeichert.`, id, day };
}

// ---- Nähe -------------------------------------------------------------------------------------------------

export async function saveNaehe(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
  if (day > today) return fail("Nähe bitte erst eintragen, wenn sie stattgefunden hat.");
  const ini = fd.get("initiative");
  const data = compact({ day, time: time(fd.get("time")), initiative: ini === "a" || ini === "b" || ini === "beide" ? ini : undefined, closeness: rating(fd.get("closeness")), note: clip(fd.get("note"), 500) });
  const editId = String(fd.get("id") ?? "") || null;
  if (editId) {
    if (!(await updateEntry(session, editId, "intim", data, true))) return fail("Eintrag nicht gefunden.");
    return { ok: true, message: `Geändert: ${dmy(day)}.`, id: editId, day };
  }
  const id = await addEntry(session, "intim", data);
  return { ok: true, message: `Eingetragen für ${dmy(day)}.`, id, day };
}

// ---- Streicheln & Massage -------------------------------------------------------------------------------

const touchLabel = (k: TouchKind) => (k === "massage" ? "Massage" : "Streicheln");

/**
 * Neu: Streicheln und/oder Massage am selben Tag – je ein eigener Eintrag, damit beides getrennt bestätigt
 * werden kann. Ändern (mit `id`): genau dieser Eintrag; bei einem Vorkommen aus dem Abendritual heißt ein
 * anderer Tag „verschoben“ (das Vorkommen bleibt zugeordnet, die Serie ändert sich nicht).
 */
export async function saveTouches(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
  const editId = String(fd.get("id") ?? "") || null;
  const minutes = num(fd.get("minutes"), 1, 600);
  const note = clip(fd.get("note"), 300);
  if (editId) {
    const cur = (await loadEntries<TouchEntry>(session, ["zuwendung"])).find((e) => e.id === editId);
    if (!cur) return fail("Eintrag nicht gefunden.");
    const status = statusFrom(fd, day, today, cur.data.status);
    const problem = statusProblem(day, status, today);
    if (problem) return fail(problem);
    const giver = partnerOf(fd.get("giver")) ?? cur.data.giver;
    const kind: TouchKind = fd.get("kind") === "massage" ? "massage" : fd.get("kind") === "streicheln" ? "streicheln" : cur.data.kind;
    const next: TouchEntry = compact({ ...cur.data, day, kind, giver, receiver: otherOf(giver), time: time(fd.get("time")), minutes, note, status, skipped: undefined });
    await updateEntry(session, cur.id, "zuwendung", next, true);
    return { ok: true, message: `${touchLabel(kind)} am ${dmy(day)} geändert (${status}).`, id: cur.id, day };
  }
  const status = statusFrom(fd, day, today);
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  const wanted: { kind: TouchKind; giver: PartnerKey }[] = [];
  for (const kind of ["streicheln", "massage"] as const) {
    if (fd.get(`do-${kind}`) !== "on") continue;
    const giver = partnerOf(fd.get(`${kind}-giver`));
    if (!giver) return fail(`Bitte bei ${touchLabel(kind)} wählen, wer gibt.`);
    wanted.push({ kind, giver });
  }
  if (!wanted.length) return fail("Bitte Streicheln, Massage oder beides auswählen.");
  const ids: string[] = [];
  for (const w of wanted) ids.push(await addEntry(session, "zuwendung", compact({ day, kind: w.kind, giver: w.giver, receiver: otherOf(w.giver), time: time(fd.get(`${w.kind}-time`)) ?? time(fd.get("time")), minutes, note, status })));
  return { ok: true, message: `${wanted.map((w) => touchLabel(w.kind)).join(" und ")} am ${dmy(day)} eingetragen (${status}).`, id: ids[0], day };
}

// ---- Periode ----------------------------------------------------------------------------------------------

/** Beginn (Pflicht), Ende (später nachtragen), Notiz, Freigabe für andere Konten – auch rückwirkend. */
export async function savePeriod(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  if (!isDay(fd.get("start"))) return fail("Bitte den ersten Tag angeben.");
  const start = String(fd.get("start"));
  const end = isDay(fd.get("end")) ? String(fd.get("end")) : undefined;
  const settings = await privateSettings(session.tenantId);
  const person = partnerOf(fd.get("person")) ?? myPartner(settings, session);
  if (!person) return fail("Bitte wählen, wessen Periode es ist.");
  const members = await privateMembers(session.tenantId);
  const shareWith = fd.getAll("shareWith").map(String).filter((u) => u !== session.userId && members.some((m) => m.userId === u));
  const editId = String(fd.get("id") ?? "") || null;
  const all = await loadEntries<PeriodEntry>(session, ["periode"]);
  const cur = editId ? all.find((e) => e.id === editId && e.userId === session.userId) : undefined;
  if (editId && !cur) return fail("Eintrag nicht gefunden (nur wer die Periode eingetragen hat, kann sie ändern).");
  const problem = periodProblem({ start, end, person }, all.map((e) => ({ id: e.id, ...e.data })), today, editId ?? undefined);
  if (problem) return fail(problem);
  const data: PeriodEntry = compact({ start, end, person, note: clip(fd.get("note"), 300), shareWith });
  if (cur) {
    await updateEntry(session, cur.id, "periode", data, true);
    return { ok: true, message: `Periode ${dmy(start)}${end ? `–${dmy(end)}` : " (läuft)"} geändert.`, id: cur.id, day: start };
  }
  const id = await addEntry(session, "periode", data);
  return { ok: true, message: `Periode ab ${dmy(start)}${end ? ` bis ${dmy(end)}` : " eingetragen – das Ende später hier nachtragen"}.`, id, day: start };
}

/** Laufende Periode beenden (letzter Tag: heute oder angegeben). */
export async function endPeriod(session: Session, id: string, endIn: unknown): Promise<SaveResult> {
  const today = todayIso();
  const all = await loadEntries<PeriodEntry>(session, ["periode"]);
  const cur = all.find((e) => e.id === id && e.userId === session.userId);
  if (!cur) return fail("Eintrag nicht gefunden.");
  const end = isDay(endIn) ? String(endIn) : today;
  const problem = periodProblem({ ...cur.data, end }, all.map((e) => ({ id: e.id, ...e.data })), today, id);
  if (problem) return fail(problem);
  await updateEntry(session, id, "periode", { end });
  return { ok: true, message: `Periode bis ${dmy(end)} eingetragen.`, id, day: cur.data.start };
}

// ---- Abendritual ------------------------------------------------------------------------------------------

/**
 * Wochenvorlage speichern. Bestätigte, verschobene oder ausgelassene Vorkommen sind eigene Einträge und
 * bleiben unverändert. Ändert sich der Ablauf ab einem späteren Tag, endet die alte Vorlage am Vortag und
 * eine neue beginnt – frühere Wochen bleiben, wie sie waren.
 */
export async function saveRitual(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const strokeGiver = partnerOf(fd.get("streicheln-giver")) ?? "a";
  const massageGiver = partnerOf(fd.get("massage-giver")) ?? "b";
  const strokeTime = time(fd.get("streicheln-time"));
  const massageTime = time(fd.get("massage-time"));
  const slots: RitualSlot[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    if (fd.get(`s-${wd}-streicheln`) === "on") slots.push(compact({ weekday: wd, kind: "streicheln" as const, giver: strokeGiver, receiver: otherOf(strokeGiver), time: strokeTime }));
    if (fd.get(`s-${wd}-massage`) === "on") slots.push(compact({ weekday: wd, kind: "massage" as const, giver: massageGiver, receiver: otherOf(massageGiver), time: massageTime }));
  }
  if (!slots.length) return fail("Bitte mindestens einen Tag ankreuzen.");
  const strokesPerMassage = Math.round(num(fd.get("strokesPerMassage"), 1, 14) ?? 2);
  const title = clip(fd.get("title"), 60) ?? "Unser Abendritual";
  const validFrom = isDay(fd.get("from")) ? String(fd.get("from")) : today;
  const until = isDay(fd.get("until")) ? String(fd.get("until")) : undefined;
  if (until && until < validFrom) return fail("„Endet am“ liegt vor dem Beginn.");
  const next: RitualEntry = compact({ title, slots, from: validFrom, until, strokesPerMassage, active: true });
  const editId = String(fd.get("id") ?? "") || null;
  if (editId) {
    const cur = (await loadEntries<RitualEntry>(session, ["ritual"])).find((e) => e.id === editId);
    if (!cur) return fail("Vorlage nicht gefunden.");
    const sameSlots = JSON.stringify(cur.data.slots) === JSON.stringify(slots);
    if (cur.data.from < validFrom && !sameSlots) {
      await updateEntry(session, cur.id, "ritual", { until: addDays(validFrom, -1) });
      const id = await addEntry(session, "ritual", next);
      return { ok: true, message: `Neuer Ablauf gilt ab ${dmy(validFrom)} – frühere Wochen bleiben unverändert, bestätigte Einträge auch.`, id, day: validFrom };
    }
    await updateEntry(session, cur.id, "ritual", { ...next, from: cur.data.from < validFrom ? cur.data.from : validFrom }, true);
    return { ok: true, message: "Vorlage gespeichert – bestätigte, verschobene oder ausgelassene Termine bleiben, wie sie sind.", id: cur.id, day: validFrom };
  }
  const id = await addEntry(session, "ritual", next);
  return { ok: true, message: `„${title}“ angelegt – ab ${dmy(validFrom)} im Kalender (geplant, zählt erst nach Bestätigung).`, id, day: validFrom };
}

export type OccurrenceOp = "stattgefunden" | "ausgefallen" | "auslassen" | "verschieben";

/** Ein Vorkommen der Serie bestätigen, als ausgefallen markieren, auslassen oder verschieben – nur dieses eine. */
export async function handleOccurrence(session: Session, key: string, op: OccurrenceOp, fd?: FormData): Promise<SaveResult> {
  const today = todayIso();
  const occ = parseOccurrence(key);
  if (!occ) return fail("Termin nicht gefunden.");
  const ritual = (await loadEntries<RitualEntry>(session, ["ritual"])).find((r) => r.id === occ.seriesId);
  if (!ritual) return fail("Die Vorlage gibt es nicht mehr.");
  const valid = ritualOccurrences(ritual.id, ritual.data, occ.day, occ.day, new Set()).find((o) => o.key === key);
  if (!valid || isoWeekday(occ.day) !== valid.slot.weekday || slotKey(valid.slot) !== occ.slot) return fail("Dieser Termin gehört nicht (mehr) zur Vorlage.");
  const slot = valid.slot;
  let day = occ.day;
  let status: EntryStatus = op === "stattgefunden" ? "stattgefunden" : op === "verschieben" ? "geplant" : "ausgefallen";
  let at = slot.time;
  if (op === "verschieben") {
    if (!fd || !isDay(fd.get("day"))) return fail("Bitte den neuen Tag angeben.");
    day = String(fd.get("day"));
    at = time(fd.get("time")) ?? slot.time;
    status = parseStatus(fd.get("status")) ?? defaultStatus(day, today);
  }
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  const existing = (await loadEntries<TouchEntry>(session, ["zuwendung"])).find((e) => e.data.occurrence === key);
  const data: TouchEntry = compact({ day, kind: slot.kind, giver: slot.giver, receiver: slot.receiver, time: at, status, seriesId: ritual.id, occurrence: key, skipped: op === "auslassen" ? true : undefined, note: existing?.data.note });
  const id = existing ? (await updateEntry(session, existing.id, "zuwendung", data, true), existing.id) : await addEntry(session, "zuwendung", data);
  const text = op === "stattgefunden" ? "bestätigt" : op === "ausgefallen" ? "als ausgefallen markiert" : op === "auslassen" ? "ausgelassen" : `verschoben auf ${dmy(day)}`;
  return { ok: true, message: `${touchLabel(slot.kind)} am ${dmy(occ.day)} ${text} – die Serie bleibt unverändert.`, id, day };
}

// ---- Status (alle planbaren Arten) ------------------------------------------------------------------------

export const STATUS_KINDS: PrivateKind[] = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "zuwendung"];

/** Status eines Eintrags ändern; verknüpfte Kinderzeit/Auszeit bekommt denselben Status (ein Vorgang). */
export async function setStatus(session: Session, id: string, statusIn: unknown): Promise<SaveResult> {
  const status = parseStatus(statusIn);
  if (!status) return fail("Unbekannter Status.");
  const e = await loadEntry<{ day?: string; linkId?: string; status?: string }>(session, id);
  if (!e || !STATUS_KINDS.includes(e.kind) || !e.data.day) return fail("Eintrag nicht gefunden.");
  const problem = statusProblem(e.data.day, status, todayIso());
  if (problem) return fail(problem);
  if (statusOf(e.data) === status) return { ok: true, message: "Unverändert.", id, day: e.data.day };
  await updateEntry(session, id, e.kind, { status, ...(e.kind === "zuwendung" ? { skipped: undefined } : {}) });
  if ((e.kind === "kinder" || e.kind === "auszeit") && e.data.linkId) {
    const pk = e.kind === "kinder" ? "auszeit" : "kinder";
    for (const x of (await loadEntries<{ linkId?: string }>(session, [pk])).filter((x) => x.data.linkId === e.data.linkId)) await updateEntry(session, x.id, pk, { status });
  }
  return { ok: true, message: `Status: ${status}.`, id, day: e.data.day };
}
