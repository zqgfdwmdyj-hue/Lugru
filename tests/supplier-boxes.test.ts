import { describe, expect, it } from "vitest";
import { boxPrompt, calcBox, parseBoxes, type CatalogItem } from "@/lib/suppliers/boxes";

const catalog: CatalogItem[] = [
  { nr: 1, offerId: "a", title: "Airheads Blue Raspberry", unitCost: 0.45, unitSize: "16g", amazonPrice: null, monthlySold: null },
  { nr: 2, offerId: "b", title: "Aftershocks Popping Candy", unitCost: 0.4, unitSize: "9g", amazonPrice: 2.99, monthlySold: 50 },
  { nr: 3, offerId: "c", title: "Nerds Rope", unitCost: 1.2, unitSize: null, amazonPrice: null, monthlySold: null },
];

describe("Boxen aus Lieferanten-Artikeln", () => {
  it("Prompt enthält Katalog, Trends und Verpackung", () => {
    const p = boxPrompt({ brand: { name: "Grulu", description: "US-Süßigkeiten", audience: null, priceRange: null, tone: null }, occasion: { name: "Halloween", date: "2026-10-31" }, trends: ["Sour Candy Challenge"], catalog, count: 3, packaging: 2.5, existing: ["Alte Box"] });
    expect(p).toContain("2 | Aftershocks Popping Candy [9g] | 0.40 | 2.99 | 50");
    expect(p).toContain("Sour Candy Challenge");
    expect(p).toContain("Halloween");
    expect(p).toContain("2.50 € je Box");
  });
  it("nur bekannte Artikel, Mengen zusammengefasst", () => {
    const boxes = parseBoxes('[{"titel":"Sauer-Box","konzept":"x","artikel":[{"nr":1,"menge":3},{"nr":1,"menge":2},{"nr":99,"menge":1},{"nr":3,"menge":0}],"vk_preis":"24,99","warum":"TikTok","tiktok_hook":"Hook"},{"titel":"Leer","artikel":[{"nr":42}]}]', catalog);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ title: "Sauer-Box", items: [{ nr: 1, qty: 5 }], targetPrice: 24.99, hook: "Hook" });
  });
  it("Kalkulation exakt aus Einzelpreisen", () => {
    const c = calcBox({ title: "B", concept: "", items: [{ nr: 1, qty: 4 }, { nr: 3, qty: 2 }], targetPrice: 24.99, why: "", hook: "" }, catalog, { packaging: 2.5, vatRate: 7, fbaFee: 5 });
    expect(c.goods).toBe(4.2);
    expect(c.cost).toBe(6.7);
    expect(c.units).toBe(6);
    expect(c.lines[0]).toBe("4× Airheads Blue Raspberry (je 0,45 €)");
    // 24,99/1,07 = 23,36 − 3,75 Provision − 5 FBA − 6,70 = 7,91
    expect(c.profit?.profit).toBe(7.91);
  });
});
