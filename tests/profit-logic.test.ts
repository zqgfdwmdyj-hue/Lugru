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

describe("B15.4: Amazon-Zeile und Quelle je Zeile", () => {
  it("USt. eigens ausgewiesen: Principal ist netto, USt. kein Ertrag; einbehaltene Steuer kein Aufwand", async () => {
    const { abrechnungNetto } = await import("@/lib/money/profit-logic");
    // erfunden: 1.000 € netto + 190 € USt., Gebühren −300 €
    const mitUst = abrechnungNetto({ revenue: 1000, collectedTax: 190, taxLines: 4, withheldTax: 0, fees: -300, promotions: 0, reimb: 0, total: 890 }, 0.19);
    expect(mitUst.revenueNet).toBe(1000);
    expect(mitUst.costsExCogs).toBe(-300);
    expect(mitUst.revenueNet + mitUst.costsExCogs).toBe(700);
    // ohne USt.-Zeilen: Principal brutto → ÷ 1,19; einbehaltene Steuer (UK) wird nicht doppelt abgezogen
    const brutto = abrechnungNetto({ revenue: 1190, collectedTax: 0, taxLines: 0, withheldTax: -50, fees: -300, promotions: -11.9, reimb: 20, total: 848.1 }, 0.19);
    expect(brutto.revenueNet).toBeCloseTo(1000, 6);
    expect(brutto.promotionsNet).toBeCloseTo(-10, 6);
    expect(brutto.other).toBeCloseTo(0, 6);
    expect(brutto.costsExCogs).toBeCloseTo(-290, 6);
  });

  it("Rücklagen und Kartenabbuchungen sind Geldbewegungen, Lager- und Werbekosten nicht", async () => {
    const { istGeldbewegung } = await import("@/lib/money/profit-logic");
    expect(istGeldbewegung("Previous Reserve Amount Balance", "other-transaction")).toBe(true);
    expect(istGeldbewegung("Current Reserve Amount", null)).toBe(true);
    expect(istGeldbewegung("Successful charge", "other-transaction")).toBe(true);
    expect(istGeldbewegung("Payable to Amazon", null)).toBe(true);
    expect(istGeldbewegung("Storage Fee", "other-transaction")).toBe(false);
    expect(istGeldbewegung("Cost of Advertising", "ServiceFee")).toBe(false);
    expect(istGeldbewegung("FBA Inbound Transportation Fee", null)).toBe(false);
  });

  it("Quelle: Abrechnung deckt Zeitraum → Abrechnung; sonst sellerboard; ohne sellerboard Hinweis", async () => {
    const { amazonQuelle } = await import("@/lib/money/profit-logic");
    expect(amazonQuelle({ abrechnungBis: "2026-10-31", bis: "2026-10-31", hatAbrechnung: true, sb: { complete: true } })).toMatchObject({ art: "abrechnung", unvollstaendig: false });
    expect(amazonQuelle({ abrechnungBis: "2026-10-16", bis: "2026-10-30", hatAbrechnung: true, sb: { complete: true } })).toEqual({ art: "sellerboard", text: "sellerboard – Amazon-Abrechnung bis 16.10.", unvollstaendig: false });
    expect(amazonQuelle({ abrechnungBis: "2026-10-16", bis: "2026-10-30", hatAbrechnung: true, sb: { complete: false } })).toMatchObject({ art: "abrechnung", unvollstaendig: true });
    expect(amazonQuelle({ abrechnungBis: null, bis: "2026-10-30", hatAbrechnung: false, sb: null })).toMatchObject({ art: "keine" });
  });

  it("Summen mit sellerboard-Ersatz: Amazon-Teil ersetzt, andere Kanäle bleiben", async () => {
    const { mitAmazonErsatz } = await import("@/lib/money/profit-logic");
    const e = mitAmazonErsatz({ revenueNet: 1500, provisional: 600 }, { revenueNet: 1000, provisional: 379 }, { sales: 2380, netProfit: -525 }, 0.19);
    expect(e).toEqual({ amazonRevenueNet: 2000, amazonResult: -525, revenueNet: 2500, provisional: -304 });
  });
});

