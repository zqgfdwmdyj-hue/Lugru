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
