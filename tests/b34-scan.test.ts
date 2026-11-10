import { describe, expect, it } from "vitest";
import { budgetRest, ekMitRueckverguetung, heuteSumme, kapitalSatz, preisAusText, scanCode, teilenUrl, teilenZiel, type HeuteZeile } from "@/lib/scan/logic";

// B34.1 Scan-Modus: reine Logik (nur erfundene Werte).

const istShop = (u: string) => /(^|\/\/|\.)testshop\.example\//.test(u);

describe("B34.1 Rückvergütung", () => {
  it("senkt den effektiven EK", () => {
    expect(ekMitRueckverguetung(10, 2)).toBe(9.8);
    expect(ekMitRueckverguetung(19.99, 3)).toBe(19.39);
    expect(ekMitRueckverguetung(10, 0)).toBe(10);
    expect(ekMitRueckverguetung(10, null)).toBe(10);
  });
  it("begrenzt auf 0–50 %", () => {
    expect(ekMitRueckverguetung(10, -5)).toBe(10);
    expect(ekMitRueckverguetung(10, 80)).toBe(5);
  });
});

describe("B34.1 Preis und Code", () => {
  it("liest Preise deutsch und englisch", () => {
    expect(preisAusText("12,99")).toBe(12.99);
    expect(preisAusText("12.99 €")).toBe(12.99);
    expect(preisAusText("1.299,00")).toBe(1299);
    expect(preisAusText("")).toBeNull();
    expect(preisAusText("abc")).toBeNull();
  });
  it("erkennt EAN, ASIN, Amazon-Link und Kurzlink", () => {
    expect(scanCode("4006381333931")).toMatchObject({ ean: "4006381333931", asin: null, kurzlink: false });
    expect(scanCode("b0testscan")).toMatchObject({ asin: "B0TESTSCAN" });
    expect(scanCode("https://www.amazon.it/dp/B0TESTSCAN?ref=x")).toMatchObject({ asin: "B0TESTSCAN" });
    expect(scanCode("https://amzn.eu/d/abc123")).toMatchObject({ kurzlink: true, asin: null });
    expect(scanCode("hallo")).toBeNull();
  });
});

describe("B34.1 Teilen aus der Shop-/Amazon-App", () => {
  it("Amazon-Link mit kurzem Text → Scan online mit ASIN", () => {
    const z = teilenZiel({ title: "Testprodukt (erfunden)", text: "Schau mal: https://www.amazon.de/dp/B0TESTSCAN/ref=abc", url: null }, istShop);
    expect(z).toEqual({ modus: "online", code: "https://www.amazon.de/dp/B0TESTSCAN", shop: null, preis: null });
    expect(teilenUrl(z!)).toBe("/scan?modus=online&code=https%3A%2F%2Fwww.amazon.de%2Fdp%2FB0TESTSCAN");
    expect(teilenZiel({ url: "https://www.amazon.it/Testprodukt/dp/B0TESTSCAN?th=1" }, istShop)?.code).toBe("https://www.amazon.it/dp/B0TESTSCAN");
  });
  it("übernimmt genau einen Preis", () => {
    expect(teilenZiel({ text: "Testprodukt 24,99 € https://www.amazon.fr/dp/B0TESTSCAN" }, istShop)?.preis).toBe(24.99);
    expect(teilenZiel({ text: "Testprodukt 24,99 € statt 39,99 € https://www.amazon.fr/dp/B0TESTSCAN" }, istShop)?.preis).toBeNull();
  });
  it("Kurzlink bleibt Link (wird beim Prüfen aufgelöst)", () => {
    expect(teilenZiel({ url: "https://amzn.eu/d/abc123" }, istShop)).toMatchObject({ code: "https://amzn.eu/d/abc123" });
  });
  it("Link eines bekannten Shops → Online mit Shop-Link", () => {
    const z = teilenZiel({ title: "Testmixer", url: "https://www.testshop.example/p/123" }, istShop);
    expect(z).toEqual({ modus: "online", code: null, shop: "https://www.testshop.example/p/123", preis: null });
    expect(teilenUrl(z!)).toContain("shop=https%3A%2F%2Fwww.testshop.example%2Fp%2F123");
  });
  it("Deal-Posts, Dateien, fremde Links und ASIN in Texten bleiben im Deal-Eingang", () => {
    const post = "B0TESTDE01 Testsocken 2,10 netto ab 20 Stk\nROI 40 %\nBSR 1200\nVersand frei\nhttps://www.amazon.de/dp/B0TESTDE01";
    expect(teilenZiel({ text: post }, istShop)).toBeNull();
    expect(teilenZiel({ text: "https://www.amazon.de/dp/B0TESTSCAN", dateien: 1 }, istShop)).toBeNull();
    expect(teilenZiel({ text: "B0PFANNE05 Testpfanne 15,00 netto ab 20 Stk https://shop.example.test/pfanne" }, istShop)).toBeNull();
    expect(teilenZiel({ text: "B0TESTDE03 Testbecher 1,90 netto ab 30 Stk" }, istShop)).toBeNull();
    expect(teilenZiel({ text: "https://discord.com/channels/1/2/3" }, istShop)).toBeNull();
  });
  it("nur ASIN (mit Preis) → Scan online", () => {
    expect(teilenZiel({ text: "B0TESTSCAN" }, istShop)).toEqual({ modus: "online", code: "B0TESTSCAN", shop: null, preis: null });
    expect(teilenZiel({ text: "B0TESTSCAN 12,50 €" }, istShop)).toEqual({ modus: "online", code: "B0TESTSCAN", shop: null, preis: 12.5 });
  });
});

