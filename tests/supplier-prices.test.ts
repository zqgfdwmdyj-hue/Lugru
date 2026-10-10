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

describe("Einheiten je Amazon-Verkauf", () => {
  it("erkennt Mehrfachpackungen im Amazon-Titel", async () => {
    const { amazonPackQty } = await import("@/lib/suppliers/scan");
    expect(amazonPackQty("Skittles Fruits, fruchtige vegane Kaubonbons, Großpackung, 15 x 136 g")).toBe(15);
    expect(amazonPackQty("Jolly Rancher Original Hartbonbons 198 g (2 Stück)")).toBe(2);
    expect(amazonPackQty("2er Set Nerds Rainbow Candy – Amerikanische Süßigkeiten – 2 x 141 g")).toBe(2);
    expect(amazonPackQty("Haribo Goldbären, 6er-Pack (6 x 200 g)")).toBe(6);
    expect(amazonPackQty("Monster Energy, Packung mit 12")).toBe(12);
    expect(amazonPackQty("Pringles Original, 6 Dosen à 165 g")).toBe(6);
    // US-Schreibweisen
    expect(amazonPackQty("Pop Rocks - Blue Razz, 24 count (8.4oz)")).toBe(24);
    expect(amazonPackQty("POP ROCKS Popping Candy, Cotton Candy, 24 Count by Pop Rocks")).toBe(24);
    expect(amazonPackQty("Laffy Taffy Rope Candy, Cherry, 24-Piece Box")).toBe(24);
    expect(amazonPackQty("Warheads Extreme Sour, Case of 12")).toBe(12);
    expect(amazonPackQty("Haribo Minis Beutel (80 Stück)")).toBe(80);
    // Einzelpackung bzw. ohne Stückzahl.
    expect(amazonPackQty("Jelly Belly Bean Boozled 100g Süßigkeiten mit Glücksrad")).toBeNull();
    expect(amazonPackQty("AirHeads 80 Mini Bars Fun Taffy Candy Assorted Fruit Flavors 32.17oz (912g)")).toBeNull();
    expect(amazonPackQty("Laffy Taffy Rope Cherry")).toBeNull();
    expect(amazonPackQty("Halloween Süßigkeiten Box USA 25 Teile")).toBeNull();
    expect(amazonPackQty(null)).toBeNull();
  });

  it("Lieferanten-Inhalt wird berücksichtigt, von Hand gesetzt gewinnt", async () => {
    const { unitsPerSale } = await import("@/lib/suppliers/scan");
    expect(unitsPerSale({ amazonTitle: "Jolly Rancher 198 g (2 Stück)", supplierTitle: "Jolly Rancher 198g - Karton 12" })).toEqual({ units: 2, auto: true, source: "titel" });
    // Lieferant verkauft schon 2er-Sets → bei Amazon 2er Set = 1 Einheit.
    expect(unitsPerSale({ amazonTitle: "2er Set Nerds 2 x 141 g", supplierTitle: "Nerds Rainbow 2er Set (Karton 12)" })).toEqual({ units: 1, auto: true, source: "titel" });
    // „15 x 136 g“ beim Lieferanten ist der Karton – Amazon verkauft den ganzen Karton.
    expect(unitsPerSale({ amazonTitle: "Skittles Großpackung, 15 x 136 g", supplierTitle: "Skittles Fruits (15 x 136g)" })).toEqual({ units: 15, auto: true, source: "titel" });
    expect(unitsPerSale({ amazonTitle: "Skittles Großpackung, 15 x 136 g", supplierTitle: "Skittles", override: 1 })).toEqual({ units: 1, auto: false, source: "hand" });
    expect(unitsPerSale({ amazonTitle: "Jelly Belly 100g", supplierTitle: "Jelly Belly 100g x12" })).toEqual({ units: 1, auto: true, source: null });
  });

  it("CandyHero-Kartons gegen US-Großpackungen bei Amazon", async () => {
    const { unitsPerSale } = await import("@/lib/suppliers/scan");
    // Karton 24 × 9,5 g (EK je Tütchen) gegen „24 count“ bei Amazon → 24 Tütchen je Verkauf.
    expect(unitsPerSale({ amazonTitle: "Pop Rocks - Blue Razz, 24 count (8.4oz)", supplierTitle: "Pop Rocks Blue Razz (24 x 9.5g)" }).units).toBe(24);
    // Ohne Stückzahl, aber mit Inhalt: 340 g Beutel ÷ 6 g je Riegel ≈ 57.
    expect(unitsPerSale({ amazonTitle: "Airheads Mini SOURS Candy Bars, Sour Watermelon Punch, 340 ml Sortenbeutel", supplierTitle: "Airheads Mini Bars Sour (60 x 6g)" })).toEqual({ units: 57, auto: true, source: "gewicht" });
    // Titel ohne alles → Keepa-Packungsmenge.
    expect(unitsPerSale({ amazonTitle: "Laffy Taffy Rope Cherry", supplierTitle: "Laffy Taffy Rope Cherry (24 x 22.9g)", keepaItems: 24 })).toEqual({ units: 24, auto: true, source: "keepa" });
    // Keepa-Inhalt ohne Stückzahl: 549 g ÷ 22,9 g = 24.
    expect(unitsPerSale({ amazonTitle: "Laffy Taffy Rope Cherry", supplierTitle: "Laffy Taffy Rope Cherry (24 x 22.9g)", keepaNetG: 549 }).units).toBe(24);
    // Lieferanten-Einheit ist schon der ganze Beutel: „80 Stück“ bei Amazon = 1 Beutel.
    expect(unitsPerSale({ amazonTitle: "Haribo Minis Beutel (80 Stück)", supplierTitle: "Haribo Minis Beutel 80 Riegel 1 kg" }).units).toBe(1);
    // Gegenprobe übers Gewicht: Zahl zählt den Inhalt, Inhalt laut Keepa = 1 Beutel.
    expect(unitsPerSale({ amazonTitle: "Haribo Minis (80 Stück)", supplierTitle: "Haribo Minis Beutel 1 kg", keepaNetG: 1000 })).toEqual({ units: 1, auto: true, source: "gewicht" });
  });

  it("Keepa-Packungsangaben", async () => {
    const { keepaPack } = await import("@/lib/brands/market");
    expect(keepaPack({ packageQuantity: 24, numberOfItems: 1 })).toEqual({ items: 24, netG: null });
    expect(keepaPack({ packageQuantity: -1, numberOfItems: 12 })).toEqual({ items: 12, netG: null });
    expect(keepaPack({ unitCount: { unitValue: 8.4, unitType: "Ounce" } })).toEqual({ items: null, netG: 238.1 });
    expect(keepaPack({ unitCount: { unitValue: 340, unitType: "Gramm" } })).toEqual({ items: null, netG: 340 });
    expect(keepaPack({ unitCount: { unitValue: 1.5, unitType: "Liter" } })).toEqual({ items: null, netG: 1500 });
    expect(keepaPack({ unitCount: { unitValue: 24, unitType: "Count" } })).toEqual({ items: 24, netG: null });
    expect(keepaPack({})).toEqual({ items: null, netG: null });
  });

  it("unplausibler ROI", async () => {
    const { isImplausible } = await import("@/lib/suppliers/prices");
    expect(isImplausible(11070)).toBe(true);
    expect(isImplausible(480)).toBe(false);
    expect(isImplausible(null)).toBe(false);
  });

  it("Gewinn und ROI je Amazon-Verkauf", () => {
    // 12er-Karton 36 € netto → 3 € je Stück; Amazon verkauft 2 Stück für 14,99 €.
    const one = offerCalc({ price: 36, gross: false, vatRate: 0.19, costPct: 0, caseQty: 12, sale: 14.99, fbaFee: 3, referralRate: 0.15 });
    const two = offerCalc({ price: 36, gross: false, vatRate: 0.19, costPct: 0, caseQty: 12, sale: 14.99, fbaFee: 3, referralRate: 0.15, unitsPerSale: 2 });
    expect(one).toMatchObject({ unitNet: 3, profit: 4.35 });
    expect(two).toMatchObject({ unitNet: 3, costPerSale: 6, profit: 1.35, roi: 22.5 });
  });
});
