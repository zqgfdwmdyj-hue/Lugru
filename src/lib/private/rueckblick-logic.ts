// Wochenrückblick privat (B16) und Therapie-Bogen – reine Logik. Nur Zählungen und eigene Einträge; wer welche
// Einträge sehen darf, entscheidet vorher loadEntries (Privat-Zugang mit vollem Umfang, eigene Beobachtungen).

import type { TouchEntry } from "./kalender";
import type { AppointmentEntry, DateIdea, MoodEntry, ObservationEntry, PartnerKey, TalkEntry, TaskEntry, ThanksEntry } from "./logic";

/** Marker für „noch unvollständig / unsicher“ im Text einer Beobachtung. */
export const UNVOLLSTAENDIG = /\[\?\]/;

export type BeobachtungTeile = { situation: string; problematik: string | null; veraenderung: string | null; unvollstaendig: boolean };

const LABEL = {
  situation: /^\s*(situation|was ist passiert|wann\/wo)\s*[:：-]\s*/i,
  problematik: /^\s*(problematik|problem|was war schwierig|schwierig)\s*[:：-]\s*/i,
  veraenderung: /^\s*(gew[üu]nschte ver[äa]nderung|ver[äa]nderung|wunsch|was w[üu]nsche ich mir)\s*[:：-]\s*/i,
};

/**
 * Beobachtung im Format des Therapie-Bogens: eigene Felder, sonst aus dem Text (Trenner „|“ oder Zeilen mit
 * „Situation: … / Problematik: … / Veränderung: …“), sonst alles als Situation. „[?]“ = unvollständig.
 */
export function beobachtungTeile(o: Pick<ObservationEntry, "text"> & Partial<Pick<ObservationEntry, "situation" | "problematik" | "veraenderung">>): BeobachtungTeile {
  const alles = [o.situation, o.problematik, o.veraenderung, o.text].filter(Boolean).join(" ");
  const unvollstaendig = UNVOLLSTAENDIG.test(alles);
  const leer = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  if (o.situation || o.problematik || o.veraenderung) return { situation: leer(o.situation) ?? leer(o.text) ?? "", problematik: leer(o.problematik), veraenderung: leer(o.veraenderung), unvollstaendig };
  const text = (o.text ?? "").trim();
  const teile = text.split(/\s*\|\s*/);
  if (teile.length >= 2) return { situation: teile[0].replace(LABEL.situation, ""), problematik: leer(teile[1].replace(LABEL.problematik, "")), veraenderung: leer((teile.slice(2).join(" | ") || "").replace(LABEL.veraenderung, "")), unvollstaendig };
  const zeilen = text.split(/\r?\n/);
  if (zeilen.some((z) => LABEL.problematik.test(z) || LABEL.veraenderung.test(z))) {
    const r: Record<keyof typeof LABEL, string[]> = { situation: [], problematik: [], veraenderung: [] };
    let akt: keyof typeof LABEL = "situation";
    for (const z of zeilen) {
      const feld = (Object.keys(LABEL) as (keyof typeof LABEL)[]).find((k) => LABEL[k].test(z));
      if (feld) akt = feld;
      const rest = feld ? z.replace(LABEL[feld], "") : z;
      if (rest.trim()) r[akt].push(rest.trim());
    }
    return { situation: r.situation.join(" "), problematik: leer(r.problematik.join(" ")), veraenderung: leer(r.veraenderung.join(" ")), unvollstaendig };
  }
  return { situation: text, problematik: null, veraenderung: null, unvollstaendig };
}

/** Text einer Beobachtung aus den drei Feldern (für Leser, die nur `text` kennen, z. B. den Arztbericht). */
export const beobachtungText = (situation: string, problematik?: string | null, veraenderung?: string | null) =>
  [situation.trim(), problematik?.trim() ? `Problematik: ${problematik.trim()}` : null, veraenderung?.trim() ? `Gewünschte Veränderung: ${veraenderung.trim()}` : null].filter(Boolean).join(" | ");

/** Letzter Paartherapie-Termin (Beginn des Therapie-Bogens): vor heute und nicht ausgefallen – heute nur, wenn er
 * schon als „stattgefunden“ markiert ist (sonst steht die Sitzung noch bevor). */
export function letzteSitzung(termine: AppointmentEntry[], heute: string): string | null {
  return (
    termine
      .filter((x) => x.with === "paar" && x.status !== "ausgefallen" && (x.day < heute || (x.day === heute && x.status === "stattgefunden")))
      .map((x) => x.day)
      .sort()
      .at(-1) ?? null
  );
}

export type TherapieZeile = { tag: string; situation: string; problematik: string | null; veraenderung: string | null; unvollstaendig: boolean };

/** Zeilen des Therapie-Bogens: eigene Beobachtungen im Zeitraum, nach Tag sortiert. */
export function therapieBogen(beobachtungen: ObservationEntry[], von: string, bis: string): TherapieZeile[] {
  return beobachtungen
    .filter((o) => o.day >= von && o.day <= bis)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((o) => ({ tag: o.day, ...beobachtungTeile(o) }));
}

// ---- Woche ---------------------------------------------------------------------------------------------------

