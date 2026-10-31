import { describe, expect, it } from "vitest";
import { compareCost, costsDiffer, isPlaceholderCost, isReturnSku } from "@/lib/money/ek-logic";
import { mergeCosts } from "@/lib/money/profit-logic";
import { buildReorderRows, filterReorder, reorderTotals, urgencyOf, type ReorderContext, type SbReorderInput } from "@/lib/purchasing/reorder-logic";
import { breakdownText, fbaBreakdown, reachText } from "@/lib/stock/breakdown";
import { areaStep, FBA_SUBSTITUTE } from "@/lib/today/logic";
import { ekCheck } from "@/lib/products/logic";

// Einheitliche Datenbasis: ein gültiger EK, gleiche Bestandsbegriffe, Retouren, Nachbestellung, Datenstand.
// Fiktive SKUs und Preise.

describe("Gültiger EK und andere Quellen", () => {
  it("0,01 € aus sellerboard ist ein Platzhalter und weicht vom gültigen EK ab", () => {
    expect(isPlaceholderCost(0.01)).toBe(true);
    expect(isPlaceholderCost(0.5)).toBe(false);
    const valid = { cost: 3.9, source: "charge" as const, inherited: true };
    expect(compareCost(valid, 0.01)).toEqual({ value: 0.01, deviates: true, placeholder: true });
    expect(compareCost(valid, 3.9)).toEqual({ value: 3.9, deviates: false, placeholder: false });
    // Stammt der gültige EK selbst aus sellerboard, ist es derselbe Wert – keine Abweichung.
    expect(compareCost({ cost: 472.06, source: "sellerboard" }, 472.06)?.deviates).toBe(false);
    expect(costsDiffer(10, 10.1)).toBe(false);
    expect(costsDiffer(10, 10.5)).toBe(true);
  });
  it("Reihenfolge: sellerboard gilt nur ohne eigenen EK", () => {
    const m = mergeCosts(["charge", [["RET_1_LPNTEST_01JAN26_FBA", 3.9]]], ["sellerboard", [["RET_1_LPNTEST_01JAN26_FBA", 0.5], ["AMZ_TEST_MON", 472.06]]]);
    expect(m.get("RET_1_LPNTEST_01JAN26_FBA")?.cost).toBe(3.9);
    expect(m.get("AMZ_TEST_MON")).toEqual({ cost: 472.06, source: "sellerboard" });
  });
  it("Platzhalter neben gültigem EK = widersprüchlich; ohne gültigen EK bleibt es „fehlt“", () => {
    const src = (cost: number, ignored = false) => ({ source: "sellerboard" as const, label: "sellerboard", cost, ...(ignored ? { ignored: true } : {}) });
    expect(ekCheck("A", [{ source: "charge", label: "Charge", cost: 3.9 }, src(0.01, true)], { cost: 3.9, source: "charge" }).conflict).toBe(true);
    expect(ekCheck("B", [src(0.01, true)], null).conflict).toBe(false);
  });
  it("Retouren-SKUs erkennen", () => {
    expect(isReturnSku("RET_3_LPNTEST000001_24SEP26_FBA")).toBe(true);
    expect(isReturnSku("AMZDE_01OCT26_B0TEST0001_10.00_20.00")).toBe(false);
  });
});

describe("Bestandsbegriffe", () => {
  it("Gesamt = verkaufbar + reserviert + unterwegs + nicht verkaufbar", () => {
    const b = fbaBreakdown([{ fulfillable: 1, reserved: 2, inboundShipped: 0, unsellable: 0 }]);
    expect(b).toEqual({ verkaufbar: 1, reserviert: 2, unterwegs: 0, nichtVerkaufbar: 0, gesamt: 3 });
    expect(breakdownText(b)).toBe("verkaufbar 1 · reserviert 2");
    const c = fbaBreakdown([{ fulfillable: 0, reserved: 3, inboundWorking: 1, inboundShipped: 1, unsellable: 0 }, { fulfillable: 0, reserved: 0, unsellable: 1 }]);
    expect(c.gesamt).toBe(6);
    expect(breakdownText(c)).toBe("verkaufbar 0 · reserviert 3 · unterwegs 2 · nicht verkaufbar 1");
  });
  it("999 Tage Reichweite heißt: keine Verkäufe", () => {
    expect(reachText(999)).toMatch(/keine Verkäufe/);
    expect(reachText(999, { short: true })).toBe("keine Verk.");
    expect(reachText(12, { short: true })).toBe("12 T.");
    expect(reachText(null)).toBe("–");
  });
});

