import { describe, expect, it } from "vitest";
import { leseBqool, marktAus, pruefe, spaltenZuordnung, zahl } from "@/lib/bqool/logic";

// Erfundene BQool-Exporte („Manage Listings“) – Spaltennamen wie im Export, Werte ausgedacht.

describe("BQool: Spalten erkennen", () => {
  it("englischer Export: Min/Max nicht mit Preis verwechseln", () => {
    const sp = spaltenZuordnung(["SKU", "ASIN", "Product Name", "Marketplace", "Your Price", "Min Price", "Max Price", "Strategy Name", "Repricing Status", "Buy Box Price", "Buy Box Winner", "Lowest Price", "# of Offers", "Quantity"]);
    expect(sp).toMatchObject({ sku: 0, asin: 1, titel: 2, markt: 3, preis: 4, min: 5, max: 6, regel: 7, status: 8, bbPreis: 9, bbGewinner: 10, niedrigst: 11, angebote: 12, bestand: 13 });
  });

  it("deutsche Spalten und „enthält“-Treffer", () => {
    const sp = spaltenZuordnung(["Artikelnummer", "Marktplatz", "Preis", "Mindestpreis", "Höchstpreis", "Repricing-Strategie (Name)", "Anzahl Angebote"]);
    expect(sp).toMatchObject({ sku: 0, markt: 1, preis: 2, min: 3, max: 4, regel: 5, angebote: 6 });
  });
});

describe("BQool: Zahlen und Marktplätze", () => {
  it.each([
    ["12,99", 12.99],
    ["€ 12,99", 12.99],
    ["EUR 1.234,50", 1234.5],
    ["1,234.50", 1234.5],
    ["12.99", 12.99],
    ["0.125", 0.125],
    ["1.234.567", 1234567],
    ["£9.49", 9.49],
    ["", null],
    ["-", null],
    ["N/A", null],
  ])("zahl(%j) = %j", (s, n) => expect(zahl(s)).toBe(n));

  it.each([
    ["Amazon.de", "DE"],
    ["www.amazon.co.uk", "UK"],
    ["https://www.amazon.fr", "FR"],
    ["Germany", "DE"],
    ["Spanien", "ES"],
    ["SE", "SE"],
    ["amazon.com.be", "BE"],
    ["Mars", null],
  ])("marktAus(%j) = %j", (s, m) => expect(marktAus(s)).toBe(m));
});