export type WocheDaten = {
  beobachtungen: ObservationEntry[];
  zuwendung: TouchEntry[];
  gespraeche: TalkEntry[];
  danke: ThanksEntry[];
  stimmung: MoodEntry[];
  dateideen: { data: DateIdea; createdAt: Date }[];
  aufgaben: TaskEntry[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const imZeitraum = (tag: string | undefined, von: string, bis: string) => !!tag && tag >= von && tag <= bis;

export function wochePrivat(d: WocheDaten, o: { von: string; bis: string; ich: PartnerKey | null; namen: Record<PartnerKey, string> }) {
  const { von, bis } = o;
  const name = (p: PartnerKey) => o.namen[p] ?? p;
  const z = d.zuwendung.filter((t) => imZeitraum(t.day, von, bis) && t.status === "stattgefunden");
  const zuwendung = (["streicheln", "massage"] as const).map((art) => {
    const je = new Map<string, number>();
    for (const t of z.filter((x) => x.kind === art)) je.set(`${name(t.giver)} → ${name(t.receiver)}`, (je.get(`${name(t.giver)} → ${name(t.receiver)}`) ?? 0) + 1);
    return { art, anzahl: z.filter((x) => x.kind === art).length, wer: [...je.entries()].map(([richtung, anzahl]) => ({ richtung, anzahl })) };
  });
  const ausgefallen = d.zuwendung.filter((t) => imZeitraum(t.day, von, bis) && t.status === "ausgefallen").length;
  const stimmungen = d.stimmung.filter((m) => imZeitraum(m.day, von, bis) && (!o.ich || m.person === o.ich)).sort((a, b) => a.day.localeCompare(b.day));
  // Private Aufgaben der eigenen Person (für mich oder für beide).
  const meine = d.aufgaben.filter((t) => !o.ich || !t.forWhom || t.forWhom === o.ich || t.forWhom === "beide");
  const erledigt = meine.filter((t) => (t.repeat === "einmal" ? t.done && imZeitraum((t.doneAt ?? "").slice(0, 10), von, bis) : (t.checks ?? []).some((c) => imZeitraum(c, von, bis))));
  const offen = meine.filter((t) => (t.repeat === "einmal" ? !t.done : !(t.checks ?? []).some((c) => imZeitraum(c, von, bis))));
  return {
    zeitraum: { von, bis },
    beobachtungen: therapieBogen(d.beobachtungen, von, bis),
    zuwendung,
    zuwendungAusgefallen: ausgefallen,
    gespraeche: d.gespraeche.filter((g) => imZeitraum(g.day, von, bis)).sort((a, b) => a.day.localeCompare(b.day)).map((g) => ({ tag: g.day, thema: g.topic ?? null, vereinbart: g.agreed ?? null })),
    danke: d.danke.filter((t) => imZeitraum(t.day, von, bis)).sort((a, b) => a.day.localeCompare(b.day)).map((t) => ({ tag: t.day, von: name(t.from), text: t.text })),
    stimmung: { schnitt: stimmungen.length ? r1(stimmungen.reduce((n, m) => n + m.value, 0) / stimmungen.length) : null, verlauf: stimmungen.map((m) => ({ tag: m.day, wert: m.value })) },
    dateideen: d.dateideen.filter((x) => imZeitraum(x.createdAt.toISOString().slice(0, 10), von, bis)).map((x) => ({ text: x.data.text, umgesetzt: !!x.data.done })),
    aufgaben: { erledigt: erledigt.map((t) => t.title), offen: offen.map((t) => t.title) },
  };
}

export type WochePrivat = ReturnType<typeof wochePrivat>;

/** Anzeigetexte für `vergleichVorwoche`. */
export const VERGLEICH_TEXT: Record<string, string> = {
  beobachtungen: "Beobachtungen",
  streicheln: "Streicheln",
  massage: "Massage",
  gespraeche: "Paar-Gespräche",
  danke: "Danke-Einträge",
  aufgabenErledigt: "Aufgaben erledigt",
  stimmung: "Stimmung Ø",
};

/** Vergleich zur Vorwoche: Anzahlen (mehr/weniger/gleich). Ohne Werte in beiden Wochen kein Eintrag. */
export function vergleichVorwoche(jetzt: WochePrivat, vorher: WochePrivat) {
  const zahl = (w: WochePrivat) => ({
    beobachtungen: w.beobachtungen.length,
    streicheln: w.zuwendung.find((x) => x.art === "streicheln")?.anzahl ?? 0,
    massage: w.zuwendung.find((x) => x.art === "massage")?.anzahl ?? 0,
    gespraeche: w.gespraeche.length,
    danke: w.danke.length,
    aufgabenErledigt: w.aufgaben.erledigt.length,
    stimmung: w.stimmung.schnitt,
  });
  const a = zahl(jetzt);
  const b = zahl(vorher);
  const out: { was: string; diese: number; vorwoche: number; tendenz: "mehr" | "weniger" | "gleich" }[] = [];
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    const x = a[k];
    const y = b[k];
    if (x === null || y === null || (x === 0 && y === 0)) continue;
    out.push({ was: k, diese: x, vorwoche: y, tendenz: x > y ? "mehr" : x < y ? "weniger" : "gleich" });
  }
  return out;
}
