// FBA-Lagergebühren (Bericht „Monthly Storage Fees“) – reine Logik, getestet in tests/lagergebuehren.test.ts:
// Einheiten umrechnen, übergroß erkennen, „Lagergebühr frisst Marge“, „Remission prüfen“, sellerboard-Fixkosten finden.

/** Ab dieser längsten Seite gilt ein Artikel bei Amazon EU als übergroß (Standard-Paket max. 45 × 34 × 26 cm). */
export const UEBERGROSS_AB_CM = 45;
/** „Lagergebühr frisst Marge“, wenn die Lagergebühr bis zum Verkauf mindestens diesen Anteil vom Gewinn je Stück erreicht. */
export const MARGE_ANTEIL = 0.5;
/** „Remission prüfen“: Reichweite ab so vielen Tagen (oder keine Verkäufe) … */
export const REMISSION_REICHWEITE_TAGE = 180;
/** … und Lagergebühr mindestens so viel je Monat (alle Länder). */
export const REMISSION_AB_EUR_MONAT = 5;

const r2 = (n: number) => Math.round(n * 100) / 100;
const zahlText = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Länge in Zentimeter (Bericht: „centimeters“ oder „inches“). */
export function inCm(wert: number | null, einheit: string | null | undefined): number | null {
  if (wert === null || !Number.isFinite(wert)) return null;
  const e = (einheit ?? "").toLowerCase();
  if (/inch|zoll|^in$/.test(e)) return r2(wert * 2.54);
  if (/^mm|millimet/.test(e)) return r2(wert / 10);
  if (/^m$|^meter|^metre/.test(e)) return r2(wert * 100);
  return r2(wert);
}

/** Volumen in Kubikmeter (Bericht: „cubic meters“, „cubic feet“, „cubic centimeters“, „cubic inches“). */
export function inM3(wert: number | null, einheit: string | null | undefined): number | null {
  if (wert === null || !Number.isFinite(wert)) return null;
  const e = (einheit ?? "").toLowerCase();
  if (/feet|foot|ft/.test(e)) return wert * 0.0283168;
  if (/inch|in3|in³/.test(e)) return wert * 0.0000163871;
  if (/centimet|cm/.test(e)) return wert / 1_000_000;
  if (/liter|litre/.test(e)) return wert / 1000;
  return wert;
}

/** Gewicht in Kilogramm (Bericht: „kilograms“ oder „pounds“). */
export function inKg(wert: number | null, einheit: string | null | undefined): number | null {
  if (wert === null || !Number.isFinite(wert)) return null;
  const e = (einheit ?? "").toLowerCase();
  if (/kilo|kg/.test(e)) return r2(wert);
  if (/pound|lb/.test(e)) return r2(wert * 0.453592);
  if (/gram|^g$/.test(e)) return r2(wert / 1000);
  return r2(wert);
}

/** Übergroß laut Größenklasse („Oversize“, „Übergröße“, „Large Bulky“ …) oder längster Seite. */
export function istUebergross(groesse: string | null | undefined, laengsteSeiteCm: number | null | undefined): boolean {
  if (groesse && /over\s*-?size|übergr|uebergr|bulky|sperrig|surdimension|sovradimension|sobredimension|voluminoso/i.test(groesse)) return true;
  return laengsteSeiteCm !== null && laengsteSeiteCm !== undefined && laengsteSeiteCm > UEBERGROSS_AB_CM;
}

export type LagerMarge = { gebuehrJeStueckMonat: number; monateBisVerkauf: number; kostenBisVerkauf: number; gewinnJeStueck: number; anteil: number; frisstMarge: boolean; text: string };

/**
 * Lagergebühr je Stück bis zum Verkauf (Gebühr je Stück und Monat × Monate Reichweite, mindestens 1) gegen den
 * Gewinn je Stück. Ohne positive Zahlen kein Ergebnis (dann entscheiden Rendite/Reichweite).
 */
