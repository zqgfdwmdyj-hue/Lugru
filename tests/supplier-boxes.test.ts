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
    const c = calcBox({ title: "B", concept: "", items: [{ nr: 1, qty: 4 }, { nr: 3, qty: 2 }], targetPrice: 24.99, why: "", hook: "", searchTerm: "x" }, catalog, { packaging: 2.5, vatRate: 7, fbaFee: 5 });
    expect(c.goods).toBe(4.2);
    expect(c.cost).toBe(6.7);
    expect(c.units).toBe(6);
    expect(c.lines[0]).toBe("4× Airheads Blue Raspberry (je 0,45 €)");
    // 24,99/1,07 = 23,36 − 3,75 Provision − 5 FBA − 6,70 = 7,91
    expect(c.profit?.profit).toBe(7.91);
  });
});

import { pricingFor } from "@/lib/suppliers/boxes";

describe("Box-Preis aus dem Amazon-Vergleich", () => {
  const m = { count: 8, price: 27.99, priceLow: 22.99, priceHigh: 32.99, fbaFee: 4.2, referralPct: 15, monthlySold: 900 };
  it("Gebühren aus Keepa, Preis im Rahmen bleibt", () => {
    expect(pricingFor(29.99, m, 5)).toEqual({ price: 29.99, fbaFee: 4.2, referralPct: 15, note: null });
  });
  it("zu teurer KI-Preis wird auf den oberen Marktpreis geholt", () => {
    const p = pricingFor(49.99, m, 5);
    expect(p.price).toBe(32.99);
    expect(p.note).toContain("32.99");
  });
  it("ohne KI-Preis der Median, ohne Markt die Schätzung", () => {
    expect(pricingFor(null, m, 5).price).toBe(27.99);
    expect(pricingFor(19.99, null, 5)).toEqual({ price: 19.99, fbaFee: 5, referralPct: 15, note: null });
  });
});

import { goodsBudget, repairPrompt } from "@/lib/suppliers/boxes";

describe("Nachbesserung unrentabler Boxen", () => {
  it("Warenbudget bei Zielmarge 25 %", () => {
    // 29,99/1,07 = 28,03 − 4,50 Provision − 4 FBA − 2,50 Verpackung − 7,50 Marge = 9,53
    expect(goodsBudget({ price: 29.99, vatRate: 7, referralPct: 15, fbaFee: 4, packaging: 2.5 })).toBe(9.53);
    expect(goodsBudget({ price: 5, vatRate: 19, referralPct: 15, fbaFee: 4, packaging: 2.5 })).toBe(0);
  });
  it("Prompt nennt Budget und Katalog", () => {
    const p = repairPrompt({ catalog, boxes: [{ title: "Sauer", concept: "x", price: 29.99, budget: 9.53, current: 40 }] });
    expect(p).toContain("Budget Ware max. 9.53 €");
    expect(p).toContain("2 | Aftershocks Popping Candy [9g] | 0.40");
  });
});
