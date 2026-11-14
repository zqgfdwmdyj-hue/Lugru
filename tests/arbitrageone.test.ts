import { describe, expect, it } from "vitest";
import { accountoneAus, accountoneMonat, aoFormat, AO_EXPORTE, einkaeufeAus, einkaufSchluessel, exportFaellig, faelligeExporte, lagerbestandAus, laufText, laufZeilen, stichtagAus, wochenMontag } from "@/lib/arbitrageone/logic";
import { parseArbitrageOne } from "@/lib/imports/arbitrageone";

// ArbitrageOne-Anbindung: Takt, Formate an den Spalten, Lauf-Text. Nur erfundene Daten.

const berlin = (s: string) => new Date(s); // ISO mit Offset

describe("Takt: wann ist ein Export fällig?", () => {
  it("täglich: heute (Berlin) noch nicht geholt", () => {
    const jetzt = berlin("2026-11-02T05:31:00+01:00");
    expect(exportFaellig("taeglich", null, jetzt)).toBe(true);
    expect(exportFaellig("taeglich", berlin("2026-11-01T23:59:00+01:00"), jetzt)).toBe(true);
    expect(exportFaellig("taeglich", berlin("2026-11-02T00:10:00+01:00"), jetzt)).toBe(false);
  });
  it("wöchentlich nur montags (B27.2: Dienstag lief Reimbursement trotzdem)", () => {
    expect(wochenMontag(berlin("2026-11-04T10:00:00+01:00"))).toBe("2026-11-02");
    expect(wochenMontag(berlin("2026-11-08T23:00:00+01:00"))).toBe("2026-11-02"); // Sonntag gehört zur Woche ab Montag
    expect(exportFaellig("woechentlich", berlin("2026-10-26T06:00:00+01:00"), berlin("2026-11-02T05:31:00+01:00"))).toBe(true);
    expect(exportFaellig("woechentlich", null, berlin("2026-11-02T05:31:00+01:00"))).toBe(true);
    expect(exportFaellig("woechentlich", berlin("2026-11-02T05:35:00+01:00"), berlin("2026-11-05T05:31:00+01:00"))).toBe(false);
    // Dienstag: nicht mehr – auch nicht, wenn es noch nie geklappt hat (Knopf „Jetzt abholen“ geht immer)
    expect(exportFaellig("woechentlich", berlin("2026-10-27T06:00:00+01:00"), berlin("2026-11-03T05:31:00+01:00"))).toBe(false);
    expect(exportFaellig("woechentlich", null, berlin("2026-11-03T05:31:00+01:00"))).toBe(false);
  });
  it("monatlich am 1. – bei Fehlschlag bis zum 7. nachholen", () => {
    expect(exportFaellig("monatlich", berlin("2026-10-01T05:40:00+02:00"), berlin("2026-11-01T05:31:00+01:00"))).toBe(true);
    expect(exportFaellig("monatlich", berlin("2026-10-01T05:40:00+02:00"), berlin("2026-11-06T05:31:00+01:00"))).toBe(true);
    expect(exportFaellig("monatlich", berlin("2026-10-01T05:40:00+02:00"), berlin("2026-11-08T05:31:00+01:00"))).toBe(false);
    expect(exportFaellig("monatlich", berlin("2026-11-01T05:40:00+01:00"), berlin("2026-11-15T05:31:00+01:00"))).toBe(false);
    expect(accountoneMonat(berlin("2026-11-01T05:31:00+01:00"))).toBe("2026-10");
    expect(accountoneMonat(berlin("2027-01-01T05:31:00+01:00"))).toBe("2026-12");
  });
  it("Reihenfolge: Einkäufe vor dem sellerboard-COG; Knopf holt alle, „nur“ einzelne", () => {
    const jetzt = berlin("2026-11-03T05:31:00+01:00"); // Dienstag
    const heute = berlin("2026-11-03T05:32:00+01:00");
    const alleHeute = Object.fromEntries(AO_EXPORTE.map((e) => [e.key, heute]));
    expect(faelligeExporte(alleHeute, jetzt).map((e) => e.key)).toEqual([]);
    expect(faelligeExporte({}, jetzt).map((e) => e.key)).toEqual(["einkaeufe", "lagerbestand", "sellerboard", "accountone"]); // Reimbursement nur montags; B31.1: kein BQool
    expect(faelligeExporte({}, berlin("2026-11-02T05:31:00+01:00")).map((e) => e.key)).toContain("reimbursement");
    expect(faelligeExporte(alleHeute, jetzt, { alle: true }).length).toBe(5);
    expect(faelligeExporte({}, jetzt, { nur: ["lagerbestand"] }).map((e) => e.key)).toEqual(["lagerbestand"]);
    // Der ArbitrageOne-Export „BQool“ wird nicht abgeholt (BQool ist abgelöst).
    expect(AO_EXPORTE.find((e) => e.key === "bqool")).toBeUndefined();
  });
});

