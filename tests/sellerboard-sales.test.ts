import { describe, expect, it } from "vitest";
import { dayBatches, mapKpis, mapTop, sumKpis, tilePeriods } from "@/lib/sellerboard/parse";

// Verkaufs-Kennzahlen aus sellerboard (Startseite): Zeiträume, Kennzahlen, Top-Produkte. Fiktive Daten.

const u = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

describe("tilePeriods", () => {
  it("heute, gestern, Monat bis heute, letzter Monat – als UTC-Tage", () => {
    const p = tilePeriods("2026-10-26");
    expect(p.map((x) => [x.key, x.fromDay, x.toDay])).toEqual([
      ["heute", "2026-10-26", "2026-10-26"],
      ["gestern", "2026-10-25", "2026-10-25"],
      ["monat", "2026-10-01", "2026-10-26"],
      ["vormonat", "2026-09-01", "2026-09-30"],
    ]);
    expect(p[0].start).toBe(u("2026-10-26"));
    expect(p[0].start % 86400).toBe(0);
  });
  it("Monatsanfang und Jahreswechsel", () => {
    const p = tilePeriods("2027-01-01");
    expect(p[1].fromDay).toBe("2026-12-31");
    expect([p[2].fromDay, p[2].toDay]).toEqual(["2027-01-01", "2027-01-01"]);
    expect([p[3].fromDay, p[3].toDay]).toEqual(["2026-12-01", "2026-12-31"]);
    expect(tilePeriods("2028-03-01")[3].toDay).toBe("2028-02-29");
  });
});

describe("dayBatches", () => {
  it("30 Tage in Paketen zu höchstens 12, ältester zuerst, letzter = heute", () => {
    const b = dayBatches("2026-10-26", 30);
    expect(b.map((x) => x.length)).toEqual([12, 12, 6]);
    expect(b[0][0].start).toBe(u("2026-09-27"));
    expect(b[2][5]).toEqual({ start: u("2026-10-26"), end: u("2026-10-26") });
  });
});

describe("mapKpis", () => {
  it("liest die Kachel-Werte und den Hinweis auf fehlende Einkaufspreise", () => {
    const reply = {
      status: "success",
      result: [
        { start: u("2026-10-26"), end: u("2026-10-26"), data: { Info: { Sales: 2751.5, Orders: 62, Units: 64, Refunds: 0, Advertising: 0, EstPayout: 2189.9, GrossProfit: 276.08, NetProfit: 276.08 }, Exclamations: { exclamation_product_cost: false } } },
        { start: u("2026-10-25"), end: u("2026-10-25"), data: { Info: { Sales: 184.5, Orders: 7, Units: 9, Refunds: 0, Advertising: -27.08, EstPayout: 128.51, GrossProfit: 99.71, NetProfit: 99.71 }, Exclamations: { exclamation_product_cost: true } } },
        { start: u("2026-10-24"), end: u("2026-10-24"), data: {} },
      ],
    };
    const k = mapKpis(reply);
    expect(k).toHaveLength(2);
    expect(k[0]).toMatchObject({ fromDay: "2026-10-26", toDay: "2026-10-26", sales: 2751.5, orders: 62, units: 64, refunds: 0, advertising: 0, payout: 2189.9, grossProfit: 276.08, netProfit: 276.08, missingCost: false });
    expect(k[1]).toMatchObject({ advertising: -27.08, missingCost: true });
  });
});

describe("sumKpis", () => {
  it("Amazon + eBay wie in sellerboard „alle Kanäle“", () => {
    const s = sumKpis([
      { sales: 2577.95, orders: 83, units: 89, refunds: 2, advertising: 0, payout: 1617.5, grossProfit: -8.96, netProfit: -8.96, missingCost: false },
      { sales: 184.5, orders: 7, units: 9, refunds: 0, advertising: -27.08, payout: 128.51, grossProfit: 99.71, netProfit: 99.71, missingCost: true },
    ]);
    expect(s.sales).toBeCloseTo(2762.45, 2);
    expect([s.orders, s.units, s.refunds]).toEqual([90, 98, 2]);
    expect(s.advertising).toBeCloseTo(-27.08, 2);
    expect(s.grossProfit).toBeCloseTo(90.75, 2);
    expect(s.missingCost).toBe(true);
    expect(sumKpis([])).toMatchObject({ sales: 0, units: 0, missingCost: false });
  });
});

describe("mapTop", () => {
  it("Amazon- und eBay-Zeilen, eBay-Variante im Namen, nur https-Bilder und -Links", () => {
    const amazon = mapTop({ result: [{ Info: { Name: "Testgel 150 ml", SKU: "T-1", Image: "https://img.example/a.jpg", LinkToAmazon: "https://amazon.example/dp/X", Units: 10, Refunds: 0, Sales: 86.29, NetProfit: 9.9 } }] });
    expect(amazon[0]).toEqual({ name: "Testgel 150 ml", sku: "T-1", image: "https://img.example/a.jpg", link: "https://amazon.example/dp/X", units: 10, refunds: 0, sales: 86.29, netProfit: 9.9 });
    const ebay = mapTop({ result: [{ Info: { Name: "Socken", variant_name: "Größe L", SKU: "E-1", Image: "javascript:alert(1)", Link: "http://ebay.example/1", Units: 9, Sales: 184.5, NetProfit: 99.71 } }] });
    expect(ebay[0]).toMatchObject({ name: "Socken (Größe L)", image: null, link: null, units: 9, refunds: 0 });
  });
});
