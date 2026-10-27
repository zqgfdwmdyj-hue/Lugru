// Gültiger EK und andere Quellen: eine Regel, wann ein fremder Wert (z. B. aus sellerboard) abweicht oder
// nur ein Platzhalter ist. Reine Logik – genutzt von Produkt, Nachbestellung, Repricer, Hebel und Gewinn.

import type { CostInfo } from "./profit-logic";

/** sellerboard trägt fehlende Einkaufspreise oft als 0,01 € ein – das ist kein echter EK. */
export const SB_PLACEHOLDER_MAX = 0.01;

export function isPlaceholderCost(cost: number | null | undefined): boolean {
  return cost !== null && cost !== undefined && Number.isFinite(cost) && cost <= SB_PLACEHOLDER_MAX;
}

/** Gleiche Schwelle wie die EK-Prüfung je SKU: mehr als 2 % (mindestens 1 Cent) auseinander. */
export function costsDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(0.01, Math.max(a, b) * 0.02);
}

export type OtherCost = { value: number; deviates: boolean; placeholder: boolean };

/**
 * Vergleicht einen anderen EK (z. B. laut sellerboard) mit dem gültigen. `deviates` nur, wenn der gültige
 * Wert aus einer anderen Quelle stammt – sonst ist es derselbe Wert.
 */
export function compareCost(valid: CostInfo | null | undefined, other: number | null | undefined, otherSource: CostInfo["source"] = "sellerboard"): OtherCost | null {
  if (other === null || other === undefined || !Number.isFinite(other)) return null;
  const placeholder = isPlaceholderCost(other);
  if (!valid || valid.source === otherSource) return { value: other, deviates: false, placeholder };
  return { value: other, deviates: placeholder || costsDiffer(valid.cost, other), placeholder };
}

/** Retouren-SKU (Schema RET_CODE_LPN_DATUM_KANAL bzw. ältere RET_…): einzelne zurückgekommene Einheit. */
export function isReturnSku(sku: string | null | undefined): boolean {
  return Boolean(sku && /^RET_/i.test(sku.trim()));
}
