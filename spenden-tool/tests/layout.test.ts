import { describe, expect, it } from "vitest";
import { balancedPages, bestGrid, collagePrice, collageSettings, flyerPrice, flyerSections, messengerText, nameFromFilename, paginate, tileStyle } from "@/lib/layout";

describe("Spenden: Preise", () => {
  it("Collage: Cent unter 1 €, sonst Euro", () => {
    expect(collagePrice(0.6)).toBe("60 Cent");
    expect(collagePrice(0.3)).toBe("30 Cent");
    expect(collagePrice(2)).toBe("2 €");
    expect(collagePrice(2.5)).toBe("2,50 €");
    expect(collagePrice(null)).toBe("");
    expect(collagePrice(0)).toBe("gratis");
  });
  it("Aushang: kompakt wie auf dem Zettel", () => {
    expect(flyerPrice(0.3)).toBe("0,30€");
    expect(flyerPrice(14)).toBe("14€");
    expect(flyerPrice(5.4)).toBe("5,40€");
    expect(flyerPrice(1.25)).toBe("1,25€");
  });
});

describe("Spenden: Raster", () => {
  it("füllt Hochformat sinnvoll", () => {
    expect(bestGrid(1, 1080, 1350)).toEqual({ cols: 1, rows: 1 });
    expect(bestGrid(4, 1080, 1350)).toEqual({ cols: 2, rows: 2 });
    expect(bestGrid(9, 1080, 1350)).toEqual({ cols: 3, rows: 3 });
    expect(bestGrid(12, 1080, 1350)).toEqual({ cols: 3, rows: 4 });
    expect(bestGrid(6, 1080, 1920)).toEqual({ cols: 2, rows: 3 });
  });
  it("jede Kachel wird genutzt oder höchstens eine Zeile bleibt unvollständig", () => {
    for (let n = 1; n <= 30; n++) {
      const g = bestGrid(n, 1080, 1350);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
      expect(g.cols * g.rows - n).toBeLessThan(Math.max(g.cols, g.rows));
    }
  });
  it("teilt Seiten gleichmäßig", () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(balancedPages([...Array(10).keys()], 9).map((p) => p.length)).toEqual([5, 5]);
    expect(balancedPages([...Array(19).keys()], 9).map((p) => p.length)).toEqual([7, 6, 6]);
    expect(balancedPages([], 9)).toEqual([]);
  });
  it("Einstellungen bekommen Standardwerte", () => {
    expect(collageSettings({ perPage: 99, format: "x" as never })).toMatchObject({ perPage: 9, format: "4:5", fit: "contain" });
  });
});

describe("Spenden: Aushang", () => {
  const items = [
    { name: "Getrocknete Tomaten", variant: "2kg", category: "Lebensmittel", price: 5 },
    { name: "Getrocknete Tomaten", variant: "5kg", category: "Lebensmittel", price: 10, bestBefore: "2026-10-12" },
    { name: "Kindergrieß", variant: null, category: "Babyprodukte", price: 0.3 },
    { name: "DVDs", variant: null, category: "Sonstiges", price: 1 },
    { name: "Red Bull Organics", variant: "24er Pack 0,25L", category: "Getränke inkl. Pfand", price: 14 },
    { name: "Kerzen", variant: null, category: "Deko", price: 0.5, priceNote: "je" },
  ];
  it("gruppiert Varianten und sortiert Kategorien", () => {
    const s = flyerSections(items);
    expect(s.map((x) => x.category)).toEqual(["Babyprodukte", "Lebensmittel", "Getränke inkl. Pfand", "Deko", "Sonstiges"]);
    expect(s[1].lines[0]).toEqual({ text: "Getrocknete Tomaten", price: "", mhd: "", sub: [{ text: "2kg", price: "5€", mhd: "" }, { text: "5kg", price: "10€", mhd: "MHD 12.10.26" }] });
    expect(s[2].lines[0]).toEqual({ text: "Red Bull Organics", price: "14€", mhd: "", sub: [{ text: "24er Pack 0,25L", price: "", mhd: "" }] });
    expect(s[3].lines[0].price).toBe("je 0,50€");
  });
  it("Messenger-Text", () => {
    const t = messengerText({ title: "Unsere Spendenempfehlungen", dateLabel: "Sa, 12.09.2026", eventTime: "11 Uhr" }, flyerSections(items));
    expect(t).toContain("*Unsere Spendenempfehlungen*");
    expect(t).toContain("📅 Sa, 12.09.2026, 11 Uhr");
    expect(t).toContain("• Getrocknete Tomaten\n   ◦ 2kg 5€\n   ◦ 5kg 10€ (MHD 12.10.26)");
  });
});

