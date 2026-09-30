import { describe, expect, it } from "vitest";
import { easter, nthWeekday, OCCASIONS, upcomingOccasions } from "@/lib/brands/occasions";

const date = (key: string, y: number) => OCCASIONS.find((o) => o.key === key)!.date(y);

describe("Anlässe", () => {
  it("rechnet bewegliche Termine richtig", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    expect(date("muttertag", 2026)).toBe("2026-05-10");
    expect(date("vatertag", 2026)).toBe("2026-05-14");
    expect(date("karneval", 2026)).toBe("2026-02-16");
    expect(date("thanksgiving", 2026)).toBe("2026-11-26");
    expect(date("black-friday", 2026)).toBe("2026-11-27");
    expect(date("advent", 2026)).toBe("2026-11-29");
    expect(date("superbowl", 2027)).toBe("2027-02-14");
    expect(nthWeekday(2026, 9, 1, 1)).toBe("2026-09-07");
  });

  it("zeigt, wo die Planung schon läuft", () => {
    const up = upcomingOccasions("2026-09-30", { halloween: 10, weihnachten: 12, einschulung: 20, valentinstag: 8 });
    expect(up.map((u) => u.key)).toEqual(["halloween", "weihnachten", "valentinstag", "einschulung"]);
    expect(up[0]).toMatchObject({ date: "2026-10-31", planning: true, daysLeft: 31 });
    expect(up[1]).toMatchObject({ date: "2026-12-24", planFrom: "2026-10-01", planning: false });
    expect(up[3]).toMatchObject({ date: "2027-08-15", planFrom: "2027-03-28", planning: false });
  });
});

describe("KI für Marken", () => {
  it("liest Ideen auch aus abgeschnittenen Antworten und bereinigt Preise", async () => {
    const { parseIdeas, ideasPrompt } = await import("@/lib/brands/ai");
    const text = 'Hier:\n```json\n[{"titel":"Gruselbox „Monster-Snacks“","art":"box","konzept":"US-Halloween-Süßigkeiten.","inhalt":["Candy Corn","Reese’s Pumpkins"],"vk_preis":"29,99 €","ek_schaetzung":11,"warum_jetzt":"Halloween-Trend","beschaffung":"US-Importeure"},{"titel":"Kaputt","art":"x","vk_preis":';
    const r = parseIdeas(text);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Gruselbox „Monster-Snacks“", kind: "box", targetPrice: 29.99, costEstimate: 11, contents: ["Candy Corn", "Reese’s Pumpkins"] });
    const p = ideasPrompt({ brand: { name: "Grulu", description: "Schultüten", audience: null, priceRange: null, tone: null }, occasion: { name: "Halloween", date: "2026-10-31" }, existing: ["Alte Idee"], trends: ["Dubai-Schokolade boomt"], count: 5 });
    expect(p).toContain("Halloween am 2026-10-31");
    expect(p).toContain("- Alte Idee");
    expect(p).toContain("Dubai-Schokolade");
  });

  it("liest Content-Ideen und verwirft leere", async () => {
    const { parseContent, checklistFor } = await import("@/lib/brands/ai");
    const r = parseContent('[{"format":"Unboxing","hook":"Das hier gibt es in Deutschland fast nicht!","skript":"…","szenen":["Box auf Tisch","Öffnen"],"caption":"Welche zuerst?","hashtags":"#americancandy #kulu","sound":"Trend-Sound"},{"hook":""}]');
    expect(r).toEqual([{ format: "Unboxing", hook: "Das hier gibt es in Deutschland fast nicht!", script: "…", shots: ["Box auf Tisch", "Öffnen"], caption: "Welche zuerst?", hashtags: "#americancandy #kulu", soundIdea: "Trend-Sound" }]);
    expect(checklistFor("product").some((c) => /YouTube/.test(c.text))).toBe(true);
  });
});

