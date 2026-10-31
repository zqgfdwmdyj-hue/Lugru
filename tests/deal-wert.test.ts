import { describe, expect, it } from "vitest";
import { amazonSeite, angebotsLink, bestellbestaetigung, budgetPruefen, kaufText, passtZuDeal, shopAus } from "@/lib/deal-eingang/kauf-logic";
import { abstand, aehnliche, bewaehrt, dealWert, eigenesLabel, kennzahlenWert, lernBericht, lugruLabel, lugruMerkmale, merkmaleAus, modellLernen, modellWahrscheinlichkeit, type HistorieDeal, type KeepaLite } from "@/lib/deal-eingang/wert-logic";

// Deal-Eingang Abschnitt 10 (Kaufen mit einem Tap) und 11 (lernender Deal-Wert): reine Logik mit erfundenen Daten.

describe("Budget-Grenzen", () => {
  const ohne = { jeDeal: 0, jeTag: 0, jeWoche: 0 };
  it("ohne Grenzen immer ok, kein Restbudget", () => {
    expect(budgetPruefen(5000, ohne, { tag: 0, woche: 0 })).toEqual({ ok: true, hinweis: null, restWoche: null, restTag: null });
  });
  it("über der Grenze je Deal → nicht ok mit Hinweis", () => {
    const p = budgetPruefen(1200, { jeDeal: 1000, jeTag: 0, jeWoche: 0 }, { tag: 0, woche: 0 });
    expect(p.ok).toBe(false);
    expect(p.hinweis).toMatch(/^Budget: 1\.200 € über der Grenze je Deal \(1\.000 €\)/);
  });
  it("Woche schon fast verbraucht → Rest und Hinweis", () => {
    const p = budgetPruefen(800, { jeDeal: 0, jeTag: 0, jeWoche: 3000 }, { tag: 0, woche: 2500 });
    expect(p).toMatchObject({ ok: false, restWoche: 500 });
    expect(p.hinweis).toContain("diese Woche noch 500 €");
  });
  it("Tagesgrenze greift vor der Woche", () => {
    const p = budgetPruefen(600, { jeDeal: 0, jeTag: 500, jeWoche: 3000 }, { tag: 0, woche: 0 });
    expect(p.hinweis).toContain("heute noch 500 €");
  });
  it("ohne Kapitalbedarf (kein EK) kein Hinweis", () => {
    expect(budgetPruefen(null, { jeDeal: 100, jeTag: 0, jeWoche: 0 }, { tag: 0, woche: 0 }).ok).toBe(true);
  });
});

describe("Direktlink und Kauf-Meldung", () => {
  it("erster Shop-Link aus der Nachricht, Discord/WhatsApp/Amazon/Keepa übersprungen", () => {
    const text = "Schau mal https://discord.com/channels/1/2 und https://wa.me/49000 https://keepa.com/#!product/3-B0TEST0001 https://www.amazon.de/dp/B0TEST0001 → https://shop.example.test/angebot?id=7.";
    expect(angebotsLink(text, "B0TEST0001", "DE")).toBe("https://shop.example.test/angebot?id=7");
  });
  it("ohne Shop-Link die Amazon-Seite im besten Land", () => {
    expect(angebotsLink("nur Text", "B0TEST0001", "FR")).toBe("https://www.amazon.fr/dp/B0TEST0001");
    expect(amazonSeite("B0TEST0001", "UK")).toBe("https://www.amazon.co.uk/dp/B0TEST0001");
    expect(angebotsLink("nur Text", null, null)).toBeNull();
  });
  it("Text: Menge, max. EK, Restbudget, Frist, Deal-Wert", () => {
    const t = kaufText({ titel: "Testartikel", name: null, ekNetto: 9.5, bestesLand: "DE", roi: 42, gewinn: 4, empfohlen: 60, kapitalbedarf: 570, maxEk: [{ land: "DE", ek: 12.3 }], gueltigBis: "02.11." }, { restWoche: 1430, wert: 78 });
    expect(t).toContain("Empf. 60 Stk (570 €)");
    expect(t).toContain("max. EK 12,30 €");
    expect(t).toContain("Budget Woche noch 1.430 €");
    expect(t).toContain("gültig bis 02.11.");
    expect(t).toContain("passt zu dir 78/100");
  });
});

