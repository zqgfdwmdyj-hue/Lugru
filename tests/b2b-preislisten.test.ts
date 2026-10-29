import { describe, expect, it } from "vitest";
import { kiSpaltenPrompt, kundenpreisVorschlag, leseKiSpalten } from "@/lib/b2b/preislisten-logik";

// Preislisten für B2B-Deals: KI-Spaltenzuordnung prüfen, Kundenpreis-Vorschlag und Ampel. Erfundene Werte.

const KOPF = ["Code-Nr.", "Barcode-Nummer", "Amazon-Nr", "Produkt", "Netto/Stk.", "Lager"];

describe("KI-Spaltenzuordnung", () => {
  it("Prompt nennt Spalten und Beispielzeilen", () => {
    const p = kiSpaltenPrompt(KOPF, [["A1", "4000000000017", "B0TEST0001", "Testsocken", "2,10", "50"]]);
    expect(p).toContain(JSON.stringify(KOPF));
    expect(p).toContain("Testsocken");
  });
  it("übernimmt nur vorhandene Spalten, keine doppelt, Artikelnummer ersatzweise EAN", () => {
    const m = leseKiSpalten('Hier: {"ean": "Barcode-Nummer", "asin": "Amazon-Nr", "supplierSku": null, "title": "Produkt", "price": "Netto/Stk.", "stock": "Gibt es nicht", "moq": "Produkt"}', KOPF);
    expect(m).toEqual({ ean: "Barcode-Nummer", asin: "Amazon-Nr", supplierSku: "Barcode-Nummer", title: "Produkt", price: "Netto/Stk." });
  });
  it("Unsinn → null", () => {
    expect(leseKiSpalten("keine Ahnung", KOPF)).toBeNull();
    expect(leseKiSpalten("{kaputt", KOPF)).toBeNull();
  });
});

describe("Kundenpreis-Vorschlag und Ampel", () => {
  const basis = { vkEur: 29.99, land: "DE", gebuehren: 8, minRoi: 0.15, prep: 0.6, versandAnteil: 0, minMargeProzent: 10, amazonProzent: 10 };
  it("höchster Preis mit Mindest-ROI für den Kunden; grün bei genug Marge", () => {
    // netto 25,2017 − 8 = 17,2017; / 1,15 = 14,958; − 0,60 = 14,358 → 14,35
    const v = kundenpreisVorschlag({ ...basis, ek: 9 });
    expect(v.preis).toBe(14.35);
    expect(v.marge).toBe(59.44);
    expect(v.ampel).toBe("gruen");
  });
  it("gelb, wenn Amazon die Buy Box meist hält oder die Marge knapp ist", () => {
    expect(kundenpreisVorschlag({ ...basis, ek: 9, amazonProzent: 70 }).ampel).toBe("gelb");
    expect(kundenpreisVorschlag({ ...basis, ek: 13.5 }).ampel).toBe("gelb");
  });
  it("rot ohne Spielraum oder ohne Marktdaten", () => {
    expect(kundenpreisVorschlag({ ...basis, ek: 15 }).ampel).toBe("rot");
    expect(kundenpreisVorschlag({ ...basis, vkEur: null, ek: 5 })).toEqual({ preis: null, marge: null, ampel: "rot" });
  });
});
