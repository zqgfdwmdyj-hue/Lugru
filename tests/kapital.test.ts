import { describe, expect, it } from "vitest";
import { aeltesteTage, bewerteKapital, breakEven, letzte90, type KapitalEingabe } from "@/lib/money/kapital";

// Kapital-Ampel: Rendite-Formel, Reichweite, Break-even, Ampel und Vorschläge. Erfundene Werte.

const basis: KapitalEingabe = { sku: "TEST-1", asin: "B0TEST0001", name: "Test", stueck: 100, ek: 5, gewinn90: 150, stueck90: 90, tageDaten: 90, verkaufProTag: 2, aeltesteTage: 30, preis: 19.99, breakEven: 12, trendProzent: 0 };

describe("Jahresrendite und Ampel", () => {
  it("Rendite = Gewinn 90 T × 365/90 ÷ gebundenes Kapital; grün bei Ziel und kurzer Reichweite", () => {
    const z = bewerteKapital(basis);
    expect(z.kapital).toBe(500);
    // 150 × 365/90 = 608,33 → ÷ 500 = 1,2167
    expect(z.rendite).toBe(1.22);
    expect(z.reichweite).toBe(50);
    expect(z.umschlag).toBe(3.65);
    expect(z.ampel).toBe("gruen");
    expect(z.vorschlaege).toEqual([]);
  });
  it("gelb: gute Rendite, aber Reichweite 61–120 Tage", () => {
    const z = bewerteKapital({ ...basis, verkaufProTag: 1 });
    expect(z).toMatchObject({ reichweite: 100, ampel: "gelb" });
    expect(z.gruende).toContain("Reichweite 100 Tage");
  });
  it("rot: Reichweite > 120 Tage, negative Rendite oder Preis unter Break-even – mit Vorschlägen", () => {
    const lang = bewerteKapital({ ...basis, verkaufProTag: 0.5, aeltesteTage: 200 });
    expect(lang.ampel).toBe("rot");
    expect(lang.vorschlaege).toEqual(["Nicht nachbestellen", "Abverkauf-Regel im Repricer (schrittweise senken bis Break-even)", "Liquidation/Abverkauf über Amazon (Lagerzuschlag droht)", "Teil über anderen Kanal verkaufen (eBay/B2B-Deal)"]);
    expect(bewerteKapital({ ...basis, gewinn90: -20 }).gruende).toContain("negative Rendite");
    const be = bewerteKapital({ ...basis, preis: 11.5 });
    expect(be.ampel).toBe("rot");
    expect(be.vorschlaege).toContain("Repricer-Untergrenze auf Break-even prüfen (BQool)");
  });
  it("ohne EK oder Verkaufsdaten: gelb mit Grund", () => {
    expect(bewerteKapital({ ...basis, ek: null })).toMatchObject({ ampel: "gelb", kapital: null, rendite: null });
    expect(bewerteKapital({ ...basis, ek: null }).gruende).toContain("EK fehlt");
    expect(bewerteKapital({ ...basis, verkaufProTag: null, stueck: 10, gewinn90: 0, stueck90: 0 }).gruende).toContain("keine Verkäufe");
  });
});

describe("Hilfen", () => {
  it("letzte 90 Tage aus Monatswerten (laufender Monat + volle + anteilig)", () => {
    // heute 29.10.: Okt 29 Tage + Sep 30 + Aug 31 = 90 → Juli zählt nicht
    const r = letzte90([{ month: "2026-10", netProfit: 290, units: 29 }, { month: "2026-09", netProfit: 300, units: 30 }, { month: "2026-08", netProfit: 310, units: 31 }, { month: "2026-07", netProfit: 999, units: 99 }], "2026-10-29");
    expect(r).toEqual({ gewinn: 900, stueck: 90, tage: 90 });
    const kurz = letzte90([{ month: "2026-10", netProfit: 100, units: 10 }], "2026-10-15");
    expect(kurz.tage).toBe(15);
  });
  it("Break-even brutto", () => {
    // (5 + 3) / (1/1,19 − 0,15) = 8 / 0,69034 = 11,59
    expect(breakEven({ ek: 5, fba: 3, provision: 0.15, mwst: 0.19 })).toBe(11.59);
    expect(breakEven({ ek: null, fba: 3, provision: 0.15, mwst: 0.19 })).toBeNull();
  });
  it("ältestes Altersband", () => {
    expect(aeltesteTage({ "0_90": 5, "91_180": 2, "181_270": 0 })).toBe(91);
    expect(aeltesteTage({ "365_plus": 1 })).toBe(365);
    expect(aeltesteTage({})).toBeNull();
  });
});

// A6: Preis 0 = kein aktives Angebot (nicht „unter Break-even“); Break-even je Land mit dessen USt.
describe("Preis 0 und Break-even je Land", () => {
  it("Preis 0 → „kein aktives Angebot“, nicht unter Break-even, nicht grün", () => {
    const z = bewerteKapital({ ...basis, preis: 0 });
    expect(z.keinAngebot).toBe(true);
    expect(z.unterBreakEven).toBe(false);
    expect(z.gruende[0]).toBe("kein aktives Angebot (Preis 0)");
    expect(z.gruende.join(" ")).not.toContain("unter Break-even");
    expect(z.ampel).not.toBe("gruen");
    expect(z.vorschlaege).toContain("Angebot prüfen und wieder aktivieren (Bestand ohne Angebot)");
  });
  it("Break-even steigt mit der USt (DE 19 % < FR 20 % < ES 21 % < IT 22 %)", () => {
    const be = (mwst: number) => breakEven({ ek: 5, fba: 3, provision: 0.15, mwst })!;
    expect(be(0.19)).toBeLessThan(be(0.2));
    expect(be(0.2)).toBeLessThan(be(0.21));
    expect(be(0.21)).toBeLessThan(be(0.22));
  });
});
