import { roundCents, roundTo } from './money';

/**
 * Gewinn aus einem Verkauf. Der Verkaufspreis ist brutto, wie er im Angebot
 * steht — die darin enthaltene Umsatzsteuer schuldet man dem Finanzamt und
 * geht deshalb ab. Einkauf, Provision und Versand werden netto abgezogen,
 * ihre Vorsteuer ist abziehbar.
 *
 * Das ist eine Kalkulationshilfe, keine Buchhaltung: Verpackung, Rücksendungen
 * und die tatsächliche eBay-Provision fehlen.
 */
export interface Profit {
  /** Verkaufspreis brutto, wie er im Angebot steht. */
  salePrice: number;
  /** Im Verkaufspreis enthaltene Umsatzsteuer; fehlt ohne hinterlegten Satz. */
  vat?: number;
  /** Einkaufspreis je Stück, netto. */
  purchasePrice: number;
  /** Geschätzte eBay-Verkaufsprovision. */
  fee: number;
  /** Eigene Versandkosten je Verkauf, netto. */
  shipping: number;
  /** Was übrig bleibt. */
  profit: number;
  /** Gewinn bezogen auf den Bruttoverkaufspreis, eine Nachkommastelle. */
  profitPercent: number;
}

export function computeProfit(input: {
  salePrice: number;
  purchasePrice?: number;
  fee: number;
  shipping?: number;
  vatPercentage?: number;
}): Profit | null {
  const { salePrice, purchasePrice, fee, shipping = 0, vatPercentage } = input;
  if (!purchasePrice || purchasePrice <= 0) return null;
  if (!salePrice || salePrice <= 0) return null;

  // Aus dem Bruttopreis herausgerechnet: bei 19 % sind das 19/119.
  const vat =
    vatPercentage && vatPercentage > 0
      ? roundCents((salePrice * vatPercentage) / (100 + vatPercentage))
      : undefined;

  // Bewusst aus den gerundeten Posten: die angezeigte Aufstellung muss aufgehen.
  const lines = {
    salePrice: roundCents(salePrice),
    purchasePrice: roundCents(purchasePrice),
    fee: roundCents(fee),
    shipping: roundCents(shipping),
  };
  const profit = roundCents(lines.salePrice - (vat ?? 0) - lines.purchasePrice - lines.fee - lines.shipping);

  return {
    ...lines,
    vat,
    profit,
    profitPercent: roundTo((profit / lines.salePrice) * 100, 1),
  };
}
