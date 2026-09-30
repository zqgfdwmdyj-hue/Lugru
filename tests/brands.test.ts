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
