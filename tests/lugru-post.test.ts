import { describe, expect, it } from "vitest";
import { dublettenSchluessel, kaeufeAus, lugruPostLesen, nachrichtLink, reaktionenFaellig, reaktionenZaehlen, zahl, zeitAusId } from "@/lib/lugru-deals/post-logic";

// Lugru-Deal-Posts aus Discord (Weg B) – erfundene Produkte, Shops und ASINs.

const post = [
  "🛒 Testmarke Tastenfeld Pro, programmierbar @everyone",
  "🏬 [testshop.de](<https://www.testshop.de/produkt/tastenfeld-123.html>)",
  "🏬 [zweitshop.de](https://www.zweitshop.de/p/123)",
  "💰 EK: 99.99 € Brutto inkl. Versand",
  "💸 VK: 164.99 €  [Amazon.DE](https://www.amazon.de/dp/B0TESTLG01?tag=x)",
  "ℹ️ Amazon.DE: 50+ Verkäufe",
  "🤑 Gewinn: 30.9 € / 19 % Marge",
  "📊 [ArbitrageOne Export](https://app.arbitrageone.de/analyze?asin=B0TESTLG01)",
].join("\n");

describe("Lugru-Post lesen", () => {
  it("Post wie von Hand bzw. vom Tool: Titel, ASIN aus dem Amazon-Link, Shop, EK, VK, Verkäufe, Gewinn, Marge", () => {
    expect(lugruPostLesen(post)).toMatchObject({
      titel: "Testmarke Tastenfeld Pro, programmierbar",
      asin: "B0TESTLG01",
      asinUnsicher: false,
      quellmarkt: "DE",
      zielmarkt: "DE",
      shop: "testshop.de",
      shopUrl: "https://www.testshop.de/produkt/tastenfeld-123.html",
      ekEur: 99.99,
      ekNetto: false,
      ekNotiz: "Brutto inkl. Versand",
      vkEur: 164.99,
      verkaeufeMonat: 50,
      gewinnEur: 30.9,
      margeProzent: 19,
      ausverkauft: false,
    });
  });
  it("Tausenderpunkt, negativer Gewinn, Pan-EU, Max-Menge, Zielmarkt FR, Einkauf bei Amazon.ES", () => {
    const t = ["🛒 Testbohrhammer X1 <@&1234567890>", "🏬 [amazon.es](https://www.amazon.es/dp/B0TESTBH01)", "💰 EK: 1.130,56 € Brutto inkl. Versand (3er cart)", "📦 max. 3 Stück", "💸 VK: 1.207,49 € [Amazon.FR](https://www.amazon.fr/dp/B0TESTBH01)", "ℹ️ Amazon.FR: 40 Verkäufe", "🤑 Gewinn: -5,77 € / -19,2 % Marge", "🇪🇺 Pan-EU: 5,12 € / 17,1 %"].join("\n");
    expect(lugruPostLesen(t)).toMatchObject({ titel: "Testbohrhammer X1", asin: "B0TESTBH01", quellmarkt: "ES", shop: "Amazon.ES", zielmarkt: "FR", ekEur: 1130.56, vkEur: 1207.49, gewinnEur: -5.77, margeProzent: -19.2, panEuGewinnEur: 5.12, maxMenge: 3, verkaeufeMonat: 40 });
  });
  it("Ausverkauft und netto beim Großhändler ohne Link; ASIN frei im Text = unsicher", () => {
    const t = ["❌ **AUSVERKAUFT** ❌", "~~🛒 Testbausatz 4211 B0TESTBS01 @here~~", "~~🏬 Testgroßhandel~~", "~~💰 EK: 250 € Netto~~", "~~💸 VK: 399,00 €~~", "~~🤑 Gewinn: 41,20 € / 10,3 % Marge~~"].join("\n");
    expect(lugruPostLesen(t)).toMatchObject({ ausverkauft: true, titel: "Testbausatz 4211", shop: "Testgroßhandel", ekNetto: true, ekEur: 250, asin: "B0TESTBS01", asinUnsicher: true, gewinnEur: 41.2, margeProzent: 10.3 });
  });
  it("Keine Deals: Unterhaltung, ohne Gewinnzeile, leer; unplausibler Gewinn", () => {
    expect(lugruPostLesen("Hat jemand noch Versandkartons übrig?")).toBeNull();
    expect(lugruPostLesen("🛒 Testprodukt\n💰 EK: 99 €")).toBeNull();
    expect(lugruPostLesen("")).toBeNull();
    expect(lugruPostLesen("🛒 Testprodukt\n💸 VK: 10 €\n🤑 Gewinn: 500 €")).toBeNull();
  });
  it("Zahlen in beiden Schreibweisen", () => {
    expect(zahl("1.299,99")).toBe(1299.99);
    expect(zahl("1,299.99")).toBe(1299.99);
    expect(zahl("30.9")).toBe(30.9);
    expect(zahl("1.299")).toBe(1299);
    expect(zahl("−5,77")).toBe(-5.77);
    expect(zahl("x")).toBeNull();
  });
});

describe("Reaktionen und Abgleich", () => {
  it("nur Anzahlen je Emoji, eigene Bot-Reaktion abgezogen; ✅ = gekauft, ❌ = weg", () => {
    const r = reaktionenZaehlen([{ emoji: { name: "✅" }, count: 4, me: true }, { emoji: { name: "🔥" }, count: 2 }, { emoji: { name: "❌" }, count: 1 }, { emoji: { id: "1", name: "lugru" }, count: 3 }]);
    expect(r).toEqual({ "✅": 3, "🔥": 2, "❌": 1, lugru: 3 });
    expect(kaeufeAus(r)).toEqual({ kaeufe: 3, nichtVerfuegbar: 1, summe: 9 });
    expect(kaeufeAus(r, { gekauft: ["lugru"] }).kaeufe).toBe(6);
  });
  it("Takt: 48 Std. alle 5 Min., bis 30 Tage stündlich, danach nicht", () => {
    const jetzt = new Date("2026-10-31T12:00:00Z");
    const vor = (min: number) => new Date(jetzt.getTime() - min * 60_000);
    expect(reaktionenFaellig(vor(60), null, jetzt)).toBe(true);
    expect(reaktionenFaellig(vor(60), vor(3), jetzt)).toBe(false);
    expect(reaktionenFaellig(vor(60), vor(5), jetzt)).toBe(true);
    expect(reaktionenFaellig(vor(3 * 1440), vor(30), jetzt)).toBe(false);
    expect(reaktionenFaellig(vor(3 * 1440), vor(61), jetzt)).toBe(true);
    expect(reaktionenFaellig(vor(31 * 1440), null, jetzt)).toBe(false);
  });
  it("Link zur Nachricht, Zeit aus der Discord-ID, Dubletten-Schlüssel", () => {
    expect(nachrichtLink("1", "2", "3")).toBe("https://discord.com/channels/1/2/3");
    expect(nachrichtLink(null, "2", "3")).toBeNull();
    expect(zeitAusId("1300000000000000000").getUTCFullYear()).toBe(2024);
    expect(dublettenSchluessel({ asin: "B0TESTLG01", shop: "Testshop.de" })).toBe("B0TESTLG01|testshop.de");
    expect(dublettenSchluessel({ asin: null, shop: "x" })).toBeNull();
  });
});
