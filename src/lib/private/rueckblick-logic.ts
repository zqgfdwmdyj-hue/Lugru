// Wochenrückblick privat (B16) und Therapie-Bogen – reine Logik. Nur Zählungen und eigene Einträge; wer welche
// Einträge sehen darf, entscheidet vorher loadEntries (Privat-Zugang mit vollem Umfang, eigene Beobachtungen).

import type { TouchEntry } from "./kalender";
import type { AppointmentEntry, DateIdea, MoodEntry, ObservationEntry, PartnerKey, ReflexionEntry, TalkEntry, TaskEntry, ThanksEntry } from "./logic";

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
/** B20.9: Paartherapie-Termin – Art „Paartherapie“ oder ein entsprechender Titel (z. B. aus dem externen Kalender). */
export const istPaartherapie = (x: Pick<AppointmentEntry, "with" | "title">) => x.with === "paar" || /paar\s*-?\s*(?:therapie|beratung|coaching|sitzung)|couples?\s*(?:therap|counsel)|eheberatung/i.test(x.title ?? "");

/** Paartherapie-Termin aus Privatkalender oder Kalender (dort nur Titel, Art „sonst“). */
export type SitzungsTermin = Pick<AppointmentEntry, "day" | "with" | "title" | "status">;

export function letzteSitzung(termine: SitzungsTermin[], heute: string): string | null {
  return (
    termine
      .filter((x) => istPaartherapie(x) && x.status !== "ausgefallen" && (x.day < heute || (x.day === heute && x.status === "stattgefunden")))
      .map((x) => x.day)
      .sort()
      .at(-1) ?? null
  );
}

/** B22.1: nächste Paartherapie-Sitzung ab heute (heute zählt, solange sie nicht als stattgefunden markiert ist). */
export function naechsteSitzung(termine: SitzungsTermin[], heute: string): string | null {
  return (
    termine
      .filter((x) => istPaartherapie(x) && x.status !== "ausgefallen" && (x.day > heute || (x.day === heute && x.status !== "stattgefunden")))
      .map((x) => x.day)
      .sort()[0] ?? null
  );
}

/** Beobachtungen in der Reihenfolge des Bogens: nach Tag, am selben Tag in der Reihenfolge des Eintragens. */
export function nachTag<T extends { data: { day: string }; createdAt: Date }>(e: T[]): T[] {
  return [...e].sort((a, b) => a.data.day.localeCompare(b.data.day) || a.createdAt.getTime() - b.createdAt.getTime());
}

export type ReflexionZeile = { id?: string; tag: string; text: string; sitzung: string | null };

/**
 * „Für die nächste Sitzung“ (Stand `bis`): Zettel bis zu diesem Tag, deren Sitzung noch aussteht – ausdrücklich
 * zugeordnet (Sitzung ≥ bis) oder ohne Zuordnung nach der letzten Sitzung geschrieben.
 */
export function fuerNaechsteSitzung<T extends { id?: string; data: ReflexionEntry; createdAt: Date }>(zettel: T[], o: { bis: string; letzte: string | null }): ReflexionZeile[] {
  return nachTag(zettel.filter((z) => z.data.day <= o.bis && (z.data.sitzung ? z.data.sitzung >= o.bis : !o.letzte || z.data.day >= o.letzte))).map((z) => ({ id: z.id, tag: z.data.day, text: z.data.text, sitzung: z.data.sitzung ?? null }));
}