describe("Bestellbestätigung aus der Mail", () => {
  it("Amazon: ASIN aus dem Produktlink, Menge, Preis, Bestellnummer", () => {
    const b = bestellbestaetigung({
      von: "Amazon.de <bestellbestaetigung@amazon.de>",
      betreff: "Ihre Amazon.de Bestellung von „Testartikel“",
      text: "Bestellnummer 303-1234567-1234567\nTestartikel https://www.amazon.de/dp/B0TEST0001/ref=x\nMenge: 60\nEinzelpreis: 9,50 €",
    });
    expect(b).toEqual({ shop: "Amazon", bestellnr: "303-1234567-1234567", positionen: [{ asin: "B0TEST0001", titel: null, menge: 60, preis: 9.5 }] });
  });
  it("Amazon.de-Betreff „Bestellt: …“ wird erkannt", () => {
    expect(bestellbestaetigung({ von: "auto-confirm@amazon.de", betreff: "Bestellt: „Testartikel“ und 1 weiterer Artikel", text: "https://www.amazon.de/gp/product/B0TEST0001 Menge: 2" })?.positionen[0]).toMatchObject({ asin: "B0TEST0001", menge: 2 });
  });
  it("Shop ohne ASIN: Bestellnummer + Menge; Shop aus der Absender-Domain", () => {
    const b = bestellbestaetigung({ von: "Testshop <bestellung@shop-test.example>", betreff: "Bestellbestätigung Nr. 4711", text: "Bestellnummer: AB-47110\n60 x Testartikel Pearl Styler je 9,50 €" });
    expect(b?.shop).toBe("shop-test.example");
    expect(b?.bestellnr).toBe("AB-47110");
    expect(b?.positionen[0]).toMatchObject({ asin: null, menge: 60, preis: 9.5 });
    expect(shopAus("noreply.mail@news.example")).toBe("news.example");
    expect(shopAus("Shop <bestellung@news.shop-test.example>")).toBe("shop-test.example");
  });
  it("Versand-, Storno- und Rechnungsmails zählen nicht", () => {
    for (const betreff of ["Ihre Bestellung wurde versandt", "Stornierung Ihrer Bestellung", "Rechnung zu Ihrer Bestellung"]) {
      expect(bestellbestaetigung({ von: "x@amazon.de", betreff, text: "https://www.amazon.de/dp/B0TEST0001 Menge: 2" })).toBeNull();
    }
    expect(bestellbestaetigung({ von: "x@test.example", betreff: "Newsletter", text: "Menge: 2" })).toBeNull();
  });
  it("Zuordnung: ASIN sicher, sonst gemeinsame Titelwörter", () => {
    expect(passtZuDeal({ asin: "B0TEST0001", titel: null }, { asin: "B0TEST0001", titel: null, name: null }, "")).toBe(true);
    expect(passtZuDeal({ asin: "B0TEST0002", titel: null }, { asin: "B0TEST0001", titel: null, name: null }, "")).toBe(false);
    expect(passtZuDeal({ asin: null, titel: null }, { asin: null, titel: "Testmarke Pearl Styler Gold", name: null }, "60 x Testmarke Pearl Styler Gold je 9,50")).toBe(true);
    expect(passtZuDeal({ asin: null, titel: null }, { asin: null, titel: "Testmarke Pearl Styler Gold", name: null }, "Ganz andere Ware")).toBe(false);
  });
});

// ---- Abschnitt 11 ------------------------------------------------------------------------------------------------

