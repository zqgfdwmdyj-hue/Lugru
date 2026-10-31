import { describe, expect, it } from "vitest";
import { rankProductGroups, type ProductGroup } from "@/lib/products/logic";

// Globale Suche: exakte SKU zuerst. Fiktive Daten.

const g = (key: string, skus: string[], extra: Partial<ProductGroup> = {}): ProductGroup => ({ key, href: `/produkte/sku/${skus[0]}`, productId: null, title: null, asin: null, ean: null, image: null, skus, ...extra });

describe("rankProductGroups", () => {
  it("exakte SKU vor Präfix vor Name, Groß/Klein egal", () => {
    const r = rankProductGroups(
      [
        g("a", ["XLG-15-V3"], { title: "Anderes" }),
        g("b", ["LG-15-V30"], { title: "Bleistift" }),
        g("c", ["LG-15-V3", "LG-15-V2"], { title: "Zettel" }),
        g("d", ["ABC"], { title: "Titel mit lg-15-v3" }),
      ],
      " lg-15-v3 ",
    );
    expect(r.map((x) => x.key)).toEqual(["c", "b", "a", "d"]);
    expect(r[0]).toMatchObject({ exact: true, matched: ["LG-15-V3"] });
    expect(r[1].exact).toBe(false);
  });
  it("exakte ASIN/EAN zählt als genauer Treffer", () => {
    const r = rankProductGroups([g("a", ["S1"], { title: "A" }), g("b", ["S2"], { ean: "4000000000017" })], "4000000000017");
    expect(r[0]).toMatchObject({ key: "b", exact: true });
  });
});

describe("EK-Herkunft", () => {
  it("Set ohne eigenen EK = Summe der Bestandteile; geerbter Wert erkennbar und zuletzt", async () => {
    const { mergeCosts, setCostPairs } = await import("@/lib/money/profit-logic");
    const base = mergeCosts(["charge", [["A", 2, "Einkauf"]]], ["ebay", [["B", 1.5, "Angebot 1, Variante B"]]]);
    const sets = setCostPairs([{ sku: "SET", components: [{ sku: "A", qty: 2 }, { sku: "B", qty: 1 }] }, { sku: "SET2", components: [{ sku: "A", qty: 1 }, { sku: "X", qty: 1 }] }], base);
    expect(sets).toEqual([["SET", 5.5, "2× A + 1× B"]]);
    const all = mergeCosts(["charge", [["A", 2]]], ["set", sets], ["ebay", [["SET", 4.2, "EK des Mehrfachangebots", true], ["V3", 4.2, "EK des Mehrfachangebots", true]]]);
    expect(all.get("SET")).toMatchObject({ cost: 5.5, source: "set" });
    expect(all.get("V3")).toMatchObject({ cost: 4.2, source: "ebay", inherited: true });
  });
});

describe("Markennamen ohne Schreibweisen-Dubletten", () => {
  it("wella / Wella / WELLA → Wella, Reihenfolge bleibt", async () => {
    const { dedupeBrands } = await import("@/lib/leads/logic");
    expect(dedupeBrands(["wella", "Schwarzkopf", "Wella", "WELLA", " schwarzkopf "])).toEqual(["Wella", "Schwarzkopf"]);
    expect(dedupeBrands(["L'Oréal", "loreal"])).toEqual(["L'Oréal"]);
  });
});
