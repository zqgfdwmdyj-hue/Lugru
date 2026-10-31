// Privates Geld – reine Logik (nur Privatbereich, je Person): Einkommen aus der GmbH (Gehalt/Ausschüttung),
// private Fixkosten, Rücklagen-Ziele, Anlagen, Erinnerungen, Fragen für den Steuerberater; Monatsübersicht aus
// dem Privatkonto. Keine Steuerberatung – nur Zahlen und Hinweise „mit Steuerberater klären“.

export type GeldTyp = "einkommen" | "fixkosten" | "ruecklage" | "anlage" | "erinnerung" | "steuerberater";

export type Einkommen = { typ: "einkommen"; art: "gehalt" | "ausschuettung" | "sonstiges"; betrag: number; monat: string; status: "geplant" | "erhalten"; notiz?: string };
export type Fixkosten = { typ: "fixkosten"; name: string; betrag: number; rhythmus: "monatlich" | "quartal" | "jaehrlich"; notiz?: string };
export type Ruecklage = { typ: "ruecklage"; name: string; ziel: number; stand: number; monatlich?: number };
export type Anlage = { typ: "anlage"; name: string; art: "etf" | "immobilie" | "konto" | "sonstiges"; wert: number; standAm: string; sparrate?: number };
export type Erinnerung = { typ: "erinnerung"; titel: string; faellig: string; wiederholung: "einmal" | "monatlich" | "jaehrlich"; erledigtAm?: string };
export type Steuerfrage = { typ: "steuerberater"; frage: string; erledigt?: boolean };
export type GeldEintrag = Einkommen | Fixkosten | Ruecklage | Anlage | Erinnerung | Steuerfrage;

export const EINKOMMEN_TEXT = { gehalt: "Gehalt (GmbH)", ausschuettung: "Ausschüttung (GmbH)", sonstiges: "Sonstiges" } as const;
export const ANLAGE_TEXT = { etf: "ETF-Sparplan", immobilie: "Immobilie", konto: "Konto/Tagesgeld", sonstiges: "Sonstiges" } as const;

/** Vorschläge für Erinnerungen (je Jahr) – nur Hinweise, keine Beratung. */
export const STANDARD_ERINNERUNGEN: { titel: string; monatTag: string; wiederholung: Erinnerung["wiederholung"] }[] = [
  { titel: "Sparpläne prüfen (Rate, Ausführung)", monatTag: "01-15", wiederholung: "jaehrlich" },
  { titel: "Freistellungsauftrag prüfen und verteilen", monatTag: "01-10", wiederholung: "jaehrlich" },
  { titel: "Unterlagen für die private Steuererklärung sammeln", monatTag: "03-01", wiederholung: "jaehrlich" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const plusMonate = (iso: string, n: number) => {
  const [j, m, t] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  d.setUTCDate(Math.min(t, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
};

/** Fixkosten je Monat (Quartal ÷ 3, Jahr ÷ 12). */
export const fixkostenMonat = (f: Fixkosten[]) => r2(f.reduce((n, x) => n + x.betrag / (x.rhythmus === "quartal" ? 3 : x.rhythmus === "jaehrlich" ? 12 : 1), 0));

/** Einkommen eines Jahres: geplant und erhalten, je Art. */
export function einkommenJahr(e: Einkommen[], jahr: string) {
  const imJahr = e.filter((x) => x.monat.startsWith(jahr));
  const sum = (f: (x: Einkommen) => boolean) => r2(imJahr.filter(f).reduce((n, x) => n + x.betrag, 0));
  return {
    geplant: sum(() => true),
    erhalten: sum((x) => x.status === "erhalten"),
    gehalt: sum((x) => x.art === "gehalt"),
    ausschuettung: sum((x) => x.art === "ausschuettung"),
  };
}

/** Rücklagen: Anteil erreicht und Monate bis zum Ziel bei der monatlichen Rate. */
export function ruecklageStand(r: Ruecklage): { prozent: number; fehlt: number; monateBisZiel: number | null } {
  const fehlt = Math.max(0, r2(r.ziel - r.stand));
  return { prozent: r.ziel > 0 ? Math.min(100, Math.round((r.stand / r.ziel) * 100)) : 100, fehlt, monateBisZiel: fehlt === 0 ? 0 : r.monatlich && r.monatlich > 0 ? Math.ceil(fehlt / r.monatlich) : null };
}

/** Vermögen aus Anlagen + Rücklagen (Stand). */
export const vermoegen = (anlagen: Anlage[], ruecklagen: Ruecklage[]) => r2(anlagen.reduce((n, a) => n + a.wert, 0) + ruecklagen.reduce((n, r) => n + r.stand, 0));

/** Fällige Erinnerungen (bis `tage` voraus, nicht erledigt). */
export function faelligeErinnerungen(e: Erinnerung[], heute: string, tage = 14): Erinnerung[] {
  const bis = new Date(Date.parse(`${heute}T12:00:00Z`) + tage * 86_400_000).toISOString().slice(0, 10);
  return e.filter((x) => !x.erledigtAm && x.faellig <= bis).sort((a, b) => a.faellig.localeCompare(b.faellig));
}

/** Erledigen: einmalig → erledigt; wiederkehrend → nächster Termin. */
export function erinnerungErledigt(e: Erinnerung, heute: string): Erinnerung {
  if (e.wiederholung === "einmal") return { ...e, erledigtAm: heute };
  let f = e.faellig;
  do f = plusMonate(f, e.wiederholung === "monatlich" ? 1 : 12);
  while (f <= heute);
  return { ...e, faellig: f };
}

export type KontoUmsatz = { buchungstag: string; betrag: number; gegenpartei: string | null; gruppe: string };

/** Monatsübersicht Privatkonto: Einnahmen, Ausgaben, Saldo und die größten Ausgaben je Empfänger. */
export function monatsUebersicht(u: KontoUmsatz[], monat: string) {
  const m = u.filter((x) => x.buchungstag.startsWith(monat));
  const einnahmen = r2(m.filter((x) => x.betrag > 0).reduce((n, x) => n + x.betrag, 0));
  const ausgaben = r2(m.filter((x) => x.betrag < 0).reduce((n, x) => n - x.betrag, 0));
  const jeEmpfaenger = new Map<string, { name: string; betrag: number; anzahl: number }>();
  for (const x of m.filter((y) => y.betrag < 0)) {
    const e = jeEmpfaenger.get(x.gruppe) ?? { name: x.gegenpartei || "ohne Namen", betrag: 0, anzahl: 0 };
    e.betrag = r2(e.betrag - x.betrag);
    e.anzahl++;
    jeEmpfaenger.set(x.gruppe, e);
  }
  return { monat, einnahmen, ausgaben, saldo: r2(einnahmen - ausgaben), buchungen: m.length, groessteAusgaben: [...jeEmpfaenger.values()].sort((a, b) => b.betrag - a.betrag).slice(0, 8) };
}

/** Letzte n Monate (JJJJ-MM), jüngster zuerst. */
export function letzteMonate(heute: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => plusMonate(`${heute.slice(0, 7)}-01`, -i).slice(0, 7));
}
