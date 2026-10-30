import { describe, expect, it } from "vitest";
import { verkaeufeJeAsin, type SkuTag } from "@/lib/sellerboard/verkaeufe";

// Erfundene Tageswerte je SKU.
const z = (o: Partial<SkuTag> & Pick<SkuTag, "sku">): SkuTag => ({ channel: "amazon", asin: null, name: null, units: 0, sales: null, netProfit: null, refunds: 0, ...o });

describe("Verkaufte Stück je ASIN", () => {
  it("mehrere SKUs einer ASIN (FBA/FBM, Amazon/eBay) zusammen, meistverkaufte zuerst", () => {
    const l = verkaeufeJeAsin([
      z({ sku: "TEST-A-FBA", asin: "B0TEST0001", name: "Testsocken", units: 3, sales: 29.97, netProfit: 6.1 }),
      z({ sku: "TEST-A-FBM", asin: "b0test0001", units: 1, sales: 9.99, netProfit: 1.2, refunds: 1 }),
      z({ sku: "TEST-A-EBAY", channel: "ebay", asin: "B0TEST0001", units: 1, sales: 10.5, netProfit: null }),
      z({ sku: "TEST-B", asin: "B0TEST0002", units: 7, sales: 70, netProfit: -3.5 }),
      z({ sku: "TEST-OHNE", units: 2, sales: 5 }),
    ]);
    expect(l.map((x) => x.asin ?? x.skus[0])).toEqual(["B0TEST0002", "B0TEST0001", "TEST-OHNE"]);
    expect(l[1]).toMatchObject({ stueck: 5, umsatz: 50.46, nettogewinn: 7.3, erstattungen: 1, kanaele: ["amazon", "ebay"], name: "Testsocken" });
    expect(l[1].skus).toHaveLength(3);
    expect(l[0].nettogewinn).toBe(-3.5);
  });
  it("ohne Werte: Umsatz/Gewinn bleiben null statt 0", () => {
    expect(verkaeufeJeAsin([z({ sku: "X", asin: "B0TEST0003", units: 1 })])[0]).toMatchObject({ umsatz: null, nettogewinn: null });
    expect(verkaeufeJeAsin([])).toEqual([]);
  });
});