describe("B19.3: eine Quelle für Kopf und Überleitung", () => {
  it("Amazon aus sellerboard: Kopf, Überleitung und „vollständig“ rechnen mit denselben Zahlen", async () => {
    const { gewinnBasis, mitAmazonErsatz, ueberleitung } = await import("@/lib/money/profit-logic");
    // erfundene Zahlen: Abrechnung bis Monatsmitte 1.000 € netto, eBay 500 € netto; sellerboard Amazon 2.380 € brutto
    const amazon = { revenueNet: 1000, provisional: 379, completeRevenueNet: 1000, completeProfit: 379, missingCostSkus: [], missingCostRevenue: 0 };
    const tot = { revenueNet: 1500, provisional: 600, completeProfit: 550, completeRevenueNet: 1400, coverage: 93, complete: false, missing: { costSkus: 0, costLines: 1, feeOrders: 0, priceLines: 0 } };
    const ersatz = mitAmazonErsatz(tot, amazon, { sales: 2380, netProfit: 420 }, 0.19);
    const b = gewinnBasis(tot, amazon, ersatz, true);
    expect(b).toMatchObject({ revenueNet: 2500, provisional: 641, amazonAus: "sellerboard" });
    // vollständig: eBay-Anteil (1.400 − 1.000 = 400 € Umsatz, 550 − 379 = 171 € Gewinn) + sellerboard Amazon (2.000 € / 420 €)
    expect(b.completeRevenueNet).toBe(2400);
    expect(b.completeProfit).toBe(591);
    expect(b.coverage).toBe(96);
    const u = ueberleitung({ vatRate: 0.19, sbAmazon: { sales: 2380, netProfit: 420, grossProfit: 600 }, sbEbay: { sales: 595, netProfit: 90, grossProfit: 100 }, amazon: { revenueNet: ersatz.amazonRevenueNet, ergebnis: ersatz.amazonResult, aus: "sellerboard", text: "sellerboard – Amazon-Abrechnung bis 15.10." }, kanaele: [{ channel: "ebay", label: "eBay", revenueNet: 500, provisional: 221 }] });
    const am = u.zeilen.find((z) => z.kanal === "Amazon")!;
    expect(am).toMatchObject({ sbNetto: 2000, sysNetto: 2000, diffNetto: 0, diffErgebnis: 0 });
    expect(am.hinweis).toMatch(/gleiche Quelle/);
    expect(u.zeilen.find((z) => z.kanal === "eBay")).toMatchObject({ sbNetto: 500, sysNetto: 500, diffNetto: 0, sbGewinn: 90, sysErgebnis: 221, diffErgebnis: -131 });
    // Summe „diese Seite“ = Kopf
    expect(u.summe.sysNetto).toBe(b.revenueNet);
    expect(u.summe.sysErgebnis).toBe(b.provisional);
  });

  it("Abrechnung deckt den Zeitraum: Basis = Abrechnung; Temu steht nur im Seller-System", async () => {
    const { gewinnBasis, ueberleitung } = await import("@/lib/money/profit-logic");
    const tot = { revenueNet: 1200, provisional: 300, completeProfit: 280, completeRevenueNet: 1150, coverage: 96, complete: false, missing: { costSkus: 1, costLines: 1, feeOrders: 0, priceLines: 0 } };
    const amazon = { revenueNet: 1000, provisional: 250, completeRevenueNet: 950, completeProfit: 230, missingCostSkus: ["X"], missingCostRevenue: 50 };
    expect(gewinnBasis(tot, amazon, null, false)).toMatchObject({ revenueNet: 1200, provisional: 300, completeProfit: 280, coverage: 96, amazonAus: "abrechnung" });
    const u = ueberleitung({ vatRate: 0.19, sbAmazon: { sales: 1309, netProfit: 240, grossProfit: 300 }, sbEbay: null, amazon: { revenueNet: 1000, ergebnis: 250, aus: "abrechnung", text: "Amazon-Abrechnung (bis 31.10.)" }, kanaele: [{ channel: "temu", label: "Temu", revenueNet: 200, provisional: 50 }] });
    expect(u.zeilen.map((z) => z.kanal)).toEqual(["Amazon", "Temu"]);
    expect(u.zeilen[0]).toMatchObject({ sbNetto: 1100, sysNetto: 1000, diffNetto: 100 });
    expect(u.zeilen[1]).toMatchObject({ sbNetto: null, sysNetto: 200, diffNetto: -200 });
    expect(u.zeilen[1].hinweis).toMatch(/nicht in sellerboard/);
    expect(u.summe.sysNetto).toBe(1200);
  });
});