describe("Spenden: Dateinamen", () => {
  it("rät Produktnamen", () => {
    expect(nameFromFilename("IMG_1234.JPG")).toBe("");
    expect(nameFromFilename("WhatsApp Image 2026-09-07 at 09.49.jpeg")).toBe("");
    expect(nameFromFilename("kimchi-organics.jpg")).toBe("Kimchi organics");
    expect(nameFromFilename("Imbiss_Box.png")).toBe("Imbiss Box");
  });
});

describe("Spenden: Datum", () => {
  it("mit Wochentag", async () => {
    const { eventDateLabel } = await import("@/lib/layout");
    expect(eventDateLabel("2026-09-12")).toBe("Sa, 12.09.2026");
  });
});

describe("Spenden: Preisvorschlag und KI-Antwort", () => {
  it("rundet auf 10 Cent", async () => {
    const { suggestDonationPrice } = await import("@/lib/pricing");
    expect(suggestDonationPrice(2.49, 0.25)).toBe(0.6);
    expect(suggestDonationPrice(0.19, 0.25)).toBe(0.1);
    expect(suggestDonationPrice(null)).toBe(null);
  });
});

describe("KI-Stufen", () => {
  it("rechnet Kosten je Stufe", async () => {
    const { aiCostUsd, defaultAiMode } = await import("@/lib/ai-modes");
    expect(aiCostUsd("sparsam", 20000, 1000, 2)).toBeCloseTo(0.02 + 0.005 + 0.02);
    expect(aiCostUsd("genau", 20000, 1000, 4)).toBeCloseTo(0.04 + 0.01 + 0.04);
    expect(aiCostUsd("erkennen", 2000, 300, 0)).toBeLessThan(0.01);
    expect(aiCostUsd("minimal", 12000, 800, 1)).toBeCloseTo(0.012 + 0.004 + 0.01);
    expect(defaultAiMode()).toBe("sparsam");
  });
});

describe("Social-Media-Texte", () => {
  const ev = { title: "Spenden-Verteilung", dateLabel: "Sa, 12.10.2026", weekdayLong: "Samstag", eventTime: "11 Uhr", location: "Musterstadt Süd" };
  const products = [
    { name: "Kimchi", variant: "500 g", price: 0.8, priceNote: null },
    { name: "Kerzen", variant: null, price: 0.5, priceNote: "je" },
    { name: "Tee", variant: null, price: null, priceNote: null },
  ];
  it("Instagram mit Liste, Ort und Hashtags", async () => {
    const { instagramCaption, whenWhere, hashtag } = await import("@/lib/social");
    expect(whenWhere(ev)).toBe("Samstag, 12.10. um 11 Uhr in Musterstadt Süd");
    expect(hashtag("Musterstadt Süd")).toBe("#musterstadtsüd");
    const t = instagramCaption(ev, products, [], 2);
    expect(t).toContain("• Kimchi 500 g – 80 Cent");
    expect(t).toContain("• Kerzen – je 50 Cent");
    expect(t).toContain("…und 1 weitere Produkte.");
    expect(t).toContain("#foodsharing");
    expect(t).toContain("#musterstadtsüd");
  });
  it("TikTok kurz", async () => {
    const { tiktokCaption } = await import("@/lib/social");
    expect(tiktokCaption(ev, products)).toMatch(/^Samstag, 12\.10\. um 11 Uhr in Musterstadt Süd: 3 gerettete Produkte/);
  });
});

describe("Preis-Lage und -Farbe je Produkt", () => {
  it("nimmt gültige Werte und fällt sonst auf automatisch zurück", () => {
    expect(tileStyle({})).toEqual({ pos: "um", color: "weiss", custom: false });
    expect(tileStyle({ pos: "ol", color: "gelb" })).toEqual({ pos: "ol", color: "gelb", custom: true });
    expect(tileStyle({ pos: "xx", color: "lila" }).custom).toBe(false);
    expect(tileStyle(null).custom).toBe(false);
  });
});