export function lagerMarge(o: { gebuehrJeStueckMonat: number | null; gewinnJeStueck: number | null; reichweiteTage: number | null }): LagerMarge | null {
  const g = o.gebuehrJeStueckMonat;
  const p = o.gewinnJeStueck;
  if (g === null || g <= 0 || p === null || p <= 0) return null;
  const monate = o.reichweiteTage === null || o.reichweiteTage >= 9999 ? 12 : Math.min(24, Math.max(1, o.reichweiteTage / 30));
  const kosten = r2(g * monate);
  const anteil = Math.round((kosten / p) * 100) / 100;
  const frisstMarge = anteil >= MARGE_ANTEIL;
  const text = `Lagergebühr frisst Marge: ca. ${zahlText(kosten)} € je Stück bis zum Verkauf (${zahlText(g)} €/Monat, ${Math.round(monate * 10) / 10} Monate) bei ${zahlText(p)} € Gewinn je Stück (${Math.round(anteil * 100)} %)`;
  return { gebuehrJeStueckMonat: r2(g), monateBisVerkauf: Math.round(monate * 10) / 10, kostenBisVerkauf: kosten, gewinnJeStueck: r2(p), anteil, frisstMarge, text };
}

/** „Remission prüfen“: übergroß oder viel Volumen, langsam drehend, spürbare Lagergebühr. */
export function remissionPruefen(o: { uebergross: boolean; volumenM3: number | null; gebuehrMonat: number; reichweiteTage: number | null }): string | null {
  const langsam = o.reichweiteTage === null || o.reichweiteTage >= REMISSION_REICHWEITE_TAGE;
  const gross = o.uebergross || (o.volumenM3 ?? 0) >= 0.1;
  if (!langsam || !gross || o.gebuehrMonat < REMISSION_AB_EUR_MONAT) return null;
  const warum = [o.uebergross ? "übergroß" : `${Math.round((o.volumenM3 ?? 0) * 100) / 100} m³ Lagervolumen`, o.reichweiteTage === null || o.reichweiteTage >= 9999 ? "keine Verkäufe" : `Reichweite ${Math.round(o.reichweiteTage)} Tage`, `${zahlText(o.gebuehrMonat)} € Lagergebühr/Monat`];
  return `Remission prüfen (${warum.join(", ")})`;
}

/** sellerboard-Fixkosten, die Lagergebühren sind (Name enthält „Lager“/„Storage“), als Monatsbetrag. */
export function sellerboardLagerFixkosten(posten: { beschreibung: string | null; betrag: number; rhythmus: string | null }[]): { summeMonat: number; posten: string[] } | null {
  const lager = posten.filter((p) => p.beschreibung && /lager|storage/i.test(p.beschreibung));
  if (!lager.length) return null;
  const jeMonat = (p: (typeof lager)[number]) => {
    const r = (p.rhythmus ?? "").toLowerCase();
    const b = Math.abs(p.betrag);
    if (/year|jahr|annual/.test(r)) return b / 12;
    if (/quarter|quartal/.test(r)) return b / 3;
    if (/week|woche/.test(r)) return (b * 52) / 12;
    return b;
  };
  return { summeMonat: r2(lager.reduce((n, p) => n + jeMonat(p), 0)), posten: lager.map((p) => p.beschreibung!) };
}

/** Buchungstexte der Amazon-Abrechnung für die monatliche Lagergebühr (ohne Langzeit-/Remissionsgebühren). */
export const istMonatsLagergebuehrText = (t: string | null | undefined) => !!t && /storage|lagergeb/i.test(t) && !/long[\s-]*term|langzeit|removal|remission|disposal|entsorg/i.test(t);

/** Monat, in dem Amazon die Lagergebühr eines Monats abrechnet (Folgemonat). */
export function abrechnungsMonat(monat: string): string {
  const [j, m] = monat.split("-").map(Number);
  const d = new Date(Date.UTC(j, m, 1));
  return d.toISOString().slice(0, 7);
}
