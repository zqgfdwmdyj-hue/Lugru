import { describe, expect, it } from "vitest";
import {
  filterAbgleich,
  formatLernen,
  leseProfitguard,
  marktAus,
  PG_FORMAT_STANDARD,
  profitguardDatei,
  pruefe,
  spaltenZuordnung,
  strategieUebersicht,
  zahl,
  type Hinweis,
} from "@/lib/repricing/profitguard-logic";

// Erfundene ProfitGuard-Exporte („Export & Import“) – Spaltennamen wie in einem Export, SKUs und Preise ausgedacht.

describe("ProfitGuard: Spalten erkennen", () => {
  it("englischer Export: Min/Max nicht mit Preis verwechseln, Repricing-Spalte, Buy Box", () => {
    const sp = spaltenZuordnung(["SKU", "ASIN", "Product Name", "Marketplace", "Your Price", "Min Price", "Max Price", "Strategy Name", "Repricing Status", "Buy Box Price", "Buy Box Winner", "Buy Box Share", "Quantity"]);
    expect(sp).toEqual({ sku: 0, asin: 1, titel: 2, markt: 3, preis: 4, min: 5, max: 6, strategie: 7, aktiv: 8, bbPreis: 9, eigeneBb: 10, bbAnteil: 11, bestand: 12 });
  });

  it("deutsche Spalten (Umlaute, Bindestriche)", () => {
    const sp = spaltenZuordnung(["Artikelnummer", "Marktplatz", "Preis", "Mindestpreis", "Höchstpreis", "Strategie", "Aktiv", "Buy-Box-Anteil", "Bestand"]);
    expect(sp).toEqual({ sku: 0, markt: 1, preis: 2, min: 3, max: 4, strategie: 5, aktiv: 6, bbAnteil: 7, bestand: 8 });
  });

  it("„enthält“-Treffer für längere Spaltennamen, jede Spalte nur einmal", () => {
    const sp = spaltenZuordnung(["Seller SKU", "Minimum Price (EUR)", "Maximum Price (EUR)", "Repricing-Strategie (Name)", "Buy Box Share 30d"]);
    expect(sp).toMatchObject({ sku: 0, min: 1, max: 2, strategie: 3, bbAnteil: 4 });
  });
});

describe("ProfitGuard: Zahlen und Marktplätze", () => {
  it.each([
    ["12,99", 12.99],
    ["€ 12,99", 12.99],
    ["EUR 1.234,50", 1234.5],
    ["1,234.50", 1234.5],
    ["12.99", 12.99],
    ["0.125", 0.125],
    ["1.234.567", 1234567],
    ["£9.49", 9.49],
    ["45 %", 45],
    ["", null],
    ["-", null],
    ["N/A", null],
  ])("zahl(%j) = %j", (s, n) => expect(zahl(s)).toBe(n));

  it("zahl(undefined) = null", () => expect(zahl(undefined)).toBeNull());

  it.each([
    ["Amazon.de", "DE"],
    ["www.amazon.co.uk", "UK"],
    ["https://www.amazon.fr", "FR"],
    ["Germany", "DE"],
    ["Spanien", "ES"],
    ["SE", "SE"],
    ["amazon.com.be", "BE"],
    ["Mars", null],
    ["", null],
  ])("marktAus(%j) = %j", (s, m) => expect(marktAus(s)).toBe(m));
});