describe("Nachbestellen laut sellerboard", () => {
  const row = (o: Partial<SbReorderInput>): SbReorderInput => ({
    id: o.sku ?? "x", sku: "AMZ_A", asin: "B0TESTA001", name: "Test", fbaStock: 2, reserved: 1, inbound: 0, salesVelocity: 1, daysLeft: 3,
    timeToReorder: "YES", daysToReorder: 0, qtyToReorder: 3, sbCost: null, ...o,
  });
  const ctx = (o: Partial<ReorderContext> = {}): ReorderContext => ({
    today: "2026-10-27",
    costs: new Map([
      ["AMZ_A", { cost: 10, source: "charge" as const }],
      ["RET_3_LPNTEST000001_24SEP26_FBA", { cost: 3.9, source: "charge" as const, inherited: true }],
    ]),
    returnLots: new Map([["RET_3_LPNTEST000001_24SEP26_FBA", "AMZ_A"]]),
    purchasable: new Map([["B0TESTA001", [{ sku: "AMZ_A", supplier: "Testshop" }]]]),
    feeds: new Map(),
    margin: new Map([["AMZ_A", 18.5]]),
    ...o,
  });

  it("B15.5: eine Rechnung für den Kapitalbedarf – rote Ampel und angelegte Einkäufe heraus, Retouren und fehlender EK nicht als 0 €", async () => {
    const { kapitalbedarf, KAPITALBEDARF_DEFINITION } = await import("@/lib/purchasing/reorder-logic");
    const costs = new Map([
      ["AMZ_A", { cost: 10, source: "charge" as const }],
      ["AMZ_B", { cost: 5, source: "charge" as const }],
      ["AMZ_C", { cost: 2, source: "charge" as const }],
    ]);
    const rows = buildReorderRows(
      [row({ sku: "AMZ_A", asin: "B0TESTA001", qtyToReorder: 3 }), row({ sku: "AMZ_B", asin: "B0TESTB002", qtyToReorder: 4 }), row({ sku: "AMZ_C", asin: "B0TESTC003", qtyToReorder: 10 }), row({ sku: "AMZ_D", asin: "B0TESTD004", qtyToReorder: 1 })],
      ctx({ costs }),
    );
    const alle = kapitalbedarf(rows);
    expect(alle.capital).toBe(30 + 20 + 20);
    expect(alle.noEk).toBe(1);
    const k = kapitalbedarf(rows, { weg: (r) => r.sku === "AMZ_C", angelegteAsins: new Set(["B0TESTB002"]) });
    expect(k.capital).toBe(30);
    expect(k.rote).toBe(1);
    expect(k.angelegt).toBe(1);
    expect(k.rows.map((r) => r.sku)).toEqual(["AMZ_A", "AMZ_D"]);
    expect(KAPITALBEDARF_DEFINITION).toMatch(/netto.*Menge laut sellerboard × gültiger EK.*roter Kapital-Ampel.*schon im Einkauf angelegt/);
  });

  it("B19.8: Kaufquote 0 % oder Minus-Marge nicht in der Summe, getrennt als „prüfen“", async () => {
    const { kapitalbedarf, pruefGrund, KAPITALBEDARF_DEFINITION } = await import("@/lib/purchasing/reorder-logic");
    const costs = new Map([
      ["AMZ_A", { cost: 10, source: "charge" as const }],
      ["AMZ_B", { cost: 5, source: "charge" as const }],
      ["AMZ_C", { cost: 2, source: "charge" as const }],
    ]);
    const rows = buildReorderRows(
      [row({ sku: "AMZ_A", asin: "B0TESTA001", qtyToReorder: 3 }), row({ sku: "AMZ_B", asin: "B0TESTB002", qtyToReorder: 4 }), row({ sku: "AMZ_C", asin: "B0TESTC003", qtyToReorder: 10 })],
      ctx({ costs, margin: new Map([["AMZ_A", 18.5], ["AMZ_B", -31], ["AMZ_C", 12]]) }),
    );
    const kaufquoten = new Map([["AMZ_A", { conversion: 12, sessions: 300 }], ["AMZ_C", { conversion: 0, sessions: 120 }]]);
    const k = kapitalbedarf(rows, { kaufquoten });
    expect(k.capital).toBe(30); // nur AMZ_A
    expect(k.rows.map((r) => r.sku)).toEqual(["AMZ_A"]);
    expect(k.pruefen.map((x) => [x.row.sku, x.grund])).toEqual([["AMZ_B", "Minus-Marge (-31 % in 30 Tagen)"], ["AMZ_C", "Kaufquote 0 % (120 Besuche in 30 Tagen)"]]);
    expect(k.pruefenKapital).toBe(20 + 20);
    // ohne Besuche ist 0 % keine Aussage
    expect(pruefGrund({ margin: 10 }, { conversion: 0, sessions: 0 })).toBeNull();
    expect(KAPITALBEDARF_DEFINITION).toMatch(/Minus-Marge oder Kaufquote 0 %/);
  });

  it("Kapital mit gültigem EK netto, nicht mit dem sellerboard-Platzhalter", () => {
    const [r] = buildReorderRows([row({ sbCost: 0.01 })], ctx());
    expect(r.capital).toBe(30);
    expect(r.checks).toEqual(["ek_abweichung"]);
    expect(r.sbCompare?.placeholder).toBe(true);
    expect(r.source).toBe("zuletzt bei Testshop");
    expect(r.regular).toBe(true);
  });
  it("Retoure: Ursprungsartikel zugeordnet, kein Kapital, nicht regulär", () => {
    const [r] = buildReorderRows([row({ id: "r", sku: "RET_3_LPNTEST000001_24SEP26_FBA", sbCost: 0.01 })], ctx());
    expect(r.isReturn).toBe(true);
    expect(r.origin).toBe("AMZ_A");
    expect(r.capital).toBeNull();
    expect(r.regular).toBe(false);
    expect(r.checks).toContain("retoure");
    expect(r.checks).not.toContain("quelle");
  });
  it("Retoure ohne Ursprungsartikel und ohne Bezugsquelle → „Beschaffung prüfen“", () => {
    const [r] = buildReorderRows([row({ id: "r2", sku: "RET_9_LPNTEST000009_01OCT26_FBA", asin: "B0TESTZ009" })], ctx({ returnLots: new Map() }));
    expect(r.origin).toBeNull();
    expect(r.checks).toEqual(expect.arrayContaining(["retoure", "quelle", "ek_fehlt"]));
  });
  it("Dringlichkeit, Filter, Summen", () => {
    expect(urgencyOf({ timeToReorder: "YES", daysToReorder: -3 })).toBe("ueberfaellig");
    expect(urgencyOf({ timeToReorder: "SOON", daysToReorder: 5 })).toBe("bald");
    const rows = buildReorderRows(
      [row({ id: "1" }), row({ id: "2", sku: "AMZ_B", asin: "B0TESTB002", timeToReorder: "SOON", daysToReorder: 6, qtyToReorder: 10 }), row({ id: "3", sku: "RET_3_LPNTEST000001_24SEP26_FBA" })],
      ctx({ costs: new Map([["AMZ_A", { cost: 10, source: "charge" as const }], ["AMZ_B", { cost: 5, source: "sellerboard" as const }]]) }),
    );
    const t = reorderTotals(rows);
    expect(t.capital).toBe(80); // 3 × 10 + 10 × 5, Retoure nicht enthalten
    expect(t.returns).toBe(1);
    expect(t.noSource).toBe(1); // AMZ_B: kein Einkauf, kein Feed
    expect(filterReorder(rows, { q: "amz_b" }).map((r) => r.sku)).toEqual(["AMZ_B"]);
    expect(filterReorder(rows, { pruefen: "retoure" }).length).toBe(1);
    expect(filterReorder(rows, { pruefen: "regulaer" }).map((r) => r.sku)).toEqual(["AMZ_A"]);
    expect(filterReorder(rows, { margeMin: 10 }).map((r) => r.sku)).toEqual(["AMZ_A"]);
    expect(filterReorder(rows, { kapitalMin: 40 }).map((r) => r.sku)).toEqual(["AMZ_B"]);
    expect(filterReorder(rows, { sort: "kapital" })[0].sku).toBe("AMZ_B");
    expect(filterReorder(rows, { dring: "bald" }).map((r) => r.sku)).toEqual(["AMZ_B"]);
  });
});

