import { describe, expect, it } from "vitest";
import { minMaxPrice, profitAt } from "@/lib/pricing";

describe("Mindestpreis", () => {
  const base = { unitCost: 10, fbaFee: 3, referralRate: 0.15, vatRate: 0.19, minProfit: 1, maxFactor: 2 };
  it("deckt EK, Gebühren und Mindestgewinn", () => {
    const r = minMaxPrice(base)!;
    expect(r.min).toBeCloseTo(20.28, 2);
    expect(profitAt(r.min, base)).toBeGreaterThanOrEqual(1);
    expect(profitAt(r.min - 0.05, base)).toBeLessThan(1);
    expect(r.max).toBeCloseTo(40.56, 2);
  });
  it("Maximalpreis mindestens Ziel-VK", () => {
    expect(minMaxPrice({ ...base, targetPrice: 60 })!.max).toBe(60);
  });
});