describe("ProfitGuard: Export einlesen", () => {
  const head = ["Marketplace", "SKU", "ASIN", "Title", "Price", "Min Price", "Max Price", "Strategy", "Repricing", "Buy Box Price", "Buy Box Winner", "Buy Box Share", "Notizfeld"];
  const rows = [
    ["Amazon.de", "TEST-SOCKEN", "b0test0001", "Testsocken", "9,99", "7,50", "14,99", "PG Standard", "Yes", "9,49", "Yes", "0,45", "x"],
    ["Amazon.fr", "TEST-SOCKEN", "B0TEST0001", "Testsocken", "10.49", "", "15.99", "", "No", "", "A1TESTSELLER01", "45 %", ""],
    ["", "TEST-TASSE", "kurz", "Testtasse", "14,90", "9", "8", "PG Standard", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["Amazon.it", "", "B0TEST0003", "ohne SKU", "", "", "", "", "", "", "", "", ""],
  ];

  it("liest Zeilen; Marktplatz aus der Spalte, sonst Standardmarkt; Komma-Dezimal; Zusatzspalten bleiben erhalten", () => {
    const r = leseProfitguard(head, rows, "DE");
    expect(r.zeilen).toHaveLength(3);
    expect(r.ohneSku).toBe(1); // die ganz leere Zeile zählt nicht
    expect(r.ohneMarkt).toBe(0);
    expect(r.fehlt).toEqual([]);
    expect(r.erkannt).toContain("Mindestpreis = „Min Price“");
    const [de, fr, tasse] = r.zeilen;
    expect(de).toMatchObject({ marktplatz: "DE", sku: "TEST-SOCKEN", asin: "B0TEST0001", titel: "Testsocken", preis: 9.99, min: 7.5, max: 14.99, strategie: "PG Standard", imRepricing: true, buyboxPreis: 9.49, eigeneBuybox: true, buyboxAnteil: 45, zusatz: { Notizfeld: "x" } });
    expect(fr).toMatchObject({ marktplatz: "FR", preis: 10.49, min: null, max: 15.99, strategie: null, imRepricing: false, eigeneBuybox: null, buyboxAnteil: 45, zusatz: {} });
    expect(tasse).toMatchObject({ marktplatz: "DE", asin: null, preis: 14.9, min: 9, max: 8, imRepricing: null, buyboxAnteil: null });
  });

  it("Buy-Box-Anteil: 0,45 / 0.45 → 45 %, 45 % und 45 bleiben 45", () => {
    const r = leseProfitguard(["SKU", "Buy Box Share"], [["A", "0,45"], ["B", "0.45"], ["C", "45 %"], ["D", "45"], ["E", "45,5%"]], "DE");
    expect(r.zeilen.map((z) => z.buyboxAnteil)).toEqual([45, 45, 45, 45, 45.5]);
  });

  it("ohne Marktplatz-Spalte gilt der Standardmarkt; ohne Standard werden Zeilen gezählt, nicht geraten", () => {
    expect(leseProfitguard(["SKU", "Price"], [["A", "1"]], "FR").zeilen[0].marktplatz).toBe("FR");
    const r = leseProfitguard(["SKU", "Price"], [["A", "1"], ["B", "2"]], null);
    expect(r.zeilen).toHaveLength(0);
    expect(r.ohneMarkt).toBe(2);
    expect(r.fehlt).toEqual(["Mindestpreis", "Höchstpreis", "Strategie"]);
  });

  it("unbekannter Wert in der Marktplatz-Spalte wird gezählt, nicht dem Standardmarkt zugeordnet", () => {
    const r = leseProfitguard(["SKU", "Marketplace", "Min Price", "Max Price"], [["A", "amazon.com", "1", "2"], ["B", "", "1", "2"]], "DE");
    expect(r.ohneMarkt).toBe(1);
    expect(r.zeilen.map((z) => [z.sku, z.marktplatz])).toEqual([["B", "DE"]]);
  });

  it("Marktplatz-Spalte geht vor dem Standardmarkt", () => {
    const r = leseProfitguard(["SKU", "Country", "Min Price", "Max Price"], [["A", "Italy", "5", "9"], ["A", "ES", "6", "9"]], "DE");
    expect(r.zeilen.map((z) => z.marktplatz)).toEqual(["IT", "ES"]);
  });

  it("deutsche Datei mit Ja/Nein und Semikolon-Werten", () => {
    const r = leseProfitguard(["Artikelnummer", "Marktplatz", "Mindestpreis", "Höchstpreis", "Strategie", "Aktiv", "Bestand"], [["TEST-1", "Deutschland", "1.234,50", "2.000,00", "Abverkauf", "Ja", "12"], ["TEST-2", "Frankreich", "7,10", "9,90", "Standard", "Nein", "0"]], null);
    expect(r.zeilen).toMatchObject([
      { marktplatz: "DE", sku: "TEST-1", min: 1234.5, max: 2000, strategie: "Abverkauf", imRepricing: true, bestand: 12 },
      { marktplatz: "FR", sku: "TEST-2", min: 7.1, max: 9.9, imRepricing: false, bestand: 0 },
    ]);
  });
});

describe("ProfitGuard: Status-Spalte", () => {
  it("allgemeines „Status“ Inactive (Amazon-Angebotsstatus) zählt nicht als „nicht im Repricing“, Paused schon", () => {
    const r = leseProfitguard(["SKU", "Status", "Strategy Name", "Min Price", "Max Price"], [["TEST-B", "Inactive", "PG Standard", "9,90", "19,90"], ["TEST-C", "Paused", "PG Standard", "9,90", "19,90"], ["TEST-D", "Active", "PG Standard", "9,90", "19,90"], ["TEST-E", "Incomplete", "PG Standard", "9,90", "19,90"]], "DE");
    expect(r.zeilen.map((z) => z.imRepricing)).toEqual([null, false, true, null]);
    // … und löst darum in der Prüfung keinen Hinweis „nicht im Repricing“ aus
    expect(pruefe({ ist: r.zeilen[0], bestand: 5, sollMin: null, liquidationFrei: false })).not.toContain("nicht_im_repricing");
    expect(pruefe({ ist: r.zeilen[1], bestand: 5, sollMin: null, liquidationFrei: false })).toContain("nicht_im_repricing");
  });

  it("„Repricing Status“ hat Vorrang vor dem allgemeinen „Status“, der als Zusatzspalte erhalten bleibt", () => {
    const r = leseProfitguard(["SKU", "Status", "Repricing Status"], [["TEST-A", "Inactive", "On"], ["TEST-B", "Active", "Off"]], "DE");
    expect(r.zeilen.map((z) => z.imRepricing)).toEqual([true, false]);
    expect(r.zeilen[0].zusatz).toEqual({ Status: "Inactive" });
  });
});

describe("ProfitGuard: Prüfen gegen den Soll-Min des Seller-Systems", () => {
  const ok = { min: 8, max: 15, preis: 9.99, imRepricing: true };
  const p = (o: Partial<Parameters<typeof pruefe>[0]> = {}) => pruefe({ ist: ok, bestand: 5, sollMin: 7.9, liquidationFrei: false, ...o });

  it("alles in Ordnung → keine Hinweise", () => expect(p()).toEqual([]));

  it("nicht im Repricing: fehlt in ProfitGuard oder pausiert – nur mit Bestand", () => {
    expect(p({ ist: null })).toEqual(["nicht_im_repricing"]);
    expect(p({ ist: null, bestand: 0 })).toEqual([]);
    expect(p({ ist: { ...ok, imRepricing: false } })).toEqual(["nicht_im_repricing"]);
    expect(p({ ist: { ...ok, imRepricing: false }, bestand: 0 })).toEqual([]);
    expect(p({ ist: { ...ok, imRepricing: null } })).toEqual([]);
  });

  it("Min unter dem Soll-Min – außer bei freigegebener Liquidation", () => {
    expect(p({ ist: { ...ok, min: 6, preis: 9 } })).toEqual(["min_unter_soll"]);
    expect(p({ ist: { ...ok, min: 6, preis: 9 }, liquidationFrei: true })).toEqual([]);
    expect(p({ ist: { ...ok, min: 6 }, sollMin: null })).toEqual([]);
  });

  it("Rundung auf Cent: 7,90 gegen ungerundete 7,9037 ist kein Fehler, 7,89 schon", () => {
    expect(p({ ist: { ...ok, min: 7.9 }, sollMin: 7.9037 })).toEqual([]);
    expect(p({ ist: { ...ok, min: 7.89 }, sollMin: 7.9037 })).toEqual(["min_unter_soll"]);
  });

  it("ohne Min/Max", () => {
    expect(p({ ist: { ...ok, min: null, max: null } })).toEqual(["ohne_min", "ohne_max"]);
    expect(p({ ist: { ...ok, max: null } })).toEqual(["ohne_max"]);
  });

  it("Min über Max, Preis unter Min", () => {
    expect(p({ ist: { ...ok, min: 16, preis: 20 } })).toEqual(["min_ueber_max"]);
    expect(p({ ist: { ...ok, preis: 7.99 } })).toEqual(["preis_unter_min"]);
  });

  it("Strategie abweichend nur, wenn Soll und Ist bekannt sind", () => {
    expect(p({ sollStrategie: "Standard", istStrategie: "Abverkauf" })).toEqual(["strategie_abweichend"]);
    expect(p({ sollStrategie: "Standard", istStrategie: "Standard" })).toEqual([]);
    expect(p({ sollStrategie: "Standard", istStrategie: null })).toEqual([]);
  });

  it("Reihenfolge nach Schwere", () => {
    expect(p({ ist: { min: 6, max: 5, preis: 4, imRepricing: false }, sollMin: 7, sollStrategie: "Standard", istStrategie: "Liquidation" })).toEqual(["nicht_im_repricing", "min_unter_soll", "min_ueber_max", "strategie_abweichend", "preis_unter_min"]);
  });
});

describe("ProfitGuard: Importdatei im gelernten Format", () => {
  it("Standardformat ohne gelernten Export: Komma, Punkt-Dezimal, 1/0, CRLF", () => {
    const d = profitguardDatei([
      { land: "FR", sku: "TEST-A", strategieName: "PG Standard", min: 9.9, max: 19.8, aktiv: false },
      { land: "DE", sku: "TEST-B", strategieName: "PG Abverkauf", min: 12, max: 24, aktiv: true },
    ]);
    expect(d).toBe("SKU,Marketplace,Min Price,Max Price,Strategy,Repricing\r\nTEST-A,FR,9.90,19.80,PG Standard,0\r\nTEST-B,DE,12.00,24.00,PG Abverkauf,1\r\n");
    expect(PG_FORMAT_STANDARD.ausExport).toBe(false);
  });

  it("deutsches Format lernen: Semikolon, Komma-Dezimal, Ja/Nein", () => {
    const head = ["SKU", "Marktplatz", "Mindestpreis", "Höchstpreis", "Strategie", "Aktiv", "Notiz, intern"];
    const rows = [
      ["TEST-SOCKEN", "DE", "7,50", "14,99", "PG Standard", "Ja", "Lager \"B\""],
      ["TEST-TASSE", "DE", "9,00", "18,00", "PG Standard", "Nein", ""],
    ];
    const r = leseProfitguard(head, rows, null);
    const f = formatLernen(head, rows, r.spalten, ";")!;
    expect(f).toMatchObject({ trenner: ";", dezimal: ",", aktivWerte: { an: "Ja", aus: "Nein" }, ausExport: true, kopf: head });
    const d = profitguardDatei(
      [
        { land: "DE", sku: "TEST-SOCKEN", strategieName: "PG Standard", min: 7.5, max: 14.99, aktiv: true, ist: { zusatz: r.zeilen[0].zusatz, asin: null, titel: null, preis: null, bestand: null } },
        { land: "DE", sku: "TEST-TASSE", strategieName: "PG Liquidation; fest", min: 9, max: 18, aktiv: false, ist: null },
      ],
      f,
    );
    // Kopf unverändert (Komma ist bei Semikolon kein Trennzeichen), Anführungszeichen verdoppelt, Feld mit Trenner in Anführungszeichen
    expect(d.split("\r\n")).toEqual([
      "SKU;Marktplatz;Mindestpreis;Höchstpreis;Strategie;Aktiv;Notiz, intern",
      'TEST-SOCKEN;DE;7,50;14,99;PG Standard;Ja;"Lager ""B"""',
      'TEST-TASSE;DE;9,00;18,00;"PG Liquidation; fest";Nein;',
      "",
    ]);
  });

  it("Round-Trip: unbekannte Spalten und Ist-Werte bleiben erhalten, Felder mit Komma in Anführungszeichen", () => {
    const head = ["SKU", "ASIN", "Title", "Marketplace", "Price", "Min Price", "Max Price", "Strategy", "Repricing", "Quantity", "Group"];
    const rows = [["TEST-A", "B0TESTAA01", "Testartikel, groß", "Amazon.de", "19.99", "15.00", "30.00", "PG Standard", "1", "4", "Gruppe 1"]];
    const r = leseProfitguard(head, rows, null);
    const f = formatLernen(head, rows, r.spalten, ",")!;
    expect(f).toMatchObject({ trenner: ",", dezimal: ".", aktivWerte: { an: "1", aus: "0" } });
    const z = r.zeilen[0];
    expect(z.zusatz).toEqual({ Group: "Gruppe 1" });
    const d = profitguardDatei([{ land: "DE", sku: "TEST-A", strategieName: "PG Abverkauf", min: 14.5, max: 29, aktiv: true, ist: { zusatz: z.zusatz, asin: z.asin, titel: z.titel, preis: z.preis, bestand: z.bestand } }], f);
    // Marktplatz in der Schreibweise des Exports („Amazon.de“), nicht als Kürzel
    expect(d).toBe(`${head.join(",")}\r\nTEST-A,B0TESTAA01,"Testartikel, groß",Amazon.de,19.99,14.50,29.00,PG Abverkauf,1,4,Gruppe 1\r\n`);
  });

  it("Gegenstück zum „an“-Wert in derselben Schreibweise (On → Off, Aktiv → Inaktiv, JA → NEIN)", () => {
    const head = ["SKU", "Min Price", "Max Price", "Repricing"];
    expect(formatLernen(head, [["A", "1.00", "2.00", "On"]], spaltenZuordnung(head), ",")!.aktivWerte).toEqual({ an: "On", aus: "Off" });
    expect(formatLernen(head, [["A", "1.00", "2.00", "Aktiv"]], spaltenZuordnung(head), ",")!.aktivWerte).toEqual({ an: "Aktiv", aus: "Inaktiv" });
    expect(formatLernen(head, [["A", "1.00", "2.00", "JA"]], spaltenZuordnung(head), ",")!.aktivWerte).toEqual({ an: "JA", aus: "NEIN" });
  });

  it("Ja/Nein-Paare: nur „Yes“ im Export → „No“ für aus; Tab als Trenner", () => {
    const head = ["SKU", "Min Price", "Max Price", "Repricing"];
    const rows = [["A", "1.00", "2.00", "Yes"]];
    const f = formatLernen(head, rows, spaltenZuordnung(head), "\t")!;
    expect(f.trenner).toBe("\t");
    expect(f.aktivWerte).toEqual({ an: "Yes", aus: "No" });
    expect(profitguardDatei([{ land: "DE", sku: "A", strategieName: "x", min: 1, max: 2, aktiv: false }], f)).toBe("SKU\tMin Price\tMax Price\tRepricing\r\nA\t1.00\t2.00\tNo\r\n");
  });

  it("ohne SKU-, Min- oder Max-Spalte wird kein Format gelernt", () => {
    const head = ["SKU", "Min Price", "Strategy"];
    expect(formatLernen(head, [["A", "1", "x"]], spaltenZuordnung(head), ",")).toBeNull();
  });
});

describe("ProfitGuard: Übersicht je Strategie und Filter", () => {
  const z = (sku: string, land: string, istStrategie: string | null, imRepricing: boolean | null, hinweise: Hinweis[] = []) => ({ sku, asin: null, titel: null, land, istStrategie, imRepricing, hinweise });
  const zeilen = [z("A", "DE", "PG Standard", true), z("A", "FR", "PG Standard", false, ["nicht_im_repricing"]), z("B", "DE", "PG Liquidation", true), z("C", "DE", null, null, ["ohne_min"])];

  it("Übersicht über alle Länder", () => {
    const u = strategieUebersicht(zeilen);
    expect(u[0]).toMatchObject({ strategie: "PG Standard", gesamt: 2, imRepricing: 1, nichtIm: 1, mitHinweis: 1, laender: { DE: 1, FR: 1 } });
    expect(u.find((x) => x.strategie === "(ohne Strategie)")).toMatchObject({ gesamt: 1, unbekannt: 1, mitHinweis: 1 });
  });

  it("Filter nach Land, Strategie, Repricing, Hinweis, Suche; Auffällige zuerst", () => {
    expect(filterAbgleich(zeilen, { land: "FR" }).map((x) => x.sku)).toEqual(["A"]);
    expect(filterAbgleich(zeilen, { strategie: "PG Standard", repricing: "ja" }).map((x) => `${x.sku}${x.land}`)).toEqual(["ADE"]);
    expect(filterAbgleich(zeilen, { repricing: "unbekannt" }).map((x) => x.sku)).toEqual(["C"]);
    expect(filterAbgleich(zeilen, { strategie: "(ohne Strategie)" }).map((x) => x.sku)).toEqual(["C"]);
    expect(filterAbgleich(zeilen, { nurAuffaellig: true }).map((x) => `${x.sku}${x.land}`)).toEqual(["CDE", "AFR"]);
    expect(filterAbgleich(zeilen, { hinweis: "ohne_min" }).map((x) => x.sku)).toEqual(["C"]);
    expect(filterAbgleich(zeilen, { q: "b" }).map((x) => x.sku)).toEqual(["B"]);
  });
});