const plusT = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** ISO-Kalenderwoche eines Tages. */
export function kalenderwoche(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`);
  const tag = (d.getUTCDay() + 6) % 7; // Mo = 0
  d.setUTCDate(d.getUTCDate() - tag + 3); // Donnerstag derselben Woche
  const erster = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - erster.getTime()) / 86_400_000 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7);
}

/**
 * Anzahl je Kalenderwoche (Mo–So) im Zeitraum von–bis, älteste zuerst – z. B. „Nähe / Intimität“ im Rückblick
 * aufgegliedert. Jede Woche des Zeitraums erscheint, auch ohne Eintrag (anzahl 0); Tage außerhalb zählen nicht.
 */
export function jeWoche(tage: string[], von: string, bis: string): { kw: number; anzahl: number }[] {
  if (von > bis) return [];
  const montag = (iso: string) => plusT(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
  const wochen: { mo: string; kw: number; anzahl: number }[] = [];
  for (let mo = montag(von); mo <= bis; mo = plusT(mo, 7)) wochen.push({ mo, kw: kalenderwoche(mo), anzahl: 0 });
  for (const t of tage) {
    const tag = t.slice(0, 10);
    if (tag < von || tag > bis) continue;
    const w = wochen.find((x) => x.mo === montag(tag));
    if (w) w.anzahl++;
  }
  return wochen.map(({ kw, anzahl }) => ({ kw, anzahl }));
}

const WOCHENTAG = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
/**
 * Wochentage je Kalenderwoche im Zeitraum von–bis (z. B. „Ausgeschlafen“ im Rückblick): je Woche die Wochentage der
 * Einträge in Datumsfolge („Sa, So“), ein Tag mit zwei Einträgen zweimal. Wochen ohne Eintrag mit leerer Liste.
 */
export function wochentageJeWoche(tage: string[], von: string, bis: string): { kw: number; tage: string[] }[] {
  const zaehl = jeWoche([], von, bis);
  const montag = (iso: string) => plusT(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
  const erster = von > bis ? null : montag(von);
  const wochen = zaehl.map((w) => ({ kw: w.kw, tage: [] as string[] }));
  for (const t of tage.map((x) => x.slice(0, 10)).filter((x) => x >= von && x <= bis).sort()) {
    const i = Math.round((Date.parse(`${montag(t)}T12:00:00Z`) - Date.parse(`${erster}T12:00:00Z`)) / (7 * 86_400_000));
    wochen[i]?.tage.push(WOCHENTAG[(new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7]);
  }
  return wochen;
}

/** B22.1: Wochen zur Auswahl (Mo–So, die laufende bis heute), neueste zuerst. `bis` = letzter Tag der Woche. */
export function wochenAuswahl(heute: string, anzahl = 12): { label: string; von: string; bis: string }[] {
  const mo = plusT(heute, -((new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7));
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  return Array.from({ length: anzahl }, (_, i) => {
    const von = plusT(mo, -7 * i);
    const so = plusT(von, 6);
    const bis = so > heute ? heute : so;
    return { label: `KW ${kalenderwoche(von)} · ${dm(von)}–${dm(so)}${so > heute ? " (laufend)" : ""}`, von, bis };
  });
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

// ---- Rückblick: Monat oder frei gewählter Zeitraum ----------------------------------------------------

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;
/** Echtes Kalenderdatum JJJJ-MM-TT (kein 31.02.). */
const istTag = (s: string | undefined): s is string => !!s && ISO_TAG.test(s) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

export type RueckblickZeitraum = {
  /** true = frei gewählt (von/bis), false = Kalendermonat. */
  frei: boolean;
  von: string;
  /** Letzter ausgewerteter Tag – nie nach heute. */
  bis: string;
  /** Monat für Monatsnavigation und Kopf (beim freien Zeitraum der Monat von „bis“). */
  monat: string;
  /** Zeitraum endet eigentlich später (laufender Monat bzw. „bis“ in der Zukunft) und wurde auf heute gekürzt. */
  gekuerzt: boolean;
};

/**
 * Zeitraum des Privat-Rückblicks aus der Adresse: `?von=…&bis=…` (frei, auch nur eines von beiden) oder `?monat=JJJJ-MM`.
 * Vertauschte Daten werden getauscht, alles nach heute auf heute gekürzt; ohne Angabe der laufende Monat.
 */
export function rueckblickZeitraum(p: { monat?: string; von?: string; bis?: string }, heute: string): RueckblickZeitraum {
  if (istTag(p.von) || istTag(p.bis)) {
    let bis = istTag(p.bis) ? p.bis : heute;
    let von = istTag(p.von) ? p.von : `${bis.slice(0, 7)}-01`;
    if (von > bis) [von, bis] = [bis, von];
    const gekuerzt = bis > heute;
    if (gekuerzt) bis = heute;
    if (von > bis) von = bis;
    return { frei: true, von, bis, monat: bis.slice(0, 7), gekuerzt };
  }
  const monat = p.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.monat) ? p.monat : heute.slice(0, 7);
  const [y, m] = monat.split("-").map(Number);
  const letzter = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const bis = letzter < heute ? letzter : heute;
  return { frei: false, von: `${monat}-01`, bis, monat, gekuerzt: bis < letzter };
}

/** Schnellauswahl für den freien Zeitraum. */
export function zeitraumVorschlaege(heute: string): { label: string; von: string; bis: string }[] {
  return [
    { label: "Letzte 30 Tage", von: plusT(heute, -29), bis: heute },
    { label: "Letzte 3 Monate", von: plusT(heute, -90), bis: heute },
    { label: "Seit Jahresbeginn", von: `${heute.slice(0, 4)}-01-01`, bis: heute },
  ];
}
