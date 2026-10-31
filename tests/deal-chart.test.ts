import { describe, expect, it } from "vitest";
import { miniChart, type VerlaufZeile } from "@/lib/deal-eingang/chart-logic";

// Keepa-Mini-Chart der Deal-Eingang-Detailseite mit erfundenem Verlauf.

const tag = (n: number) => new Date(Date.parse("2026-10-31T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);

describe("Keepa-Mini-Chart", () => {
  it("nur die letzten 90 Tage, Ø/Tief/Hoch/aktuell, Pfad im Rahmen, Amazon getrennt", () => {
    const v: VerlaufZeile[] = [[tag(200), 99, null, 5, 1000], [tag(80), 20, 25, 8, 1000], [tag(40), 30, null, 9, 900], [tag(0), 25, 26, 10, 800]];
    const c = miniChart(v, { bis: "2026-10-31", breite: 100, hoehe: 50 })!;
    expect(c).toMatchObject({ min: 20, max: 30, schnitt: 25, letzter: 25, von: tag(80), bis: tag(0), tage: 90 });
    const zahlen = c.pfad.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...zahlen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...zahlen)).toBeLessThanOrEqual(100);
    expect(c.pfad.startsWith("M")).toBe(true);
    expect(c.amazonPfad).toMatch(/^M.* L/);
  });
  it("weniger als 2 Buy-Box-Werte im Zeitraum → kein Chart", () => {
    expect(miniChart([[tag(200), 10, null, null, null], [tag(5), 12, null, null, null]], { bis: "2026-10-31" })).toBeNull();
    expect(miniChart([], { bis: "2026-10-31" })).toBeNull();
  });
});
