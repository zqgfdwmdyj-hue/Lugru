import { describe, expect, it } from "vitest";
import { ekFuerMenge, leseStaffel, DealEingabe } from "@/lib/b2b/eingabe";
import { besterMarkt, kundeAusPrognose } from "@/lib/b2b/logic";
import { exportCsv } from "@/lib/b2b/export";

// B2B-Deals: Eingaben, Staffel, Kundenrechnung aus gespeicherter Prognose, Export fürs Prep-Tool. Erfundene Werte.

describe("Staffel", () => {
  it("liest verschiedene Schreibweisen und sortiert", () => {
    expect(leseStaffel("ab 250: 3,70; ab 100: 3,90")).toEqual([{ ab: 100, preis: 3.9 }, { ab: 250, preis: 3.7 }]);
    expect(leseStaffel("50=4.20 100 Stück: 4,00")).toEqual([{ ab: 50, preis: 4.2 }, { ab: 100, preis: 4 }]);
    expect(leseStaffel("")).toEqual([]);
  });
  it("EK je Bestellmenge", () => {
    const st = [{ ab: 100, preis: 3.9 }, { ab: 250, preis: 3.7 }];
    expect(ekFuerMenge(4.2, st, 60)).toBe(4.2);
    expect(ekFuerMenge(4.2, st, 100)).toBe(3.9);
    expect(ekFuerMenge(4.2, st, 400)).toBe(3.7);
  });
});

describe("Deal-Eingabe", () => {
  it("ASIN wird großgeschrieben, EK muss positiv sein", () => {
    const ok = DealEingabe.safeParse({ asin: " b0test0001 ", ekNetto: 4.5 });
    expect(ok.success && ok.data.asin).toBe("B0TEST0001");
    expect(DealEingabe.safeParse({ asin: "B0TEST0001", ekNetto: 0 }).success).toBe(false);
    expect(DealEingabe.safeParse({ asin: "ZU-KURZ", ekNetto: 1 }).success).toBe(false);
  });
});

describe("Kundenrechnung aus Prognose", () => {
  it("netto, Gebühren, Kundenpreis + Prep → Gewinn/ROI/Marge", () => {
    // 29,99 brutto, 19 % → 25,2017 netto; Gebühren 8,00; Kosten 11,50 + 0,60
    expect(kundeAusPrognose({ vkEur: 29.99, mwstSatz: 0.19, gebuehren: 8 }, 11.5, 0.6)).toEqual({ gewinn: 5.1, roi: 42.16, marge: 20.24 });
    expect(kundeAusPrognose({ vkEur: null, mwstSatz: 0.19, gebuehren: 8 }, 11.5, 0)).toEqual({ gewinn: null, roi: null, marge: null });
  });
  it("bestes Land nach ROI", () => {
    expect(besterMarkt({ DE: { roiKunde: 20, verkaeufeMonat: 50 }, FR: { roiKunde: 35, verkaeufeMonat: 10 }, IT: { roiKunde: null, verkaeufeMonat: null } })).toEqual({ land: "FR", roi: 35, verkaeufe: 10 });
    expect(besterMarkt({})).toBeNull();
  });
});

describe("Export fürs Prep-Tool", () => {
  it("CSV mit Semikolon, BOM, Anführungszeichen bei Sonderzeichen", () => {
    const csv = exportCsv([{ kunde: "Test; Handel", amazonName: null, land: "DE", deal: 7, asin: "B0TEST0001", ean: "4000000000017", titel: 'Testsocken "Gr. 42"', menge: 18, reservierung: "x" }]);
    expect(csv.startsWith("﻿Kunde;Amazon-Name;Land;Deal;ASIN;EAN;Titel;Menge\r\n")).toBe(true);
    expect(csv).toContain('"Test; Handel";;DE;7;B0TEST0001;4000000000017;"Testsocken ""Gr. 42""";18');
  });
});
