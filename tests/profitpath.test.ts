import { describe, expect, it } from "vitest";
import { asinAus, betrag, modulAus, profitPathAngebot } from "@/lib/deal-eingang/profitpath-logic";

// ProfitPath-Nachrichten (erfundene Beispiele im Aufbau eines Discord-Embeds).

describe("ProfitPath-Nachricht lesen", () => {
  it("Beträge in deutschen und englischen Schreibweisen", () => {
    expect(betrag("€12,34")).toBe(12.34);
    expect(betrag("12.34 €")).toBe(12.34);
    expect(betrag("EUR 1.234,50")).toBe(1234.5);
    expect(betrag("£1,299.00")).toBe(1299);
    expect(betrag("**28.5%**")).toBe(28.5);
    expect(betrag("–")).toBeNull();
  });

  it("ASIN aus Amazon-Links und Feldern", () => {
    expect(asinAus("https://www.amazon.de/dp/B0TESTPP01?th=1")).toBe("B0TESTPP01");
    expect(asinAus("https://www.amazon.fr/Testprodukt/dp/B0TESTPP02/ref=x")).toBe("B0TESTPP02");
    expect(asinAus("ASIN: **B0TESTPP03**")).toBe("B0TESTPP03");
    expect(asinAus("kein Link")).toBeNull();
  });

  it("Embed mit Feldern → Angebot mit EK brutto, VK, Gewinn, ROI", () => {
    const a = profitPathAngebot({
      id: "1",
      embeds: [{ title: "Testmarke Haarspray 300ml (erfunden)", url: "https://www.amazon.de/dp/B0TESTPP01", fields: [{ name: "Buy Cost", value: "€8,99" }, { name: "Sell Price", value: "€19,90" }, { name: "Profit", value: "€4,12" }, { name: "ROI", value: "45.8%" }, { name: "Store", value: "Testshop" }] }],
    })!;
    expect(a.angebot).toMatchObject({ asin: "B0TESTPP01", ek: 8.99, ekNetto: false, name: "Testmarke Haarspray 300ml (erfunden)" });
    expect(a).toMatchObject({ vk: 19.9, gewinn: 4.12, roi: 45.8, shop: "Testshop", unsicher: false });
  });

  it("Text ohne ASIN → unsicher; ohne ASIN und EK → nichts", () => {
    const a = profitPathAngebot({ id: "2", content: "Testmarke Shampoo\nBuy Price: 3,50 €\nSell Price: 9,99 €" })!;
    expect(a.unsicher).toBe(true);
    expect(a.angebot.ek).toBe(3.5);
    expect(profitPathAngebot({ id: "3", content: "Hallo zusammen" })).toBeNull();
  });

  it("Modul aus dem Kanalnamen", () => {
    expect(modulAus("dealwatch-drogerie")).toBe("Dealwatch");
    expect(modulAus("spysearch-alerts")).toBe("SpySearch");
    expect(modulAus("a2a-de-fr")).toBe("A2A Search");
    expect(modulAus("sonstiges")).toBe("sonstiges");
  });
});
