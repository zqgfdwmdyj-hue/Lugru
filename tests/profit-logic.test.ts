import { describe, expect, it } from "vitest";
import { mergeCosts, stockValue, summarizeAmazon, summarizeChannels, totalsOf, type OrderLine } from "@/lib/money/profit-logic";

// Kennzahlen ehrlich rechnen: fehlende EK, Gebühren und Preise nie als 0 €. Fiktive Daten.

const line = (p: Partial<OrderLine>): OrderLine => ({ orderId: "o1", externalId: "E-1", channel: "ebay", orderDate: "2026-10-10", sku: "SKU-A", title: "Testartikel", qty: 1, price: 11.9, orderFees: null, ...p });

describe("EK-Quellen", () => {
  it("Charge vor EK je SKU vor eBay-Tool; leere und negative Werte zählen nicht", () => {
    const m = mergeCosts(["charge", [["A", 5], ["B", null]]], ["manuell", [["B", 4], ["C", 3]]], ["ebay", [["A", 9], ["C", 1], ["D", 2], ["E", -1], [" ", 1]]]);
    expect(m.get("A")).toEqual({ cost: 5, source: "charge" });
    expect(m.get("B")).toEqual({ cost: 4, source: "manuell" });
    expect(m.get("C")).toEqual({ cost: 3, source: "manuell" });
    expect(m.get("D")).toEqual({ cost: 2, source: "ebay" });
    expect(m.has("E")).toBe(false);
  });
});

describe("Kanäle", () => {
  it("eBay ohne EK und ohne Gebühr: Umsatz ja, Gewinn nicht vollständig", () => {
    const [s] = summarizeChannels([line({}), line({ orderId: "o2", externalId: "E-2", sku: "SKU-B" })], new Map(), 0.19);
    expect(s.revenueNet).toBe(20);
    expect(s.missingCost).toBe(2);
    expect(s.missingFeeOrders).toBe(2);
    expect(s.cogsKnown).toBe(0);
    expect(s.completeRevenueNet).toBe(0);
    expect(s.completeProfit).toBe(0);
    expect(s.provisional).toBe(20);
    expect(s.missingCostSkus).toEqual(["SKU-A", "SKU-B"]);
  });
  it("vollständige Position: Umsatz − EK − Gebühr (anteilig je Position)", () => {
    const costs = new Map([["SKU-A", { cost: 4, source: "charge" as const }], ["SKU-B", { cost: 2, source: "ebay" as const }]]);
    const [s] = summarizeChannels([line({ orderFees: 3, price: 23.8 }), line({ sku: "SKU-B", orderFees: 3, price: 11.9 })], costs, 0.19);
    // Umsatz netto 20 + 10, Gebühr 3 → 2 / 1 anteilig
    expect(s.completeRevenueNet).toBe(30);
    expect(s.completeProfit).toBe(30 - 4 - 2 - 3);
    expect(s.provisional).toBe(30 - 6 - 3);
    expect(s.missingFeeOrders).toBe(0);
  });
  it("Temu: keine eigene Gebühr; Position ohne Preis wird gezählt, nicht als 0-€-Umsatz versteckt", () => {
    const costs = new Map([["T-1", { cost: 3, source: "charge" as const }]]);
    const [s] = summarizeChannels([line({ channel: "temu", sku: "T-1", price: null }), line({ channel: "temu", orderId: "o9", sku: "T-1", price: 11.9 })], costs, 0.19);
    expect(s.missingFeeOrders).toBe(0);
    expect(s.missingPrice).toBe(1);
    expect(s.revenueNet).toBe(10);
    expect(s.completeProfit).toBe(7);
  });
});

describe("Summen", () => {
  it("Abdeckung und „vollständig“ nur, wenn nichts fehlt", () => {
    const costs = new Map([["SKU-A", { cost: 4, source: "charge" as const }]]);
    const ch = summarizeChannels([line({ orderFees: 1 }), line({ orderId: "o2", sku: "SKU-X" })], costs, 0.19);
    const am = summarizeAmazon([{ sku: "AMZ-1", units: 2, revenueNet: 40, costsExCogs: -10, cogs: 12 }, { sku: "AMZ-2", units: 1, revenueNet: 30, costsExCogs: -6, cogs: null }], -5);
    const t = totalsOf(am, ch);
    expect(t.revenueNet).toBe(90);
    expect(t.complete).toBe(false);
    expect(t.missing.costSkus).toBe(2); // SKU-X und AMZ-2
    expect(t.missing.feeOrders).toBe(1);
    // vollständig: Amazon AMZ-1 (40 − 10 − 12) − 5 + eBay o1 (10 − 4 − 1)
    expect(t.completeProfit).toBe(13 + 5); // Amazon AMZ-1 (40 − 10 − 12) − 5 ohne SKU + eBay o1 (10 − 4 − 1)
    expect(t.completeRevenueNet).toBe(50);
    expect(t.coverage).toBe(56);
    // vorläufig: Amazon (70 − 16 − 12 − 5) + eBay (20 − 4 − 1)
    expect(t.provisional).toBe(37 + 15);
  });
  it("ohne Daten: nicht „vollständig“ mit 0 €, sondern Abdeckung 100 bei nichts Fehlendem", () => {
    const t = totalsOf(null, []);
    expect(t.complete).toBe(true);
    expect(t.revenueNet).toBe(0);
  });
});

describe("Lagerwert", () => {
  it("bewertet, unbewertet und negative Bestände getrennt; negativ wird nicht abgezogen", () => {
    const costs = new Map([["A", { cost: 2, source: "charge" as const }], ["N", { cost: 5, source: "charge" as const }]]);
    const v = stockValue(
      [
        { sku: "A", units: 10, own: 5 },
        { sku: "B", units: 0, own: 7 },
        { sku: "N", units: 0, own: -3 },
      ],
      costs,
    );
    expect(v.valued).toBe(30);
    expect(v.valuedUnits).toBe(15);
    expect(v.unvaluedUnits).toBe(7);
    expect(v.unvaluedSkus).toEqual(["B"]);
    expect(v.negative).toEqual([{ sku: "N", units: -3 }]);
    expect(v.negativeUnits).toBe(-3);
  });
});
