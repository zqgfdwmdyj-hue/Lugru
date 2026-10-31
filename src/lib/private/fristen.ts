// Vorsorge, Fristen & Verträge – reine Logik (Privatbereich). Je Eintrag die nächste Frist und ab wann das System
// daran erinnert („Zahnarzt Ludwig fällig in 3 Wochen – buchen?“). Geschäftliche Verträge/Fristen tragen das
// Firmen-Kennzeichen und werden getrennt ausgewiesen.

export type FristTyp = "vorsorge" | "dokument" | "fahrzeug" | "garantie" | "vertrag";

type Basis = { firma?: boolean; notiz?: string; erledigtBis?: string; /** Wochen vorher erinnern (sonst Standard je Art). */ vorlaufWochen?: number };
/** Wiederkehrende Vorsorge (Zahnarzt alle 6 Monate …) oder einmalig mit festem Datum (U-Untersuchung, Impfung). */
export type Vorsorge = Basis & { typ: "vorsorge"; was: string; person: string; intervallMonate: number | null; zuletzt?: string; faellig?: string; gebuchtAm?: string };
export type Dokument = Basis & { typ: "dokument"; was: string; person: string; ablauf: string };
export type Fahrzeug = Basis & { typ: "fahrzeug"; fahrzeug: string; was: "tuev" | "reifen" | "inspektion" | "sonstiges"; bezeichnung?: string; faellig?: string };
export type Garantie = Basis & { typ: "garantie"; was: string; bis: string; haendler?: string };
export type Vertrag = Basis & {
  typ: "vertrag";
  anbieter: string;
  was: string;
  kostenMonat: number;
  /** Ende der aktuellen Laufzeit. */
  laufzeitBis?: string;
  /** Verlängerung ohne Kündigung um so viele Monate (0/leer = endet). */
  verlaengerungMonate?: number;
  kuendigungsfristWochen?: number;
  gekuendigtZum?: string;
  ansprechpartner?: string;
  /** Wochen vor dem letzten Kündigungstag erinnern. */
  erinnerungWochen?: number;
};
export type FristEintrag = Vorsorge | Dokument | Fahrzeug | Garantie | Vertrag;

export const FRIST_TYP_TEXT: Record<FristTyp, string> = { vorsorge: "Vorsorge", dokument: "Dokument", fahrzeug: "Fahrzeug", garantie: "Garantie", vertrag: "Vertrag/Abo" };
export const FAHRZEUG_TEXT: Record<Fahrzeug["was"], string> = { tuev: "TÜV/HU", reifen: "Reifenwechsel", inspektion: "Inspektion", sonstiges: "Sonstiges" };

/** Vorschläge für den Start (Intervall in Monaten) – je Person pflegbar. */
export const VORSORGE_VORSCHLAEGE: { was: string; intervallMonate: number }[] = [
  { was: "Zahnarzt (Kontrolle)", intervallMonate: 6 },
  { was: "Zahnreinigung", intervallMonate: 12 },
  { was: "Check-up Hausarzt", intervallMonate: 36 },
  { was: "Hautkrebs-Screening", intervallMonate: 24 },
  { was: "Augenarzt", intervallMonate: 24 },
  { was: "Tierarzt (Impfung)", intervallMonate: 12 },
];

const VORLAUF_STANDARD: Record<FristTyp, number> = { vorsorge: 4, dokument: 12, fahrzeug: 4, garantie: 4, vertrag: 4 };