describe("Datenstand: sellerboard ersetzt den FBA-Bestandsbericht teilweise", () => {
  it("Bericht fehlt, sellerboard vorhanden → „Ersatzquelle“ mit Reicht-für und Weiter-nötig-für", () => {
    const sub = { label: "sellerboard-Bestand vorhanden (Stand 26.10.)", last: new Date(), ...FBA_SUBSTITUTE };
    const st = areaStep({ key: "report:inventory", missing: true, stale: false, error: null, substitute: sub });
    expect(st.state).toBe("ersatz");
    expect(st.step).toMatch(/^Bericht fehlt; sellerboard-Bestand vorhanden/);
    expect(st.step).toMatch(/reicht für: Bestand & Lagerwert/);
    expect(st.step).toMatch(/Bericht weiter nötig für: nicht verkaufbare Einheiten/);
    expect(areaStep({ key: "report:inventory", missing: true, stale: false, error: null }).state).toBe("fehlt");
  });
});

describe("Zeitangaben: eBay-Oberfläche immer in Berliner Zeit", () => {
  it("21:25 UTC (nach Ende der Sommerzeit) = 22:25 Uhr in Berlin – unabhängig von der Zeitzone des Browsers", async () => {
    const { formatDate } = await import("@/components/ebay/api");
    expect(formatDate("2026-10-26T21:25:00Z")).toBe("26.10.26, 22:25");
    expect(formatDate("2026-07-01T12:00:00Z")).toBe("01.07.26, 14:00");
  });
});
