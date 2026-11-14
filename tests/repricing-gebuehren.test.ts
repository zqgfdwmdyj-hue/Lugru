// Gebühren je Land, Provisionsstufen und Margen-Staffeln – reine Logik. Erfundene Werte.
import { describe, expect, it } from "vitest";
import {
  breakEvenMin,
  gebuehrenFuerLand,
  MARGE_NACH_ALTER,
  margeBeiPreis,
  provisionFuer,
  PROVISION_STAFFELN_STANDARD,
  satzBeiPreis,
  satzRunden,
  staffelAlsText,
  staffelAusText,
  stufenBereich,
  stufenText,
  UST,
} from "@/lib/repricing/strategie-logic";
import { gebuehrenAusListing } from "@/lib/repricing/profitguard-logic";
import { landAusStore, parseFees } from "@/lib/reports/amazon";

const BEAUTY = PROVISION_STAFFELN_STANDARD[0].stufen;

describe("Provisionsstufen", () => {
  it("Satz bei Preis: Stufe inklusive Grenze, pauschaler Satz unverändert", () => {
    expect(satzBeiPreis(10, BEAUTY)).toBe(0.08);
    expect(satzBeiPreis(10.01, BEAUTY)).toBe(0.15);
    expect(satzBeiPreis(99, 0.07)).toBe(0.07);
    const kleidung = PROVISION_STAFFELN_STANDARD[1].stufen;
    expect([12, 18, 25].map((p) => satzBeiPreis(p, kleidung))).toEqual([0.05, 0.1, 0.15]);
  });
  it("Break-even mit Preisstufen: kleinster Preis, der in seiner Stufe liegt (Beauty bis 10 € 8 %)", () => {
    const it_ = { ek: 2, fba: 3, fix: 0, zusatz: 0, ust: UST.IT, margeProzent: 10 };
    // K = 5 → 8 %: 5 / (1/1,22 − 0,08 − 0,10) = 7,817 → 7,82 (≤ 10 €)
    expect(breakEvenMin({ ...it_, provision: BEAUTY })).toBe(7.82);
    expect(breakEvenMin({ ...it_, provision: 0.15 })).toBe(8.78);
    // K = 7: mit 8 % wären es 10,94 (> 10 €) → Stufe 15 %: 7 / 0,569672 = 12,288 → 12,29
    expect(breakEvenMin({ ...it_, ek: 0, fba: 7, provision: BEAUTY })).toBe(12.29);
    expect(margeBeiPreis({ ...it_, provision: BEAUTY, preis: 7.82 })!).toBeCloseTo(10, 0);
  });
  it("Marge bei Preis: Umkehrung von Break-even, unter Break-even negativ, ohne Preis null", () => {
    const p = { ek: 20, fba: 4, fix: 0, zusatz: 0, ust: UST.DE, provision: 0.15 };
    expect(margeBeiPreis({ ...p, preis: breakEvenMin({ ...p, margeProzent: 10 })! })).toBeCloseTo(10, 0);
    expect(margeBeiPreis({ ...p, preis: breakEvenMin({ ...p, margeProzent: 0 })! })).toBeCloseTo(0, 0);
    expect(margeBeiPreis({ ...p, preis: 25 })!).toBeLessThan(0);
    expect(margeBeiPreis({ ...p, preis: 0 })).toBeNull();
  });
  it("Satz aus Betrag/Preis: 0,5-%-Schritte bei Cent-Rundung, sonst 4 Stellen", () => {
    expect(satzRunden(1.61 / 10.74)).toBe(0.15);
    expect(satzRunden(4.57 / 65.34)).toBe(0.07);
    expect(satzRunden(0.0782)).toBe(0.0782);
  });
  it("Preisstufen nur, wenn die Kategorie passt und der beobachtete Satz zum Preis passt", () => {
    expect(provisionFuer({ satz: 0.15, preis: 12, kategorie: "Beauty" })).toEqual(BEAUTY);
    expect(provisionFuer({ satz: 0.08, preis: null, kategorie: "Drogerie & Körperpflege" })).toEqual(BEAUTY);
    expect(provisionFuer({ satz: 0.15, preis: 8, kategorie: "Beauty" })).toBe(0.15);
    expect(provisionFuer({ satz: 0.07, preis: 80, kategorie: "Electronics" })).toBe(0.07);
    expect(provisionFuer({ satz: 0.15, preis: 30, kategorie: null })).toBe(0.15);
  });
});

