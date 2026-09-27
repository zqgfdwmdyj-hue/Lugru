// Mindest- und Maximalpreis je SKU für den Repricer.
//
// Verkaufspreis P (brutto) muss decken: EK + FBA-Gebühr + Mindestgewinn.
// Netto-Erlös = P / (1 + MwSt) − P × Provision − FBA-Gebühr
// ⇒ P_min = (EK + FBA + Mindestgewinn) / (1 / (1 + MwSt) − Provision)

export type PriceInput = {
  unitCost: number;
  fbaFee: number;
  referralRate: number;
  vatRate: number;
  minProfit: number;
  maxFactor: number;
  targetPrice?: number | null;
};

export function minMaxPrice(p: PriceInput): { min: number; max: number } | null {
  const divisor = 1 / (1 + p.vatRate) - p.referralRate;
  if (divisor <= 0) return null;
  const min = Math.ceil(((p.unitCost + p.fbaFee + p.minProfit) / divisor) * 100) / 100;
  const max = Math.round(Math.max(min * p.maxFactor, p.targetPrice ?? 0) * 100) / 100;
  return { min, max: Math.max(max, min) };
}

/** Gewinn je Einheit bei einem Verkaufspreis. */
export function profitAt(price: number, p: Omit<PriceInput, "minProfit" | "maxFactor">) {
  return Math.round((price / (1 + p.vatRate) - price * p.referralRate - p.fbaFee - p.unitCost) * 100) / 100;
}
