import { describe, expect, it } from "vitest";
import { isEstimated, repricerCoverage } from "@/lib/repricer-logic";

// Repricer: Abdeckung statt „0 unter Mindestpreis“ – erfundene Zeilen.
describe("Repricer-Abdeckung", () => {
  const r = (price: number | null, min: number | null, feeEstimated = false, refEstimated = false) => ({ price, min, feeEstimated, refEstimated });
  it("ohne Preise: nichts prüfbar statt 0", () => {
    const c = repricerCoverage([r(null, 10), r(null, 12, true), r(null, null)]);
    expect(c).toMatchObject({ total: 3, checkable: 0, below: 0, noPrice: 3, noMin: 1, estimated: 1, exact: 1 });
  });
  it("zählt nur prüfbare Zeilen und trennt geschätzte Mindestpreise", () => {
    const c = repricerCoverage([r(9, 10), r(11, 10, true), r(null, 10, false, true), r(15, null)]);
    expect(c).toMatchObject({ total: 4, checkable: 2, below: 1, noPrice: 1, noMin: 1, estimated: 2, exact: 1 });
    expect(isEstimated({ feeEstimated: false, refEstimated: true })).toBe(true);
  });
});
