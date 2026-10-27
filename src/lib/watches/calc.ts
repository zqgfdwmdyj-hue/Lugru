// Uhren Buy & Flip: Rechnen ohne Datenbank (Rechner, Deals, Auswertung, Lern-Quiz). Reine Logik, testbar.
//
// Steuerarten (vereinfacht, keine Steuerberatung):
// - „privat“: gelegentlicher Privatverkauf oder Kleinunternehmer (§ 19 UStG) – keine Umsatzsteuer.
// - „differenz“: Händler, gebrauchte Uhr ohne Vorsteuer gekauft (z. B. von Privat) – § 25a UStG: Umsatzsteuer
//   nur auf die Differenz Verkaufs- minus Einkaufspreis, aus dem Bruttobetrag herausgerechnet. Nebenkosten
//   (Revision, Aufbereitung) mindern die Differenz nicht; bei Verlust keine Steuer, aber keine Verrechnung.
// - „regel“: Händler, mit ausgewiesener Umsatzsteuer gekauft (z. B. neue Uhr vom Händler) – Umsatzsteuer auf
//   den vollen Verkaufspreis, Vorsteuer aus dem Einkauf wird abgezogen (Zahllast = Differenz der Steuern).
// Gebühren und Nebenkosten zählen so, wie sie bezahlt wurden (eine mögliche Vorsteuer daraus ist bewusst
// nicht abgezogen – vorsichtig gerechnet). Einkommen- und Gewerbesteuer sind nicht enthalten.

export type TaxMode = "privat" | "differenz" | "regel";
export const TAX_MODES: TaxMode[] = ["privat", "differenz", "regel"];
export const TAX_LABEL: Record<TaxMode, string> = {
  privat: "Ohne Umsatzsteuer (privat / Kleinunternehmer)",
  differenz: "Differenzbesteuerung (§ 25a – gebraucht, ohne Vorsteuer gekauft)",
  regel: "Regelbesteuerung (mit Rechnung inkl. USt gekauft, z. B. neu vom Händler)",
};
export const TAX_SHORT: Record<TaxMode, string> = { privat: "ohne USt", differenz: "§ 25a Differenz", regel: "Regelbesteuerung" };

export type FlipInput = {
  mode: TaxMode;
  /** Ankaufspreis, wie bezahlt (brutto). */
  buy: number;
  /** Nebenkosten (Revision, Aufbereitung, Echtheitsprüfung, Anreise …), wie bezahlt. */
  costs?: number;
  /** Verkaufspreis, den der Käufer zahlt (brutto). */
  sell: number;
  /** Plattform-/Zahlungsgebühr in % vom Verkaufspreis und fester Betrag je Verkauf. */
  feePct?: number;
  feeFixed?: number;
  /** Versand an den Käufer (versichert), wenn du ihn trägst. */
  shipping?: number;
  vatRate?: number;
  /** Standzeit in Tagen (Ankauf bis Verkauf) für die Rendite je Monat. */
  days?: number | null;
};

export type FlipResult = {
  fees: number;
  /** Umsatzsteuer, die du ans Finanzamt zahlst (bei Regelbesteuerung nach Abzug der Vorsteuer, kann negativ sein). */
  vat: number;
  /** Bemessungsgrundlage bei § 25a: Differenz brutto (Verkauf − Einkauf), nie unter 0. */
  margin25a: number;
  profit: number;
  /** Gewinn in % vom Verkaufspreis. */
  marginPct: number | null;
  /** Gewinn in % vom eingesetzten Geld (Ankauf + Nebenkosten). */
  roiPct: number | null;
  /** Rendite je 30 Tage Standzeit (nur mit Standzeit). */
  roiPerMonthPct: number | null;
  /** Gebundenes Geld: Ankauf + Nebenkosten. */
  capital: number;
  /** Verkaufspreis, ab dem du ohne Verlust rauskommst. */
  breakEven: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pos = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** Anteil der Umsatzsteuer an einem Bruttobetrag (19 % → 19/119). */
export const vatShare = (vatRate = 19) => vatRate / (100 + vatRate);

export function flipCalc(i: FlipInput): FlipResult {
  const buy = pos(i.buy);
  const sell = pos(i.sell);
  const costs = pos(i.costs);
  const shipping = pos(i.shipping);
  const feePct = Math.min(pos(i.feePct), 100);
  const feeFixed = pos(i.feeFixed);
  const q = vatShare(i.vatRate ?? 19);
  const fees = sell > 0 ? r2((sell * feePct) / 100 + feeFixed) : 0;
  const margin25a = Math.max(0, sell - buy);
  const vat = i.mode === "differenz" ? r2(margin25a * q) : i.mode === "regel" ? r2((sell - buy) * q) : 0;
  const profit = r2(sell - buy - costs - shipping - fees - vat);
  const capital = r2(buy + costs);
  const roiPct = capital > 0 ? r1((profit / capital) * 100) : null;
  const days = typeof i.days === "number" && i.days >= 0 ? Math.max(1, i.days) : null;
  return {
    fees,
    vat,
    margin25a: r2(margin25a),
    profit,
    marginPct: sell > 0 ? r1((profit / sell) * 100) : null,
    roiPct,
    roiPerMonthPct: roiPct !== null && days !== null ? r1((roiPct * 30) / days) : null,
    capital,
    breakEven: breakEven(i),
  };
}

/** Verkaufspreis, bei dem der Gewinn 0 ist. */
export function breakEven(i: Omit<FlipInput, "sell">): number {
  const f = Math.min(pos(i.feePct), 99.9) / 100;
  const other = pos(i.costs) + pos(i.shipping) + pos(i.feeFixed);
  const buy = pos(i.buy);
  if (i.mode === "privat") return r2((buy + other) / (1 - f));
  // § 25a und Regelbesteuerung: oberhalb des Einkaufs zahlt man q vom Mehrerlös.
  const q = vatShare(i.vatRate ?? 19);
  return r2((buy * (1 - q) + other) / (1 - f - q));
}

/**
 * Höchster Ankaufspreis für einen Ziel-Gewinn (rückwärts gerechnet). Ziel als Betrag in € oder in % vom
 * Verkaufspreis. Negativ = mit diesen Annahmen nicht machbar.
 */
export function maxBuy(i: Omit<FlipInput, "buy"> & { targetProfit?: number; targetPct?: number }): number {
  const sell = pos(i.sell);
  const fees = sell * (Math.min(pos(i.feePct), 100) / 100) + pos(i.feeFixed);
  const target = pos(i.targetProfit) + (sell * pos(i.targetPct)) / 100;
  const other = fees + pos(i.costs) + pos(i.shipping) + target;
  if (i.mode === "privat") return r2(sell - other);
  const q = vatShare(i.vatRate ?? 19);
  // Gewinn = (Verkauf − Ankauf)·(1 − q) − übrige Kosten  (für Ankauf ≤ Verkauf)
  return r2(sell - other / (1 - q));
}

/** Tage zwischen zwei Daten (JJJJ-MM-TT), sonst null. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}