describe("Marktdaten", () => {
  it("liest Keepa-Produkte (Preise in Cent, -1 = keine Angabe)", async () => {
    const { parseKeepaProduct } = await import("@/lib/brands/market");
    const cur = Array(20).fill(-1);
    cur[1] = 2499; cur[3] = 1520; cur[17] = 312; cur[18] = 2599;
    expect(parseKeepaProduct({ asin: "B0TEST0001", title: "Halloween Candy Box", stats: { current: cur }, fbaFees: { pickAndPackFee: 385 }, referralFeePercentage: 15, monthlySold: 200 })).toEqual({
      asin: "B0TEST0001", title: "Halloween Candy Box", price: 25.99, fbaFee: 3.85, referralPct: 15, monthlySold: 200, salesRank: 1520, reviews: 312,
    });
    const avg = Array(20).fill(-1);
    avg[1] = 1999;
    expect(parseKeepaProduct({ asin: "B0TEST0002", stats: { current: Array(20).fill(-1), avg90: avg } })).toMatchObject({ price: 19.99, fbaFee: null, monthlySold: null });
  });

  it("liest einen Helium-10-Xray-Export mit erkannten Spalten", async () => {
    const { parseHelium10 } = await import("@/lib/brands/market");
    const rows = [["#", "Product Details", "ASIN", "Brand", "Price  €", "ASIN Sales", "BSR", "Review Count", "FBA Fees"], ["1", "US Candy Box XL", "B0TEST0003", "X", "29,99", "1.250", "830", "4.100", "4,12"], ["2", "Summe", "", "", "", "", "", "", ""]];
    expect(parseHelium10(rows)).toEqual([{ asin: "B0TEST0003", title: "US Candy Box XL", price: 29.99, fbaFee: 4.12, referralPct: null, monthlySold: 1250, salesRank: 830, reviews: 4100 }]);
    expect(() => parseHelium10([["Titel", "Preis"]])).toThrow(/ASIN/);
  });

  it("fasst zusammen und rechnet FBA und FBM", async () => {
    const { summarizeMarket, calcProfit } = await import("@/lib/brands/market");
    const p = (price: number | null, fbaFee: number | null, monthlySold: number | null) => ({ asin: "B0TEST0000", title: "", price, fbaFee, referralPct: 15, monthlySold, salesRank: null, reviews: null });
    const s = summarizeMarket([p(20, 3, 100), p(30, 4, null), p(25, 5, 50), p(40, null, 10)]);
    expect(s).toMatchObject({ count: 4, price: 27.5, priceLow: 20, priceHigh: 30, fbaFee: 4, referralPct: 15, monthlySold: 160 });
    const fba = calcProfit({ price: 29.99, cost: 11.5, vatRate: 7, referralPct: 15, fbaFee: 4 }, "fba");
    expect(fba).toMatchObject({ netPrice: 28.03, referral: 4.5, fulfilment: 4, profit: 8.03 });
    expect(calcProfit({ price: 29.99, cost: 11.5, vatRate: 7, fbmShipping: 5.49 }, "fbm").profit).toBe(6.54);
  });
});

describe("Shop-Analyse", () => {
  it("erkennt ASINs in Links und liest eigene Produkte", async () => {
    const { asinFrom, parseKeepaOwn } = await import("@/lib/brands/shop");
    expect(asinFrom("https://www.amazon.de/dp/B0TEST0009?ref=x")).toBe("B0TEST0009");
    expect(asinFrom("https://www.amazon.de/Grulu-Box/dp/b0test0009/")).toBe("B0TEST0009");
    expect(asinFrom("B0TEST0009")).toBe("B0TEST0009");
    expect(asinFrom("https://amzn.eu/d/abc")).toBeNull();
    const cur = Array(20).fill(-1);
    cur[18] = 1499; cur[16] = 46; cur[17] = 12; cur[3] = 3400;
    expect(parseKeepaOwn({ asin: "B0TEST0009", title: "Grulu Box", stats: { current: cur }, features: ["A", "B"], images: [{ l: "abc.jpg" }] })).toMatchObject({ price: 14.99, rating: 4.6, reviews: 12, hasBuyBox: true, features: ["A", "B"], imageUrl: "https://m.media-amazon.com/images/I/abc.jpg" });
  });

  it("liest den TikTok-Export aus Helium 10 mit k-Angaben", async () => {
    const { parseTikTokExport } = await import("@/lib/brands/shop");
    const rows = [["Product Name", "Shop Name", "Price", "Units Sold", "Revenue", "Rating", "Videos"], ["Nerds Gummy Clusters Box", "CandyWorld", "€12,99", "3,4k", "€44.166,60", "4.8", "120"]];
    expect(parseTikTokExport(rows)).toEqual([{ title: "Nerds Gummy Clusters Box", shop: "CandyWorld", price: 12.99, sales: 3400, revenue: 44166.6, rating: 4.8, reviews: null, videos: 120, creators: null, url: null }]);
    expect(() => parseTikTokExport([["Preis"]])).toThrow(/Produktnamen/);
  });

  it("gibt Hinweise zur Optimierung", async () => {
    const { productHints } = await import("@/lib/brands/shop");
    const d = { asin: "B0TEST0009", title: "Grulu Box", price: 20, fbaFee: null, referralPct: null, monthlySold: null, salesRank: 9000, reviews: 3, rating: 4.0, hasBuyBox: false, features: ["a"], imageUrl: null };
    const h = productHints(d, [{ day: "2026-08-01", price: 20, salesRank: 3000, reviews: 1, rating: 4 }], 14);
    const text = h.map((x) => x.text).join(" | ");
    expect(text).toMatch(/Keine Buy Box/);
    expect(text).toMatch(/4 Sterne/);
    expect(text).toMatch(/Erst 3 Bewertungen/);
    expect(text).toMatch(/Titel ist kurz/);
    expect(text).toMatch(/über vergleichbaren/);
    expect(text).toMatch(/verschlechtert/);
  });
});

