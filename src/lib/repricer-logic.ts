// Repricer: was sich prüfen lässt und was geschätzt ist. Reine Logik, testbar.

export type CoverageRow = { price: number | null; min: number | null; feeEstimated: boolean; refEstimated: boolean };

export type RepricerCoverage = {
  total: number;
  /** Aktueller Preis und Mindestpreis vorhanden – nur diese lassen sich „unter Mindestpreis“ prüfen. */
  checkable: number;
  below: number;
  noPrice: number;
  noMin: number;
  /** Mindestpreis beruht auf geschätzter FBA-Gebühr und/oder pauschaler Provision. */
  estimated: number;
  /** Mindestpreis mit echten Gebühren (Gebührenvorschau). */
  exact: number;
};

export const isEstimated = (r: Pick<CoverageRow, "feeEstimated" | "refEstimated">) => r.feeEstimated || r.refEstimated;

export function repricerCoverage(rows: CoverageRow[]): RepricerCoverage {
  const withMin = rows.filter((r) => r.min !== null);
  const checkable = rows.filter((r) => r.min !== null && r.price !== null);
  return {
    total: rows.length,
    checkable: checkable.length,
    below: checkable.filter((r) => r.price! < r.min!).length,
    noPrice: rows.filter((r) => r.price === null).length,
    noMin: rows.length - withMin.length,
    estimated: withMin.filter(isEstimated).length,
    exact: withMin.filter((r) => !isEstimated(r)).length,
  };
}