describe("Gebühren je Land", () => {
  const produkt = { fba: 3.2, satz: 0.15 };
  it("Repricer-Liste vor Amazon-Gebührenvorschau vor Produkt", () => {
    expect(gebuehrenFuerLand({ land: "FR", liste: { fba: 5.9, satz: 0.15, preis: 30, kategorie: null }, amazon: { fba: 5.5, satz: 0.12, preis: 30, kategorie: null }, produkt })).toMatchObject({ fba: 5.9, satz: 0.15, quelle: "liste", geschaetzt: false });
    expect(gebuehrenFuerLand({ land: "IT", amazon: { fba: 5.4, satz: 0.07, preis: 90, kategorie: "Electronics" }, produkt })).toMatchObject({ fba: 5.4, satz: 0.07, provision: 0.07, quelle: "amazon", geschaetzt: false, kategorie: "Electronics" });
  });
  it("Werte je Feld aus der ersten Quelle, die sie hat", () => {
    expect(gebuehrenFuerLand({ land: "FR", liste: { fba: 5.9, satz: null, preis: null, kategorie: null }, amazon: { fba: 5.5, satz: 0.12, preis: 30, kategorie: null }, produkt })).toMatchObject({ fba: 5.9, satz: 0.12, quelle: "liste", geschaetzt: false });
    // Satz fehlt in allen Landesquellen → Produktwert, außerhalb DE geschätzt
    expect(gebuehrenFuerLand({ land: "FR", liste: { fba: 5.9, satz: null, preis: null, kategorie: null }, produkt })).toMatchObject({ fba: 5.9, satz: 0.15, quelle: "liste", geschaetzt: true });
  });
  it("nur Produktwerte: außerhalb DE geschätzt, in DE nur wenn am Produkt geschätzt", () => {
    expect(gebuehrenFuerLand({ land: "ES", produkt })).toMatchObject({ fba: 3.2, satz: 0.15, quelle: "produkt", geschaetzt: true, kategorie: null });
    expect(gebuehrenFuerLand({ land: "DE", produkt })).toMatchObject({ quelle: "produkt", geschaetzt: false });
    expect(gebuehrenFuerLand({ land: "DE", produkt: { ...produkt, geschaetzt: true } }).geschaetzt).toBe(true);
  });
  it("Kategorie aus der Liste ergibt Preisstufen der Provision", () => {
    expect(gebuehrenFuerLand({ land: "DE", liste: { fba: 2.5, satz: 0.15, preis: 12, kategorie: "Beauty" }, produkt }).provision).toEqual(BEAUTY);
  });
  it("Repricer-Liste: Referral-/FBA-Spalten am Namen erkannt (Betrag oder Satz), Kategorie", () => {
    expect(gebuehrenAusListing({ "Referral Fee": "3.00", "FBA Fee": "4.10", Cost: "11.90" }, 20)).toEqual({ fba: 4.1, satz: 0.15, kategorie: null });
    expect(gebuehrenAusListing({ "Referral Fee %": "15%", "Fulfillment Fee": "5,99", Category: "Beauty" }, null)).toEqual({ fba: 5.99, satz: 0.15, kategorie: "Beauty" });
    expect(gebuehrenAusListing({ Provision: "0,15", "FBA-Gebühr": "3,20" }, null)).toEqual({ fba: 3.2, satz: null, kategorie: null });
    expect(gebuehrenAusListing({ "Referral Fee": "3.00" }, null)).toEqual({ fba: null, satz: null, kategorie: null });
    expect(gebuehrenAusListing({ Bemerkung: "x" }, 20)).toEqual({ fba: null, satz: null, kategorie: null });
  });
  it("Amazon-Gebührenvorschau: Land aus „amazon-store“", () => {
    expect(landAusStore("FR")).toBe("FR");
    expect(landAusStore("Amazon.it")).toBe("IT");
    expect(landAusStore("A1RKKUPIHCS9HS")).toBe("ES");
    expect(landAusStore("")).toBeNull();
    const t = { headers: ["sku", "asin", "amazon-store", "product-group", "your-price", "currency", "estimated-referral-fee-per-unit", "expected-fulfillment-fee-per-unit"], rows: [["TEST-SKU-G1", "B0TESTG001", "FR", "Beauty", "20.00", "EUR", "3.00", "5.10"]] };
    expect(parseFees(t)[0]).toMatchObject({ sku: "TEST-SKU-G1", land: "FR", kategorie: "Beauty", fbaFee: 5.1, referralRate: 0.15, preis: 20 });
  });
});

describe("Margen-Staffeln", () => {
  it("Staffel als Text und zurück", () => {
    const t = staffelAlsText(MARGE_NACH_ALTER);
    expect(t).toBe("30:10, 60:8, 90:7, 180:5, 270:3, 365:1, :0");
    expect(staffelAusText(t)).toEqual(MARGE_NACH_ALTER);
    expect(staffelAlsText(null)).toBe("");
  });
  it("Eingabe: Komma-Marge, alte BQool-Zusätze werden ignoriert, Unsinn → null", () => {
    expect(staffelAusText("30:2,5")).toEqual([{ bisTage: 30, marge: 2 }, { bisTage: 5, marge: 0 }]); // Komma trennt Stufen
    expect(staffelAusText("30:10 SB [Available ≥ 1], 90:LP+6 SM, :0")).toEqual([
      { bisTage: 30, marge: 10 },
      { bisTage: 90, marge: 0 },
      { bisTage: null, marge: 0 },
    ]);
    expect(staffelAusText("  ")).toBeNull();
    expect(staffelAusText("x:5")).toBeNull();
  });
  it("Bereich und Marge einer Stufe als Text", () => {
    expect(stufenBereich(MARGE_NACH_ALTER, 0)).toBe("0–30");
    expect(stufenBereich(MARGE_NACH_ALTER, 1)).toBe("31–60");
    expect(stufenBereich(MARGE_NACH_ALTER, 6)).toBe("> 365");
    expect(stufenText({ bisTage: 30, marge: 2.5 })).toBe("2,5 %");
  });
});
