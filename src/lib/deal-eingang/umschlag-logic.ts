// B28.6 Erwartete Umschlagszeit und ROI pro Jahr – reine Logik. Ein 15-%-Deal, der monatlich dreht, bringt mehr als
// ein 30-%-Deal, der drei Monate liegt. Umschlag = Vorlauf (Bestellung → verkaufsbereit bei Amazon) + Verkaufsdauer der
// Menge + Auszahlung. Alles geschätzt, deshalb als Spanne.

/** Vorlauf in Tagen: Bestellung → Wareneingang → Versand an Amazon (Prep Center) → Amazon „Empfang abgeschlossen“. */
export type Vorlauf = { wareneingang: number; prep: number; amazonEingang: number; auszahlung: number; quelle: "eigene Daten" | "Standard"; basis?: number };
export const STANDARD_VORLAUF: Vorlauf = { wareneingang: 7, prep: 4, amazonEingang: 10, auszahlung: 14, quelle: "Standard" };
export const vorlaufTage = (v: Vorlauf) => v.wareneingang + v.prep + v.amazonEingang;

export type Umschlag = {
  /** Eigene Verkäufe je Monat (schnell / mitte / langsam). */
  eigeneProMonat: { max: number; mitte: number; min: number };
  /** Tage, bis die Menge verkauft ist (Reichweite). */
  verkaufsTage: { min: number; mitte: number; max: number };
  /** Gesamter Umschlag in Tagen (Vorlauf + Verkauf + Auszahlung). */
  tage: { min: number; mitte: number; max: number };
  menge: number;
  /** true = Menge unbekannt, gerechnet mit der Menge für 30 Tage. */
  mengeAngenommen: boolean;
  vorlauf: Vorlauf;
  roiPa: number | null;
  roiPaSpanne: { min: number; max: number } | null;
  /** Verkaufszahl geschätzt (Rang) bzw. Angebote unbekannt – die Spanne ist dann unsicherer. */
  geschaetzt: true;
  text: string;
  warnung: string | null;
  /** Vorschlag: Menge für 45 Tage Reichweite. */
  menge45: number | null;
};

export const REICHWEITE_WARNUNG_TAGE = 60;
const auf5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Eigener Anteil an den Verkäufen: Verkäufe ÷ (Angebote + 1) – wir kommen als weiteres Angebot dazu; die Buy Box
 * rotiert. Schnell = Anteil wie ein Angebot weniger, langsam = wie ein Angebot mehr. Hält Amazon die Buy Box zu einem
 * Teil, fällt dieser Teil weg.
 */
export function umschlagSchaetzen(o: { verkaeufeMonat: number | null | undefined; angebote: number | null | undefined; amazonProzent?: number | null; menge: number | null | undefined; roi: number | null | undefined; vorlauf?: Vorlauf }): Umschlag | null {
  const v = o.verkaeufeMonat ?? null;
  if (v === null || !(v > 0)) return null;
  const vorlauf = o.vorlauf ?? STANDARD_VORLAUF;
  const n = o.angebote === null || o.angebote === undefined ? 2 : Math.max(0, o.angebote);
  const amazon = o.amazonProzent === null || o.amazonProzent === undefined ? 1 : Math.max(0.05, 1 - o.amazonProzent / 100);
  const anteil = { max: amazon / Math.max(1, n), mitte: amazon / (n + 1), min: amazon / (n + 2) };
  const eigene = { max: r1(v * anteil.max), mitte: r1(v * anteil.mitte), min: r1(v * anteil.min) };
  if (!(eigene.min > 0)) return null;
  const mengeAngenommen = !(o.menge && o.menge > 0);
  const menge = mengeAngenommen ? Math.max(1, Math.round(eigene.mitte)) : o.menge!;
  const vt = { min: Math.ceil((menge / eigene.max) * 30), mitte: Math.ceil((menge / eigene.mitte) * 30), max: Math.ceil((menge / eigene.min) * 30) };
  const fest = vorlaufTage(vorlauf) + vorlauf.auszahlung;
  const tage = { min: fest + vt.min, mitte: fest + vt.mitte, max: fest + vt.max };
  const roi = o.roi ?? null;
  const pa = (t: number) => (roi === null ? null : Math.round((roi * 365) / t));
  const warn = vt.mitte > REICHWEITE_WARNUNG_TAGE && !mengeAngenommen;
  const menge45 = Math.max(1, Math.floor((eigene.mitte * 45) / 30));
  return {
    eigeneProMonat: eigene,
    verkaufsTage: vt,
    tage,
    menge,
    mengeAngenommen,
    vorlauf,
    roiPa: pa(tage.mitte),
    roiPaSpanne: roi === null ? null : { min: pa(tage.max)!, max: pa(tage.min)! },
    geschaetzt: true,
    text: `ca. ${auf5(tage.min)}–${auf5(tage.max)} Tage`,
    warnung: warn ? `Menge reicht ca. ${vt.mitte} Tage – kleinere Menge (${menge45} Stk für 45 Tage) oder höherer Abschlag?` : null,
    menge45: warn ? menge45 : null,
  };
}

/** Kurzform für Tabelle, Discord und Werkzeuge: „ca. 45–70 T · ROI p. a. 180 %“. */
export function umschlagKurz(u: Umschlag | null | undefined): string | null {
  if (!u) return null;
  return `Umschlag ${u.text.replace(" Tage", " T")}${u.roiPa !== null ? ` · ROI p. a. ${u.roiPa} %` : ""}${u.mengeAngenommen ? " (Menge für 30 Tage angenommen)" : ""}`;
}

/** Erklärung der Rechnung (Tooltip, Werkzeug). */
export function umschlagErklaerung(u: Umschlag): string {
  const v = u.vorlauf;
  return `geschätzt: ${u.menge} Stk bei ca. ${u.eigeneProMonat.mitte} eigenen Verkäufen/Monat (${u.eigeneProMonat.min}–${u.eigeneProMonat.max}) = ${u.verkaufsTage.mitte} Tage Verkauf (${u.verkaufsTage.min}–${u.verkaufsTage.max}) + Vorlauf ${vorlaufTage(v)} Tage (Wareneingang ${v.wareneingang}, Prep ${v.prep}, Amazon-Eingang ${v.amazonEingang}; ${v.quelle === "eigene Daten" ? `eigene Daten${v.basis ? `, ${v.basis} Einkäufe` : ""}` : "Standardwerte"}) + ${v.auszahlung} Tage bis Auszahlung`;
}