/** Erfundener Keepa-Verlauf: 200 Tage, Buy Box um 30 €, Angebote von 10 auf 12. */
function keepa(o: { schwanken?: boolean; einbruch?: boolean } = {}): KeepaLite {
  const verlauf: KeepaLite["verlauf"] = [];
  const ende = Date.parse("2026-10-30T00:00:00Z");
  for (let i = 199; i >= 0; i--) {
    const tag = new Date(ende - i * 86_400_000).toISOString().slice(0, 10);
    let bb = 30 + (o.schwanken ? (i % 2 ? 9 : -9) : 0);
    if (o.einbruch && i >= 50 && i < 55) bb = 20;
    verlauf.push([tag, bb, null, i > 20 ? 10 : 12, 5000]);
  }
  return {
    aktuell: { buybox: 30, angebote_neu: 12, angebote_fba: 9, angebote_fbm: 3, verkaufsrang: 4000, monatlich_verkauft: 200 },
    kennzahlen: { "30": { buybox: { schnitt: 30 }, rang: { schnitt: 4500 }, amazon_nicht_auf_lager_prozent: null }, "90": { buybox: { schnitt: 30 }, rang: { schnitt: 5000 }, amazon_nicht_auf_lager_prozent: 100 }, "180": { buybox: { schnitt: 30 }, rang: { schnitt: 5000 }, amazon_nicht_auf_lager_prozent: null } },
    verlauf,
  };
}
const kontext = { marke: "Testmarke", kategorie: null, quelle: "Testhändler", weg: "manuell", jetzt: new Date("2026-10-30T10:00:00Z"), kapitalAmpel: null, bestand: null };

describe("Merkmale aus Keepa (Schnappschuss beim Eingang)", () => {
  it("stabiler Chart: Schwankung klein, keine Einbrüche, EK zum 12-Monats-Tief, Angebote-Trend", () => {
    const m = merkmaleAus(keepa(), { land: "DE", ekNetto: 15, roi: 40, marge: 20, amazonProzent: 0, angebote: null }, kontext);
    expect(m.schwankung90).toBe(0);
    expect(m.einbrueche180).toBe(0);
    expect(m.tief12).toBe(30);
    expect(m.ekZuTief).toBe(50);
    expect(m.angeboteTrend30).toBe(20);
    expect(m.fbaAnteil).toBe(75);
    expect(m.rangTrend).toBe(-20);
    expect(m.stunde).toBe(11);
  });
  it("Einbruch und Schwankung werden erkannt; ohne Keepa bleiben die Felder leer", () => {
    expect(merkmaleAus(keepa({ einbruch: true }), { land: "DE", ekNetto: 15, roi: 40, marge: 20, amazonProzent: 0, angebote: null }, kontext).einbrueche180).toBe(1);
    expect(merkmaleAus(keepa({ schwanken: true }), { land: "DE", ekNetto: 15, roi: 40, marge: 20, amazonProzent: 0, angebote: null }, kontext).schwankung90).toBeCloseTo(30, 0);
    const leer = merkmaleAus(null, { land: "DE", ekNetto: 15, roi: 40, marge: 20, amazonProzent: null, angebote: 7 }, kontext);
    expect(leer).toMatchObject({ bbJetzt: null, schwankung90: null, einbrueche180: null, angebote: 7, roi: 40 });
  });
});