export const plusMonate = (iso: string, n: number) => {
  const [j, m, t] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  d.setUTCDate(Math.min(t, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
};
export const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tageBis = (von: string, bis: string) => Math.round((Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) / 86_400_000);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function inWorten(tage: number): string {
  if (tage < 0) return `seit ${-tage} Tag${tage === -1 ? "" : "en"} überfällig`;
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  if (tage < 14) return `in ${tage} Tagen`;
  if (tage < 63) return `in ${Math.round(tage / 7)} Wochen`;
  return `in ${Math.round(tage / 30)} Monaten`;
}

/** Nächster Reifenwechsel: Oktober (Winter) bzw. April (Sommer) – jeweils der 1. des Monats. */
export function naechsterReifenwechsel(heute: string): { datum: string; text: string } {
  const j = Number(heute.slice(0, 4));
  const kandidaten = [
    { datum: `${j}-04-01`, text: "Sommerreifen" },
    { datum: `${j}-10-01`, text: "Winterreifen" },
    { datum: `${j + 1}-04-01`, text: "Sommerreifen" },
  ];
  // Bis Monatsende gilt der aktuelle Wechsel noch als fällig.
  return kandidaten.find((k) => plusTage(plusMonate(k.datum, 1), -1) >= heute)!;
}

/** Vertrag: letzter Kündigungstag und Laufzeitende (automatische Verlängerung eingerechnet). */
export function vertragsfrist(v: Vertrag, heute: string): { ende: string; kuendigenBis: string } | null {
  if (v.gekuendigtZum) return { ende: v.gekuendigtZum, kuendigenBis: v.gekuendigtZum };
  if (!v.laufzeitBis) return null;
  let ende = v.laufzeitBis;
  const frist = (e: string) => plusTage(e, -7 * (v.kuendigungsfristWochen ?? 0));
  // Verpasste Kündigungstermine: die Laufzeit hat sich schon verlängert.
  for (let i = 0; i < 50 && v.verlaengerungMonate && frist(ende) < heute; i++) ende = plusMonate(ende, v.verlaengerungMonate);
  return { ende, kuendigenBis: frist(ende) };
}

export type NaechsteFrist = { datum: string; titel: string; text: string; tage: number; erinnern: boolean; ueberfaellig: boolean; vorschlag: string | null; firma: boolean };

/** Nächste Frist eines Eintrags; `erinnern` = innerhalb des Vorlaufs (jetzt kümmern). */
export function naechsteFrist(e: FristEintrag, heute: string): NaechsteFrist | null {
  const vorlauf = 7 * (e.vorlaufWochen ?? (e.typ === "vertrag" ? e.erinnerungWochen : undefined) ?? VORLAUF_STANDARD[e.typ]);
  const mach = (datum: string, titel: string, text: string, vorschlag: string | null): NaechsteFrist => {
    const tage = tageBis(heute, datum);
    const erledigt = !!e.erledigtBis && e.erledigtBis >= datum;
    return { datum, titel, text, tage, erinnern: !erledigt && tage <= vorlauf, ueberfaellig: !erledigt && tage < 0, vorschlag: erledigt ? null : vorschlag, firma: !!e.firma };
  };
  switch (e.typ) {
    case "vorsorge": {
      if (e.gebuchtAm && e.gebuchtAm >= heute) return { ...mach(e.gebuchtAm, `${e.was} ${e.person}`, `Termin am ${dmy(e.gebuchtAm)}`, null), erinnern: false, ueberfaellig: false };
      const datum = e.faellig ?? (e.zuletzt && e.intervallMonate ? plusMonate(e.zuletzt, e.intervallMonate) : heute);
      const titel = `${e.was} ${e.person}`;
      const offen = !e.zuletzt && !e.faellig;
      const f = mach(datum, titel, offen ? "letzter Termin unbekannt" : `fällig ${inWorten(tageBis(heute, datum))}`, null);
      return { ...f, vorschlag: f.erinnern ? `${titel} ${offen ? "– letzten Termin eintragen oder" : `fällig ${inWorten(f.tage)} –`} buchen?` : null };
    }
    case "dokument": {
      const f = mach(e.ablauf, `${e.was} ${e.person}`, `läuft ${e.ablauf < heute ? "seit" : "am"} ${dmy(e.ablauf)} ab`, null);
      return { ...f, vorschlag: f.erinnern ? `${e.was} ${e.person} läuft ${inWorten(f.tage)} ab – neu beantragen (Termin beim Amt).` : null };
    }
    case "fahrzeug": {
      if (e.was === "reifen" && !e.faellig) {
        const r = naechsterReifenwechsel(heute);
        const f = mach(r.datum, `Reifenwechsel ${e.fahrzeug}`, `${r.text} ab ${dmy(r.datum)}`, null);
        return { ...f, vorschlag: f.erinnern ? `${r.text} für ${e.fahrzeug} – Termin in der Werkstatt machen?` : null };
      }
      if (!e.faellig) return null;
      const name = e.was === "sonstiges" ? e.bezeichnung || "Fahrzeug" : FAHRZEUG_TEXT[e.was];
      const f = mach(e.faellig, `${name} ${e.fahrzeug}`, `fällig ${dmy(e.faellig)}`, null);
      return { ...f, vorschlag: f.erinnern ? `${name} ${e.fahrzeug} fällig ${inWorten(f.tage)} – Termin machen?` : null };
    }
    case "garantie": {
      const f = mach(e.bis, `Garantie ${e.was}`, `bis ${dmy(e.bis)}${e.haendler ? ` (${e.haendler})` : ""}`, null);
      return { ...f, vorschlag: f.erinnern && f.tage >= 0 ? `Garantie ${e.was} endet ${inWorten(f.tage)} – Mängel jetzt melden.` : null };
    }
    case "vertrag": {
      const v = vertragsfrist(e, heute);
      if (!v) return null;
      if (e.gekuendigtZum) return { ...mach(e.gekuendigtZum, `${e.anbieter} (${e.was})`, `gekündigt zum ${dmy(e.gekuendigtZum)}`, null), erinnern: false, ueberfaellig: false };
      const f = mach(v.kuendigenBis, `${e.anbieter} (${e.was})`, `kündigen bis ${dmy(v.kuendigenBis)} – sonst ${e.verlaengerungMonate ? `+${e.verlaengerungMonate} Monate bis ${dmy(plusMonate(v.ende, e.verlaengerungMonate))}` : `endet ${dmy(v.ende)}`}`, null);
      return { ...f, vorschlag: f.erinnern && f.tage >= 0 ? `${e.anbieter}: Kündigungsfrist endet ${inWorten(f.tage)} – behalten oder kündigen?` : null };
    }
  }
}

/** Fixkosten je Monat aus Verträgen (gekündigte nach Vertragsende nicht mehr), privat und Firma getrennt. */
export function fixkostenVertraege(v: Vertrag[], heute: string): { privat: number; firma: number } {
  const r = { privat: 0, firma: 0 };
  for (const x of v) {
    if (x.gekuendigtZum && x.gekuendigtZum < heute) continue;
    r[x.firma ? "firma" : "privat"] += x.kostenMonat || 0;
  }
  return { privat: Math.round(r.privat * 100) / 100, firma: Math.round(r.firma * 100) / 100 };
}

/** Nach „erledigt“ (Termin war, Dokument erneuert …) das nächste Datum: Vorsorge rückt um das Intervall weiter. */
export function alsErledigt(e: FristEintrag, heute: string, neuesDatum?: string): Partial<FristEintrag> {
  switch (e.typ) {
    case "vorsorge":
      return e.intervallMonate ? { zuletzt: heute, gebuchtAm: undefined, faellig: undefined } : { erledigtBis: e.faellig ?? heute };
    case "dokument":
      return neuesDatum ? { ablauf: neuesDatum } : { erledigtBis: e.ablauf };
    case "fahrzeug":
      if (e.was === "tuev") return { faellig: neuesDatum ?? plusMonate(e.faellig ?? heute, 24) };
      if (e.was === "reifen") return { erledigtBis: naechsterReifenwechsel(heute).datum, faellig: undefined };
      return neuesDatum ? { faellig: neuesDatum } : { erledigtBis: e.faellig ?? heute };
    case "garantie":
      return { erledigtBis: e.bis };
    case "vertrag":
      return neuesDatum ? { laufzeitBis: neuesDatum } : { erledigtBis: naechsteFrist(e, heute)?.datum ?? heute };
  }
}

/** Fristen bis `bis` (überfällige und im Vorlauf eingeschlossen), sortiert nach Datum. */
export function fristenBis<T extends { id: string; data: FristEintrag }>(eintraege: T[], heute: string, bis: string, bereich: "privat" | "geschaeft" | "alle" = "alle") {
  return eintraege
    .filter((e) => bereich === "alle" || (bereich === "geschaeft") === !!e.data.firma)
    .map((e) => ({ id: e.id, typ: e.data.typ, frist: naechsteFrist(e.data, heute) }))
    .filter((x): x is { id: string; typ: FristTyp; frist: NaechsteFrist } => !!x.frist && (x.frist.datum <= bis || x.frist.erinnern))
    .sort((a, b) => a.frist.datum.localeCompare(b.frist.datum));
}