describe("B34.1 Heute gescannt", () => {
  const z = (o: Partial<HeuteZeile>): HeuteZeile => ({ ampel: "gruen", aktion: null, listeMenge: null, listePreis: null, preis: 10, rueckverguetung: 0, empfohleneMenge: null, menge: null, ...o });
  it("zählt Ampeln und summiert nur geplante Einkäufe", () => {
    const s = heuteSumme([
      z({ aktion: "einkaufsliste", listeMenge: 5, listePreis: 9.5 }),
      z({ ampel: "gelb", aktion: "kauf_vorbereitet", empfohleneMenge: 3, rueckverguetung: 2 }),
      z({ ampel: "rot", aktion: "verworfen", listeMenge: 100 }),
      z({ ampel: null }),
      z({ ampel: "gruen", aktion: "deal" }),
    ]);
    expect(s).toEqual({ scans: 5, gruen: 2, gelb: 1, rot: 1, offen: 1, geplant: 76.9, geplantStueck: 8, positionen: 2 });
  });
  it("Budget-Rest und Ampel", () => {
    expect(budgetRest({ jeTag: 0, gekauftHeute: 0, geplant: 50 })).toMatchObject({ rest: null, ampel: null });
    expect(budgetRest({ jeTag: 500, gekauftHeute: 100, geplant: 100 })).toMatchObject({ rest: 300, ampel: "gruen", text: "Restbudget heute 300,00 €" });
    expect(budgetRest({ jeTag: 500, gekauftHeute: 300, geplant: 120 })).toMatchObject({ rest: 80, ampel: "gelb" });
    expect(budgetRest({ jeTag: 500, gekauftHeute: 400, geplant: 150 })).toMatchObject({ rest: -50, ampel: "rot", text: "Tagesbudget um 50,00 € überschritten" });
  });
  it("Satz zur Kapital-Ampel des eigenen Bestands", () => {
    expect(kapitalSatz(null)).toBeNull();
    expect(kapitalSatz({ ampel: "rot", reichweite: 140, kapital: 812.4 })).toBe("Kapital-Ampel ROT – erst abverkaufen, Reichweite 140 Tage, 812 € gebunden.");
    expect(kapitalSatz({ ampel: "gelb", reichweite: 9999, kapital: null })).toBe("Kapital-Ampel GELB, keine Verkäufe.");
  });
});
