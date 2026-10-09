import { describe, expect, it } from "vitest";
import { authHeaders, autoMapping, keepaPriority, looksLikeEan, normEan, offerCalc, priceHint, priceStats, sparkPath } from "@/lib/suppliers/prices";

describe("Preisliste: Spalten erkennen", () => {
  it("Qogita-artiger Export", () => {
    const m = autoMapping(["GTIN", "Name", "Category", "Brand", "€ Lowest Price inc. shipping", "Unit", "Lowest Priced Offer Inventory", "Product URL"]);
    expect(m).toMatchObject({ ean: "GTIN", title: "Name", price: "€ Lowest Price inc. shipping", stock: "Lowest Priced Offer Inventory", url: "Product URL", supplierSku: "GTIN" });
  });
  it("deutsche Großhandelsliste", () => {
    const m = autoMapping(["Art.-Nr.", "Bezeichnung", "EAN", "EK netto", "Lagerbestand", "Mindestabnahme"]);
    expect(m).toMatchObject({ supplierSku: "Art.-Nr.", title: "Bezeichnung", ean: "EAN", price: "EK netto", stock: "Lagerbestand", moq: "Mindestabnahme" });
  });
  it("gespeicherte Zuordnung gewinnt", () => {
    expect(autoMapping(["A", "B", "Preis"], { price: "B" }).price).toBe("B");
  });
});

describe("EK-Verlauf", () => {
  const today = "2026-10-09";
  const hist = [
    { day: "2026-09-01", price: 13.76 },
    { day: "2026-09-10", price: 15.2 },
    { day: "2026-09-13", price: 17.5 },
  ];
  it("x % über deinem Tief", () => {
    const s = priceStats(hist, 17.5, today);
    expect(s).toMatchObject({ low: 13.76, aboveLowPct: 27.2, days: 3 });
    expect(priceHint(s)?.text).toBe("27,2 % über deinem Tief (13,76 €)");
    expect(priceHint(s)?.tone).toBe("bad");
  });
  it("günstigster Stand seit N Tagen", () => {
    const s = priceStats([...hist, { day: "2026-10-09", price: 12.47 }], 12.47, today);
    expect(s.aboveLowPct).toBe(0);
    expect(priceHint(s)?.text).toBe("günstigster Stand seit 38 Tagen");
    const t = priceStats([{ day: "2026-09-13", price: 11 }, { day: "2026-09-20", price: 14 }, { day: "2026-10-01", price: 12 }], 12, today);
    // 11 € gab es am 13.09. – seit dem 13.09. war es nie günstiger? Nein: 11 < 12 → günstiger Stand ist der 13.09.
    expect(t.cheapestForDays).toBe(26);
    expect(t.aboveLowPct).toBe(9.1);
  });
  it("Veränderung zum Vormonat und Kurve", () => {
    expect(priceStats(hist, 17.5, today).change30Pct).toBe(15.1);
    expect(sparkPath(hist)).toMatch(/^M0 /);
    expect(sparkPath([hist[0]])).toBeNull();
    expect(priceHint(priceStats([hist[0]], 13.76, today))).toBeNull();
  });
});

describe("Kalkulation je Angebot", () => {
  it("netto aus brutto, Karton, Aufschlag", () => {
    const c = offerCalc({ price: 23.8, gross: true, vatRate: 0.19, costPct: 5, caseQty: 2, sale: 29.8, fbaFee: 4.0, referralRate: 0.15 });
    expect(c.unitNet).toBe(10.5);
    expect(c.profit).toBe(6.07);
    expect(c.roi).toBe(57.8);
  });
  it("ohne Amazon-Preis kein Gewinn", () => {
    expect(offerCalc({ price: 10, gross: false, vatRate: 0.19, costPct: 0, caseQty: 1, sale: null, fbaFee: 4, referralRate: 0.15 })).toEqual({ unitNet: 10, profit: null, roi: null });
  });
});

describe("Keepa-Reihenfolge", () => {
  const now = "2026-10-09T10:00:00Z";
  it("neu vor geändert vor alt; frische überspringen", () => {
    expect(keepaPriority({ checkedAt: null, priceChangedAt: null, now, maxAgeDays: 3 })).toBe(0);
    expect(keepaPriority({ checkedAt: "2026-10-08T10:00:00Z", priceChangedAt: "2026-10-09T09:00:00Z", now, maxAgeDays: 3 })).toBe(1);
    expect(keepaPriority({ checkedAt: "2026-10-08T10:00:00Z", priceChangedAt: null, now, maxAgeDays: 3 })).toBeNull();
    expect(keepaPriority({ checkedAt: "2026-10-01T10:00:00Z", priceChangedAt: null, now, maxAgeDays: 3 })!).toBeGreaterThan(2);
  });
});

describe("EAN und Zugang", () => {
  it("EAN vereinheitlichen", () => {
    expect(normEan("4099000000011")).toBe("4099000000011");
    expect(normEan("012345678905")).toBe("0012345678905"); // UPC-12
    expect(normEan("04099000000011")).toBe("4099000000011"); // GTIN-14
    expect(normEan("4099 0000 0001 1")).toBe("4099000000011");
    expect(normEan("123")).toBeNull();
  });
  it("Suchtext nur als EAN, wenn er aus Ziffern besteht", () => {
    expect(looksLikeEan("4099000000011")).toBe(true);
    expect(looksLikeEan(" 4099-0000-0001-1 ")).toBe(true);
    expect(looksLikeEan("Parfum 50ml 2024 Edition 12345678")).toBe(false);
    expect(looksLikeEan("B0EKTEST01")).toBe(false);
  });
  it("Zugangsformate", () => {
    expect(authHeaders(null)).toEqual({});
    expect(authHeaders("haendler:geheim")).toEqual({ Authorization: `Basic ${Buffer.from("haendler:geheim").toString("base64")}` });
    expect(authHeaders("Bearer abc123")).toEqual({ Authorization: "Bearer abc123" });
    expect(authHeaders("X-Api-Key: abc123")).toEqual({ "X-Api-Key": "abc123" });
    expect(authHeaders("abc123token")).toEqual({ Authorization: "Bearer abc123token" });
  });
});