describe("BQool: Export einlesen", () => {
  const head = ["Marketplace", "SKU", "ASIN", "Title", "Fulfillment", "Price", "Min Price", "Max Price", "Strategy", "Status", "Buy Box Winner", "Notizfeld"];
  const rows = [
    ["Amazon.de", "TEST-SOCKEN", "b0test0001", "Testsocken", "FBA", "9,99", "7,50", "14,99", "Standard", "Active", "You", "x"],
    ["Amazon.fr", "TEST-SOCKEN", "B0TEST0001", "Testsocken", "AFN", "10.49", "", "15.99", "", "Paused", "A1TESTFBA00001", ""],
    ["", "TEST-TASSE", "kurz", "Testtasse", "Merchant", "14,90", "9", "8", "Standard", "on", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["Amazon.it", "", "B0TEST0003", "ohne SKU", "", "", "", "", "", "", "", ""],
  ];

  it("liest Zeilen, Marktplatz aus Spalte oder Standard, Zusatzspalten bleiben erhalten", () => {
    const r = leseBqool(head, rows, "DE");
    expect(r.zeilen).toHaveLength(3);
    expect(r.ohneSku).toBe(1); // die ganz leere Zeile zählt nicht
    expect(r.fehlt).toEqual([]);
    const [de, fr, tasse] = r.zeilen;
    expect(de).toMatchObject({ marktplatz: "DE", sku: "TEST-SOCKEN", asin: "B0TEST0001", versand: "FBA", preis: 9.99, min: 7.5, max: 14.99, regel: "Standard", status: "aktiv", eigeneBuybox: true, zusatz: { Notizfeld: "x" } });
    expect(fr).toMatchObject({ marktplatz: "FR", versand: "FBA", min: null, status: "pausiert", buyboxGewinner: "A1TESTFBA00001", eigeneBuybox: null });
    expect(tasse).toMatchObject({ marktplatz: "DE", asin: null, versand: "FBM", min: 9, max: 8, status: "aktiv" });
  });

  it("ohne Marktplatz-Spalte und ohne Standard: Zeilen werden gezählt, nicht geraten", () => {
    const r = leseBqool(["SKU", "Price"], [["A", "1"], ["B", "2"]], null);
    expect(r.zeilen).toHaveLength(0);
    expect(r.ohneMarkt).toBe(2);
    expect(r.fehlt).toEqual(["Mindestpreis", "Höchstpreis", "Regel/Strategie"]);
  });
});

describe("BQool: Prüfen gegen den Mindestpreis des Seller-Systems", () => {
  const ok = { min: 8, max: 15, preis: 9.99, status: "aktiv" as const, eigeneBuybox: true, regel: "Standard" };

  it("alles in Ordnung → keine Hinweise", () => expect(pruefe(ok, 7.9, true)).toEqual([]));
  it("BQool-Min unter der Untergrenze ist der schwerste Hinweis", () => expect(pruefe({ ...ok, min: 6, preis: 5.5, eigeneBuybox: false }, 7.9, true)).toEqual(["min_unter_untergrenze", "preis_unter_min", "buybox_verloren"]));
  it("Rundung auf Cent: 7,90 gegen ungerundete 7,9037 ist kein Fehler, 7,89 schon", () => {
    expect(pruefe({ ...ok, min: 7.9 }, 7.9037, true)).toEqual([]);
    expect(pruefe({ ...ok, min: 7.89 }, 7.9037, true)).toEqual(["min_unter_untergrenze"]);
  });
  it("ohne Min/Max, pausiert, ohne Regel", () => expect(pruefe({ min: null, max: null, preis: 9, status: "pausiert", eigeneBuybox: null, regel: null }, null, true)).toEqual(["ohne_min", "pausiert", "ohne_max", "ohne_regel"]));
  it("„ohne Regel“ nur, wenn der Export überhaupt Regeln enthält", () => expect(pruefe({ ...ok, regel: null }, null, false)).toEqual([]));
  it("Min über Max und Preis über Max", () => expect(pruefe({ ...ok, min: 16, preis: 20 }, null, true)).toEqual(["min_ueber_max", "preis_ueber_max"]));
});

describe("B15.11: Repricer – Status-Spalte, Übersicht je Regel, Filter", () => {
  it("„Repricing Status“ hat Vorrang vor dem allgemeinen „Status“ (Amazon-Angebot inaktiv ≠ pausiert)", async () => {
    const { leseBqool } = await import("@/lib/bqool/logic");
    const r = leseBqool(["SKU", "Status", "Strategy Name", "Min Price", "Repricing Status"], [["TEST-A", "Inactive", "ia", "9,90", "On"]], "DE");
    expect(r.zeilen[0]).toMatchObject({ regel: "ia", status: "aktiv" });
    const nurAllgemein = leseBqool(["SKU", "Status", "Strategy Name"], [["TEST-B", "Inactive", "ia"], ["TEST-C", "Paused", "ia"]], "DE");
    expect(nurAllgemein.zeilen.map((z) => z.status)).toEqual([null, "pausiert"]);
  });

  it("Übersicht je Regel über alle Länder und Filter", async () => {
    const { regelUebersicht, filterBqool } = await import("@/lib/bqool/logic");
    const z = (sku: string, marktplatz: "DE" | "FR", regel: string | null, status: "aktiv" | "pausiert" | null, hinweise: ("pausiert" | "ohne_min")[] = []) => ({ sku, asin: null, titel: null, marktplatz, regel, status, hinweise });
    const zeilen = [z("A", "DE", "ia", "aktiv"), z("A", "FR", "ia", "pausiert", ["pausiert"]), z("B", "DE", "Liquidation", "aktiv"), z("C", "DE", null, null, ["ohne_min"])];
    const u = regelUebersicht(zeilen);
    expect(u[0]).toMatchObject({ regel: "ia", gesamt: 2, aktiv: 1, pausiert: 1, mitHinweis: 1, laender: { DE: 1, FR: 1 } });
    expect(u.find((x) => x.regel === "(ohne Regel)")).toMatchObject({ gesamt: 1, unbekannt: 1 });
    expect(filterBqool(zeilen, { land: "FR" }).map((x) => x.sku)).toEqual(["A"]);
    expect(filterBqool(zeilen, { regel: "ia", status: "aktiv" }).map((x) => `${x.sku}${x.marktplatz}`)).toEqual(["ADE"]);
    expect(filterBqool(zeilen, { nurAuffaellig: true }).map((x) => x.sku).sort()).toEqual(["A", "C"]);
    expect(filterBqool(zeilen, { hinweis: "ohne_min" }).map((x) => x.sku)).toEqual(["C"]);
  });
});