import { buyBoxHolder, parseKeepaOwn as parseOwn2 } from "@/lib/brands/shop";

describe("Buy Box und Bewertungen (Keepa mit buybox=1, rating=1)", () => {
  const cur = Array(20).fill(-1);
  cur[16] = 47; cur[17] = 38; cur[3] = 18123;
  const raw = { asin: "B0TEST0001", title: "Grulu Test", stats: { current: cur, buyBoxPrice: 1499, buyBoxSellerId: "A1KULU00TEST", buyBoxIsFBA: true } };
  it("liest Buy-Box-Preis, -Verkäufer, Sterne und Anzahl", () => {
    const d = parseOwn2(raw)!;
    expect(d).toMatchObject({ price: 14.99, hasBuyBox: true, buyBoxSellerId: "A1KULU00TEST", buyBoxIsFBA: true, rating: 4.7, reviews: 38 });
  });
  it("ohne Buy-Box-Daten: unbekannt statt „keine Buy Box“", () => {
    expect(parseOwn2({ asin: "B0TEST0002", title: "x", stats: { current: Array(20).fill(-1) } })!.hasBuyBox).toBeNull();
    expect(parseOwn2({ asin: "B0TEST0003", title: "x", stats: { current: Array(20).fill(-1), buyBoxPrice: -1 } })!.hasBuyBox).toBe(false);
  });
  it("vergleicht mit dem Verkäuferkonto der Marke (ID oder Name)", () => {
    const d = { ...parseOwn2(raw)!, buyBoxSellerName: "Wittmann und Kulu GmbH" };
    expect(buyBoxHolder(d, { sellerId: "A1KULU00TEST", sellerName: null })?.level).toBe("ok");
    expect(buyBoxHolder(d, { sellerId: "A9ANDERE0000", sellerName: null })).toMatchObject({ level: "warn", text: expect.stringContaining("Wittmann und Kulu GmbH") });
    expect(buyBoxHolder(d, { sellerId: null, sellerName: "Wittmann & Kulu GmbH" })?.level).toBe("ok");
    expect(buyBoxHolder(d, { sellerId: null, sellerName: null })?.level).toBe("info");
  });
});

import { calcProfit as cp } from "@/lib/brands/market";

describe("Kalkulation wie ProfitGo", () => {
  it("VK 24,95 / EK 8,55 / 19 % / 14,99 % / FBA 3,75 / Lager 0,09 → 4,84 € Gewinn", () => {
    const c = cp({ price: 24.95, cost: 8.55, vatRate: 19, referralPct: 14.99, fbaFee: 3.75, storageFee: 0.09, minRoi: 0.2 }, "fba");
    expect(c.profit).toBe(4.84);
    expect(c.margin).toBeCloseTo(19.4, 1);
    expect(c.roi).toBeCloseTo(56.6, 1);
    expect(c.maxCost).toBe(11.16);
    expect(c.breakEven).toBeCloseTo(17.94, 1);
  });
  it("mit 7 % USt (Lebensmittel) deutlich mehr", () => {
    expect(cp({ price: 24.95, cost: 8.55, vatRate: 7, referralPct: 14.99, fbaFee: 3.75, storageFee: 0.09 }, "fba").profit).toBe(7.19);
  });
});