describe("Formate an den Spalten erkennen", () => {
  it("Einkäufe, Lagerbestand, AccountOne, sellerboard – Dateiname egal", () => {
    expect(aoFormat(["ASIN", "SKU", "Kaufdatum", "Menge", "EK netto", "Lieferant", "Rechnungsnummer"])).toBe("einkaeufe");
    expect(aoFormat(["Einkaufsdatum", "Produktname", "ASIN", "Anzahl", "Einkaufspreis netto (€)"])).toBe("einkaeufe");
    expect(aoFormat(["ASIN", "Seller SKU", "Lagerbestand", "EK netto", "Lagerwert"])).toBe("lagerbestand");
    expect(aoFormat(["marketplace_article_nr", "article_nr", "ek_netto_euro", "source_account_id"])).toBe("accountone");
    expect(aoFormat(["ASIN", "SKU", "Cost"])).toBe("sellerboard");
    expect(aoFormat(["Buchungstag", "Betrag", "Verwendungszweck"])).toBeNull();
    expect(aoFormat(["asin", "fnsku", "product-name", "fulfillment-center"])).toBeNull();
  });
  it("Einkäufe lesen: Datum TT.MM.JJJJ, Komma-Zahlen, Leerzeilen weg, kaputte Zeilen gezählt", () => {
    const t = [
      ["ASIN", "SKU", "Kaufdatum", "Menge", "EK netto", "Lieferant", "Rechnungsnummer", "Produktname"],
      ["B0AOTEST01", "AOT_01NOV26_B0AOTEST01_10_25", "01.11.2026", "4", "10,50", "Testshop", "RE-1", "Testartikel Eins"],
      ["B0AOTEST02", "", "2026-10-30", 2, 7.2, "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["kaputt", "X", "01.11.2026", "1", "1", "", "", ""],
      ["B0AOTEST03", "Y", "", "1", "1", "", "", ""],
    ];
    const e = einkaeufeAus(t);
    expect(e.uebersprungen).toBe(2);
    expect(e.zeilen).toEqual([
      { asin: "B0AOTEST01", sku: "AOT_01NOV26_B0AOTEST01_10_25", titel: "Testartikel Eins", kaufdatum: "2026-11-01", menge: 4, ekNetto: 10.5, waehrung: null, lieferant: "Testshop", rechnung: "RE-1" },
      { asin: "B0AOTEST02", sku: null, titel: null, kaufdatum: "2026-10-30", menge: 2, ekNetto: 7.2, waehrung: null, lieferant: null, rechnung: null },
    ]);
    // Gleiche Zeile → gleicher Schlüssel (zweite Datei überspringt sie), andere Menge → anderer Schlüssel
    expect(einkaufSchluessel(e.zeilen[0])).toBe(einkaufSchluessel({ ...e.zeilen[0], lieferant: "TESTSHOP" }));
    expect(einkaufSchluessel(e.zeilen[0])).not.toBe(einkaufSchluessel({ ...e.zeilen[0], menge: 5 }));
  });
  it("Einkäufe mit SKU gehen als EK-Liste durch den bisherigen Parser (Quelle „einkaeufe“)", () => {
    const p = parseArbitrageOne([
      ["ASIN", "SKU", "Kaufdatum", "Menge", "EK netto"],
      ["B0AOTEST01", "AOT-1", "01.11.2026", "3", "9,99"],
      ["B0AOTEST02", "", "01.11.2026", "1", "5"],
    ]);
    expect(p.source).toBe("einkaeufe");
    expect(p.rows).toEqual([{ line: 2, asin: "B0AOTEST01", sku: "AOT-1", costNet: 9.99, title: null, purchaseDate: "2026-11-01", quantity: 3, currency: null }]);
    expect(() => parseArbitrageOne([["ASIN", "Kaufdatum", "Menge", "EK netto"], ["B0AOTEST02", "01.11.2026", "1", "5"]])).toThrow(/ohne SKU/);
  });
  it("Lagerbestand: Stichtag aus Spalte bzw. Dateiname, Wert = EK × Menge, gleiche SKU am gleichen Ort addiert", () => {
    expect(stichtagAus("Lagerbestand_31.10.2026.xlsx", undefined, "2026-11-01")).toBe("2026-10-31");
    expect(stichtagAus("export.csv", "2026-10-30", "2026-11-01")).toBe("2026-10-30");
    expect(stichtagAus("export.csv", undefined, "2026-11-01")).toBe("2026-11-01");
    const l = lagerbestandAus(
      [
        ["ASIN", "SKU", "Bestand", "EK netto", "Lagerort"],
        ["B0AOTEST01", "AOT-1", "5", "2,00", "Halle 1"],
        ["B0AOTEST01", "AOT-1", "3", "2,00", "Halle 1"],
        ["B0AOTEST02", "AOT-2", "1", "", ""],
        ["", "", "", "", ""],
      ],
      "Lagerbestand_31.10.2026.csv",
      "2026-11-01",
    );
    expect(l.stichtag).toBe("2026-10-31");
    expect(l.zeilen).toEqual([
      { sku: "AOT-1", asin: "B0AOTEST01", titel: null, menge: 8, ekNetto: 2, wert: 16, lagerort: "Halle 1" },
      { sku: "AOT-2", asin: "B0AOTEST02", titel: null, menge: 1, ekNetto: null, wert: null, lagerort: null },
    ]);
  });
  it("AccountOne COG (alt und NEU mit Zusatzspalten)", () => {
    const a = accountoneAus([["marketplace_article_nr", "article_nr", "ek_netto_euro", "neu_spalte"], ["b0aotest01", "AOT-1", "12,30", "x"], ["", "", "", ""]]);
    expect(a.zeilen).toEqual([{ asin: "B0AOTEST01", sku: "AOT-1", ekNetto: 12.3 }]);
    expect(a.spalten).toContain("neu_spalte");
  });
});

describe("ArbitrageOne: Lauf-Text", () => {
  it("Lauf-Text je Export", () => {
    expect(laufText([])).toBe("Nichts fällig.");
    expect(laufText([{ key: "einkaeufe", titel: "Einkäufe", ok: true, text: "3 neu" }, { key: "lagerbestand", titel: "Lagerbestand", ok: false, text: "nicht gefunden" }])).toBe("Einkäufe: 3 neu · Lagerbestand: Fehler – nicht gefunden");
  });
});
