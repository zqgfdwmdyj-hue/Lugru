// Retouren (RET_…-SKUs) stehen in Arbitrage One mit 0,01 € EK. Tatsächlich ist es dieselbe
// Einheit wie beim ursprünglichen Einkauf, also erbt die Retoure dessen EK.
//
// Regel: Unter den Einkaufs-Chargen derselben ASIN gewinnt die letzte, die vor oder am
// Retourendatum gekauft wurde. Gibt es keine davor, die früheste danach (Datum unsicher).

/** Arbitrage One setzt bei Retouren 0,01 € bzw. 0,10 € brutto als Platzhalter-EK. */
export const PLACEHOLDER_COST_MAX = 0.1;

export type PurchaseCandidate = {
  id: string;
  purchaseDate: string | null;
  unitCostNet: number | null;
};

export type InheritResult =
  | { lotId: string; unitCostNet: number; basis: "single" | "dated" | "fallback" }
  | null;

export function pickOriginLot(
  returnDate: string | null,
  candidates: PurchaseCandidate[],
): InheritResult {
  const usable = candidates.filter(
    (c): c is PurchaseCandidate & { unitCostNet: number } =>
      c.unitCostNet !== null && c.unitCostNet > PLACEHOLDER_COST_MAX,
  );
  if (usable.length === 0) return null;
  if (usable.length === 1) {
    return { lotId: usable[0].id, unitCostNet: usable[0].unitCostNet, basis: "single" };
  }

  const dated = usable
    .filter((c) => c.purchaseDate !== null)
    .sort((a, b) => (a.purchaseDate! < b.purchaseDate! ? -1 : 1));

  if (returnDate && dated.length > 0) {
    const before = dated.filter((c) => c.purchaseDate! <= returnDate);
    if (before.length > 0) {
      const c = before[before.length - 1];
      return { lotId: c.id, unitCostNet: c.unitCostNet, basis: "dated" };
    }
    const c = dated[0];
    return { lotId: c.id, unitCostNet: c.unitCostNet, basis: "fallback" };
  }

  const c = dated.length > 0 ? dated[dated.length - 1] : usable[usable.length - 1];
  return { lotId: c.id, unitCostNet: c.unitCostNet, basis: "fallback" };
}