describe("Deal-Wert", () => {
  it("Kennzahlen: guter ROI + stabiler Chart über 50; Amazon in der Buy Box und schwacher ROI darunter", () => {
    const gut = kennzahlenWert({ roi: 45, schwankung90: 3, einbrueche180: 0, amazonAnteil: 0 }, 25);
    expect(gut.wert).toBeGreaterThan(70);
    expect(gut.beitraege.map((b) => b.text)).toContain("Chart stabil");
    const schlecht = kennzahlenWert({ roi: 12, amazonAnteil: 60, angeboteTrend30: 50 }, 25);
    expect(schlecht.wert).toBeLessThan(25);
  });
  it("Begründung „Passt zu dir (X/100): … Gegen: …“ und ähnliche frühere Deals", () => {
    const historie: HistorieDeal[] = [1, 2, 3].map((i) => ({ id: `d${i}`, quelle: "eigen", titel: `Früher ${i}`, asin: `B0TEST000${i}`, datum: "2026-09-01", merkmale: { roi: 40 + i, schwankung90: 4, amazonAnteil: 0 }, label: 1, gewicht: 1.5, ergebnis: "gekauft, realer ROI 35 %", realerRoi: 35 }));
    historie.push({ id: null, quelle: "lugru", titel: "Gruppen-Deal", asin: "B0TEST0009", datum: "2026-08-01", merkmale: { roi: 38, marge: 18 }, label: 0.75, gewicht: 0.45, ergebnis: "3× ✅ in der Gruppe", kaeufe: 3 });
    const w = dealWert({ roi: 42, schwankung90: 4, amazonAnteil: 0, marge: 18, angeboteTrend30: 40 }, { zielRoi: 25, ampel: "gruen", historie });
    expect(w.begruendung).toMatch(/^Passt zu dir \(\d+\/100\): 3 von 3 ähnlichen Deals gekauft\/gut, Ø realer ROI 35 %/);
    expect(w.begruendung).toContain("Gegen: Angebote +40 % in 30 T");
    expect(w.dafuer[1]).toBe("Lugru-Gruppe: 3 Käufe bei ähnlichen Deals");
    expect(w.begruendung).toContain("Lugru-Gruppe: 3 Käufe");
    expect(w.aehnliche[0]).toMatchObject({ quelle: "eigen" });
    expect(w.aehnliche).toHaveLength(4);
    expect(w.verfahren).toBe("kennzahlen");
    expect(w.wert).toBeGreaterThan(70);
  });
  it("Rot-Kriterien der Ampel gelten immer: höchstens 30 und als gedeckelt markiert", () => {
    const w = dealWert({ roi: 90, schwankung90: 2, amazonAnteil: 0 }, { zielRoi: 25, ampel: "rot", historie: [] });
    expect(w).toMatchObject({ wert: 30, gedeckelt: true });
    expect(w.dagegen[0]).toContain("Ampel rot");
  });
  it("Abstand nur über gemeinsame Merkmale (mind. 2), nächste Nachbarn zuerst", () => {
    expect(abstand({ roi: 40 }, { roi: 40 })).toBeNull();
    expect(abstand({ roi: 40, marge: 20 }, { roi: 40, marge: 20 })).toBe(0);
    const h = [10, 40, 90].map((roi, i) => ({ id: String(i), quelle: "eigen" as const, titel: null, asin: null, datum: "", merkmale: { roi, marge: 20 }, label: 1, gewicht: 1, ergebnis: "" }));
    expect(aehnliche({ roi: 45, marge: 20 }, h).map((x) => x.merkmale.roi)).toEqual([40, 10, 90]);
  });
});

describe("Lern-Signale", () => {
  it("eigene Deals: gekauft + realer ROI ≥ Ziel = 1; Verlust = 0; 👍/👎; verworfen schwach; offen ohne Signal = kein Eintrag", () => {
    expect(eigenesLabel({ status: "gekauft", daumen: null, realerRoi: 30 }, 25)?.label).toBe(1);
    expect(eigenesLabel({ status: "gekauft", daumen: null, realerRoi: -5 }, 25)?.label).toBe(0);
    expect(eigenesLabel({ status: "neu", daumen: "hoch", realerRoi: null }, 25)?.label).toBe(0.8);
    expect(eigenesLabel({ status: "neu", daumen: "runter", realerRoi: null }, 25)?.label).toBe(0);
    expect(eigenesLabel({ status: "verworfen", daumen: null, realerRoi: null }, 25)).toMatchObject({ label: 0.1, gewicht: 0.6 });
    expect(eigenesLabel({ status: "neu", daumen: null, realerRoi: null }, 25)).toBeNull();
  });
  it("Lugru: nur mit ✅ (keine Reaktion ≠ nicht gekauft), schwach gewichtet; bewährt stärkt, nicht bewährt schwächt", () => {
    expect(lugruLabel({ kaeufe: 0, bewaehrt: null })).toBeNull();
    const offen = lugruLabel({ kaeufe: 2, bewaehrt: null })!;
    const gut = lugruLabel({ kaeufe: 2, bewaehrt: true })!;
    const schlecht = lugruLabel({ kaeufe: 2, bewaehrt: false })!;
    expect(offen.gewicht).toBeLessThan(1);
    expect(gut.gewicht).toBeGreaterThan(offen.gewicht);
    expect(gut.label).toBeGreaterThan(offen.label);
    expect(schlecht.label).toBeLessThan(offen.label);
    expect(lugruMerkmale({ ekEur: 11.9, gewinnEur: 5, margeProzent: 20, verkaeufeMonat: 100 })).toEqual({ roi: 50, marge: 20, monatlichVerkauft: 100 });
  });
  it("bewährt: Preis hielt und Angebote stiegen kaum; sonst nicht bewährt mit Grund", () => {
    const k = keepa();
    expect(bewaehrt({ vkEur: 31, gepostetAm: "2026-07-01T10:00:00Z" }, k)).toEqual({ bewaehrt: true, grund: "Preis hielt" });
    expect(bewaehrt({ vkEur: 40, gepostetAm: "2026-07-01T10:00:00Z" }, k).bewaehrt).toBe(false);
    expect(bewaehrt({ vkEur: 31, gepostetAm: "2026-07-01T10:00:00Z" }, { ...k, aktuell: { ...k.aktuell, angebote_neu: 20 } })).toEqual({ bewaehrt: false, grund: "Angebote +100 %" });
    expect(bewaehrt({ vkEur: null, gepostetAm: "2026-07-01T10:00:00Z" }, k).bewaehrt).toBeNull();
  });
  it("Lernmodell erst ab 100 Deals; lernt „hoher ROI = gut“", () => {
    const daten = Array.from({ length: 120 }, (_, i) => ({ merkmale: { roi: 5 + (i % 60), marge: 15 }, label: 5 + (i % 60) >= 30 ? 1 : 0, gewicht: 1 }));
    expect(modellLernen(daten.slice(0, 99))).toBeNull();
    const mo = modellLernen(daten)!;
    expect(mo.n).toBe(120);
    expect(modellWahrscheinlichkeit(mo, { roi: 55 })).toBeGreaterThan(0.8);
    expect(modellWahrscheinlichkeit(mo, { roi: 8 })).toBeLessThan(0.2);
    const mitModell = dealWert({ roi: 55, marge: 15 }, { zielRoi: 25, ampel: "gruen", historie: [], modell: mo });
    expect(mitModell.verfahren).toBe("modell");
  });
});

describe("Monatsbericht", () => {
  it("Trefferquote über der Schwelle, verpasste gute Deals, Fehlkäufe", () => {
    const b = lernBericht(
      [
        { id: "1", titel: "A", datum: "2026-09-02", wert: 82, status: "gekauft", daumen: null, realerRoi: 40 },
        { id: "2", titel: "B", datum: "2026-09-03", wert: 75, status: "verworfen", daumen: null, realerRoi: null },
        { id: "3", titel: "C", datum: "2026-09-04", wert: 40, status: "neu", daumen: "hoch", realerRoi: null },
        { id: "4", titel: "D", datum: "2026-09-05", wert: 71, status: "gekauft", daumen: null, realerRoi: -12 },
        { id: "5", titel: "E", datum: "2026-09-06", wert: null, status: "neu", daumen: null, realerRoi: null },
      ],
      { schwelle: 70, zielRoi: 25 },
    );
    expect(b).toMatchObject({ deals: 5, mitWert: 4, ueberSchwelle: 3, trefferBasis: 3, trefferquote: 33 });
    expect(b.verpasst.map((d) => d.id)).toEqual(["3"]);
    expect(b.fehlkaeufe.map((d) => d.id)).toEqual(["4"]);
  });
});
