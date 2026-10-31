import { describe, expect, it } from "vitest";
import { abgleich, abverkaufVorschlagen, minBlockiertBuybox, regelNameFuerLand, buyboxErklaerung, BQOOL_ERSTE_ZEILE, bqoolCost, bqoolDatei, breakEvenMin, dateiMin, effektiverMin, FORMAT_STANDARD, KATALOG_STANDARD, katalogRegel, landAus, liesBqoolDatei, margeNachAlter, maxPreis, regelFuer, UST, vergleiche, warnungen, type ExportZeile } from "@/lib/bqool/export-logic";

// BQool-Dateien aus dem System – erfundene SKUs und Preise.

describe("Break-even je Land", () => {
  const basis = { ek: 10, fba: 3.5, fix: 0, zusatz: 0, provision: 0.15, margeProzent: 10 };
  it("P = (FBA + Fix + EK) / (1/(1+USt) − Provision − Marge), aufgerundet", () => {
    // DE: 13,5 / (1/1,19 − 0,15 − 0,10) = 13,5 / 0,590336… = 22,87
    expect(breakEvenMin({ ...basis, ust: UST.DE })).toBe(22.87);
  });
  it("FR/IT/ES mit landeseigener USt – höher als mit 19 %", () => {
    const de = breakEvenMin({ ...basis, ust: UST.DE })!;
    const fr = breakEvenMin({ ...basis, ust: UST.FR })!;
    const it_ = breakEvenMin({ ...basis, ust: UST.IT })!;
    const es = breakEvenMin({ ...basis, ust: UST.ES })!;
    expect(fr).toBeGreaterThan(de);
    expect(it_).toBeGreaterThan(es);
    expect(es).toBeGreaterThan(fr);
    expect(it_).toBe(23.7); // 13,5 / (1/1,22 − 0,25) = 23,697… → 23,70
  });
  it("Nenner ≤ 0 → kein Preis", () => {
    expect(breakEvenMin({ ...basis, ust: 0.19, provision: 0.5, margeProzent: 40 })).toBeNull();
  });
  it("Marge nach Lagerdauer 10/8/7/5/3/1/0 %", () => {
    expect([null, 10, 45, 80, 120, 200, 300, 400].map((t) => margeNachAlter(t))).toEqual([10, 10, 8, 7, 5, 3, 1, 0]);
  });
  it("Max: Ø Buy Box × 1,3 oder Listenpreis; nie unter Min; ohne Daten Min × Faktor", () => {
    expect(maxPreis({ min: 20, bb90: 30, faktor: 1.3, listenpreis: null, ersatzFaktor: 2 })).toBe(39);
    expect(maxPreis({ min: 20, bb90: 30, faktor: 1.3, listenpreis: 49.99, ersatzFaktor: 2 })).toBe(49.99);
    expect(maxPreis({ min: 50, bb90: 30, faktor: 1.3, listenpreis: null, ersatzFaktor: 2 })).toBe(50);
    expect(maxPreis({ min: 20, bb90: null, faktor: 1.3, listenpreis: null, ersatzFaktor: 2 })).toBe(40);
  });
});

describe("Regel je SKU und Land", () => {
  const basis = { titel: null, zuweisung: null, markenRegeln: [{ marke: "Testphil", land: "DE" as const, regel: "Abverkauf" }], aufAbverkaufsListe: false, abverkaufRegel: { DE: "Abverkauf DE", sonst: "Abverkauf" }, standard: "ia" };
  it("Standard „ia“", () => expect(regelFuer({ ...basis, land: "DE" }).regel).toBe("ia"));
  it("Abverkaufs-Liste: DE „Abverkauf DE“, FR/IT/ES „Abverkauf“", () => {
    expect(regelFuer({ ...basis, land: "DE", aufAbverkaufsListe: true }).regel).toBe("Abverkauf DE");
    expect(regelFuer({ ...basis, land: "IT", aufAbverkaufsListe: true }).regel).toBe("Abverkauf");
  });
  it("Markenregel nur im genannten Land (Philips-Fall: DE → „Abverkauf“)", () => {
    expect(regelFuer({ ...basis, land: "DE", titel: "TESTPHIL Rasierer 3000 (erfunden)", aufAbverkaufsListe: true }).regel).toBe("Abverkauf");
    expect(regelFuer({ ...basis, land: "DE", titel: "Testphilosophie Buch" }).regel).toBe("ia");
    expect(regelFuer({ ...basis, land: "FR", titel: "Testphil Rasierer" }).regel).toBe("ia");
  });
  it("Feste Zuweisung (Liquidation mit Untergrenze) geht vor", () => {
    expect(regelFuer({ ...basis, land: "FR", titel: "Testphil Rasierer", zuweisung: { regel: "Liquidation", untergrenze: 12.5, quelle: "vorlage" } })).toEqual({ regel: "Liquidation", quelle: "zuweisung", untergrenze: 12.5 });
  });
  it("Kapital-Vorschlag nur bei Rot und Reichweite > 120", () => {
    expect(abverkaufVorschlagen({ ampel: "rot", reichweite: 200 }, 120)).toBe(true);
    expect(abverkaufVorschlagen({ ampel: "rot", reichweite: 100 }, 120)).toBe(false);
    expect(abverkaufVorschlagen({ ampel: "gelb", reichweite: 300 }, 120)).toBe(false);
    expect(abverkaufVorschlagen(null, 120)).toBe(false);
  });
});

describe("Datei", () => {
  const zeilen: ExportZeile[] = [
    { land: "FR", sku: "TEST-SOCKEN", cost: 3.1, zusatz: 0, regel: "ia", min: 9.99, max: 19.5 },
    { land: "FR", sku: "TEST-TASSE", cost: 4, zusatz: 0.35, regel: "Abverkauf", min: 12, max: 24 },
  ];
  it("Format wie die angenommene Datei: Zeile 1 wörtlich + 10 Tabs, LF, „Amazon FR“, Shipping 0.00, Enable 1/0", () => {
    const d = bqoolDatei("FR", [...zeilen.slice(0, 1), { ...zeilen[1], enable: "0" }]);
    expect(d).not.toContain("\r");
    const z = d.split("\n");
    expect(z[0]).toBe(BQOOL_ERSTE_ZEILE + "\t".repeat(10));
    expect(z[1]).toBe("Channel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing");
    expect(z[2]).toBe("Amazon FR\tTEST-SOCKEN\t3.10\t\tia\t9.99\t19.50\t0.00\t\t\t1");
    expect(z[3]).toBe("Amazon FR\tTEST-TASSE\t4.00\t0.35\tAbverkauf\t12.00\t24.00\t0.00\t\t\t0");
    expect(d.endsWith("\n")).toBe(true);
    expect(d).not.toMatch(/\d,\d/);
  });
  it("Eigene Datei wieder einlesen ergibt dieselben Werte und dasselbe Format", () => {
    const d = bqoolDatei("FR", zeilen);
    const r = liesBqoolDatei(d, "Export_FR.txt");
    expect(r.land).toBe("FR");
    expect(r.format).toMatchObject({ tabsErsteZeile: 10, zeilenende: "\n", bom: false, schlussUmbruch: true, channel: "Amazon FR", shipping: "0.00", enable: "1" });
    expect(r.zeilen[1]).toMatchObject({ sku: "TEST-TASSE", cost: 4, zusatz: 0.35, regel: "Abverkauf", min: 12, max: 24 });
    // Mit dem gelernten Format neu geschrieben → Zeichen für Zeichen gleich
    expect(bqoolDatei("FR", zeilen, { ...FORMAT_STANDARD, ...r.format, channel: { ...FORMAT_STANDARD.channel, FR: r.format.channel! }, ausVorlage: true })).toBe(d);
  });
  it("BQool-eigene Vorlage (CRLF, ohne Tabs in Zeile 1) wird gelesen", () => {
    const vorlage = ["FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)", "Channel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing", "Amazon IT\tTEST-SOCKEN\t3.69\t\tLiquidation\t6.99\t29.99\t0.00\t\t\t1", ""].join("\r\n");
    const r = liesBqoolDatei(vorlage, "Listings_-_2026-10-30.txt");
    expect(r.land).toBe("IT");
    expect(r.format).toMatchObject({ tabsErsteZeile: 0, zeilenende: "\r\n" });
    expect(r.zeilen[0]).toMatchObject({ sku: "TEST-SOCKEN", regel: "Liquidation", min: 6.99, enable: "1" });
  });
  it("Cost = EK netto × 1,19 (wie in den bisherigen Dateien, alle Länder)", () => {
    expect(bqoolCost(10)).toBe(11.9);
    expect(bqoolCost(3.1)).toBe(3.69);
  });
  it("Keine BQool-Datei → Fehler; Land aus Dateiname oder Channel", () => {
    expect(landAus("Listings.txt", "Amazon DE")).toBe("DE");
    expect(() => liesBqoolDatei("sku;min\n1;2", "x.txt")).toThrow(/FileType = repricing/);
    expect(landAus("Liquidation_IT.txt")).toBe("IT");
    expect(landAus("Abverkauf DE.txt")).toBe("DE");
    expect(landAus("export.txt", "Amazon.es")).toBe("ES");
    expect(landAus("export.txt")).toBeNull();
  });
});

describe("Freigabe", () => {
  it("neu / geändert / gleich mit Regelwechsel und Min-Differenz", () => {
    const neu: ExportZeile[] = [
      { land: "DE", sku: "A", cost: 1, zusatz: 0, regel: "ia", min: 10, max: 20 },
      { land: "DE", sku: "B", cost: 1, zusatz: 0, regel: "Abverkauf DE", min: 8, max: 20 },
      { land: "DE", sku: "C", cost: 1, zusatz: 0, regel: "ia", min: 5, max: 9 },
    ];
    const ist = new Map([
      ["A", { regel: "ia", min: 10, max: 20 }],
      ["B", { regel: "ia", min: 9.5, max: 20 }],
    ]);
    const v = vergleiche(neu, ist);
    expect(v.map((x) => x.art)).toEqual(["gleich", "geaendert", "neu"]);
    expect(v[1]).toMatchObject({ regelWechsel: true, minAlt: 9.5, minDiff: -1.5 });
  });
  it("Warnungen: Min über Buy Box × 1,2; Min unter Break-even", () => {
    expect(warnungen({ min: 25, max: 30 }, { buybox: 20, breakEven: null })[0]).toMatch(/verliert die Buy Box/);
    expect(warnungen({ min: 23.9, max: 30 }, { buybox: 20, breakEven: null })).toEqual([]);
    expect(warnungen({ min: 9, max: 30 }, { buybox: null, breakEven: 11.2 })[0]).toMatch(/unter Break-even 11.20/);
  });
});

describe("Regel-Katalog", () => {
  const basis = { untergrenze: null, ek: 10, fba: 3.5, fix: 0, zusatz: 0, ust: 0.19, provision: 0.15, alterTage: 45 };
  it("Margen-Regel: effektiver Min mit Marge der Altersstufe; Datei-Min = Break-even ohne Marge", () => {
    const ia = katalogRegel(KATALOG_STANDARD, "IA");
    expect(effektiverMin({ ...basis, regel: ia })).toEqual({ min: breakEvenMin({ ...basis, margeProzent: 8 }), marge: 8, unterregel: "Equalizer", art: "marge" });
    expect(effektiverMin({ ...basis, regel: ia, alterTage: 10 })).toMatchObject({ marge: 10, unterregel: "Sales Booster" });
    // Abverkauf DE: 0–30 T Equalizer 7 %, 181–270 T Sales Booster 0 %
    const ad = katalogRegel(KATALOG_STANDARD, "Abverkauf DE");
    expect(effektiverMin({ ...basis, regel: ad, alterTage: 20 })).toMatchObject({ marge: 7, unterregel: "Equalizer" });
    expect(effektiverMin({ ...basis, regel: ad, alterTage: 200 })).toMatchObject({ marge: 0, unterregel: "Sales Booster" });
    const be = breakEvenMin({ ...basis, margeProzent: 0 });
    expect(dateiMin({ regel: ia, untergrenze: null, breakEven: be })).toBe(be);
  });
  it("Liquidation: Untergrenze maßgeblich; mbb: Break-even, ohne Untergrenze; unbekannt", () => {
    const liq = katalogRegel(KATALOG_STANDARD, "Liquidation");
    expect(effektiverMin({ ...basis, regel: liq, untergrenze: 6.99 })).toMatchObject({ min: 6.99, art: "untergrenze" });
    expect(dateiMin({ regel: liq, untergrenze: 6.99, breakEven: 20 })).toBe(6.99);
    expect(effektiverMin({ ...basis, regel: katalogRegel(KATALOG_STANDARD, "mbb") }).art).toBe("ohne_untergrenze");
    expect(effektiverMin({ ...basis, regel: null }).art).toBe("unbekannte_regel");
  });
  it("Abgleich Ist ↔ Soll: unbekannte Regel, ohne Regel, Risiko, Liquidation abweichend", () => {
    const f = abgleich(
      [
        { land: "DE", sku: "A", regel: "AI Win Sales Booster" },
        { land: "DE", sku: "B", regel: null },
        { land: "FR", sku: "C", regel: "mbb" },
        { land: "IT", sku: "D", regel: "ia" },
        { land: "IT", sku: "E", regel: "Liquidation" },
        { land: "IT", sku: "F", regel: "ia" },
      ],
      new Map([["IT|D", "Liquidation"], ["IT|F", "ia"]]),
      KATALOG_STANDARD,
    );
    expect(f.map((x) => `${x.sku}:${x.art}`)).toEqual(["A:unbekannte_regel", "B:ohne_regel", "C:risiko_regel", "D:liquidation_soll"]);
    // E: in BQool Liquidation, im System nichts festgelegt → kein Fall (Soll unbekannt); mit Soll „ia“ → Fall
    expect(abgleich([{ land: "IT", sku: "E", regel: "Liquidation" }], new Map([["IT|E", "ia"]]), KATALOG_STANDARD)[0].art).toBe("liquidation_ist");
  });
});

describe("Buy Box erklären", () => {
  it("Equalizer: bewusst 1 Cent über Buy Box; Sales Booster: auf Min; Buy Box über Min: nichts", () => {
    expect(buyboxErklaerung({ buybox: 19.5, effMin: 21, unterregel: "Equalizer" })).toMatch(/bewusst 1 Cent über Buy Box \(Marge geschützt\)/);
    expect(buyboxErklaerung({ buybox: 19.5, effMin: 21, unterregel: "Sales Booster" })).toMatch(/auf dem Mindestpreis/);
    expect(buyboxErklaerung({ buybox: 22, effMin: 21, unterregel: "Equalizer" })).toBeNull();
    expect(buyboxErklaerung({ buybox: null, effMin: 21, unterregel: "Equalizer" })).toBeNull();
  });
});

describe("Ausnahmen je ASIN", () => {
  const basis = { titel: "Testphil Rasierer (erfunden)", zuweisung: null, markenRegeln: [{ marke: "B0TESTPH01", land: "DE" as const, regel: "Abverkauf" }], aufAbverkaufsListe: false, abverkaufRegel: { DE: "Abverkauf DE", sonst: "Abverkauf" }, standard: "ia" };
  it("ASIN genau, nur im genannten Land; andere ASIN derselben Marke bleibt ia", () => {
    expect(regelFuer({ ...basis, land: "DE", asin: "B0TESTPH01" }).regel).toBe("Abverkauf");
    expect(regelFuer({ ...basis, land: "FR", asin: "B0TESTPH01" }).regel).toBe("ia");
    expect(regelFuer({ ...basis, land: "DE", asin: "B0TESTPH02" }).regel).toBe("ia");
  });
});


// B17: Soll-Regeln aus dem letzten BQool-Ist (Liquidation/Abverkauf bleiben), Regelnamen je Land laut Katalog,
// Warnung „Min aus Upload blockiert Buy Box“. Erfundene SKUs/ASINs.
describe("B17 – Soll-Regel aus BQool-Ist und Katalog", () => {
  const basis = { titel: null, zuweisung: null, markenRegeln: [{ marke: "B0TESTPH09", land: "DE" as const, regel: "Abverkauf" }], aufAbverkaufsListe: false, abverkaufRegel: { DE: "Abverkauf DE", sonst: "Abverkauf" }, standard: "ia", katalog: KATALOG_STANDARD };
  it("Regelnamen je Land: DE „Abverkauf DE“, FR/IT/ES „Abverkauf“", () => {
    expect(regelNameFuerLand("Abverkauf", "DE", KATALOG_STANDARD)).toBe("Abverkauf DE");
    expect(regelNameFuerLand("Abverkauf DE", "FR", KATALOG_STANDARD)).toBe("Abverkauf");
    expect(regelNameFuerLand("Abverkauf", "ES", KATALOG_STANDARD)).toBe("Abverkauf");
    expect(regelNameFuerLand("Liquidation", "DE", KATALOG_STANDARD)).toBe("Liquidation");
    expect(regelNameFuerLand("Unbekannt X", "DE", KATALOG_STANDARD)).toBe("Unbekannt X");
  });
  it("Markenregel „Abverkauf“ in DE wird „Abverkauf DE“ (Philips-Fall)", () => {
    expect(regelFuer({ ...basis, land: "DE", asin: "B0TESTPH09" }).regel).toBe("Abverkauf DE");
  });
  it("Liquidation laut BQool-Ist bleibt (mit Min als Untergrenze) – auch gegen Abverkaufs-Liste/Markenregel", () => {
    expect(regelFuer({ ...basis, land: "FR", aufAbverkaufsListe: true, ist: { regel: "Liquidation", min: 14.9 } })).toEqual({ regel: "Liquidation", quelle: "ist", untergrenze: 14.9 });
    expect(regelFuer({ ...basis, land: "DE", asin: "B0TESTPH09", ist: { regel: "Liquidation", min: 9.5 } }).regel).toBe("Liquidation");
  });
  it("„Abverkauf DE“ laut BQool-Ist bleibt, „ia“/mbb laut Ist ergeben den Standard", () => {
    expect(regelFuer({ ...basis, land: "DE", ist: { regel: "Abverkauf DE", min: 20 } })).toEqual({ regel: "Abverkauf DE", quelle: "ist", untergrenze: null });
    expect(regelFuer({ ...basis, land: "DE", ist: { regel: "ia", min: 20 } }).regel).toBe("ia");
    expect(regelFuer({ ...basis, land: "DE", ist: { regel: "mbb", min: 20 } }).regel).toBe("ia");
  });
  it("Feste Zuweisung geht weiter vor dem Ist", () => {
    expect(regelFuer({ ...basis, land: "DE", ist: { regel: "Liquidation", min: 9 }, zuweisung: { regel: "ia", untergrenze: null, quelle: "hand" } }).regel).toBe("ia");
  });
  it("Warnung: Min aus Upload über Buy Box, effektiver Min darunter", () => {
    expect(minBlockiertBuybox({ istMin: 25, effMin: 19.8, buybox: 22.5 })).toMatch(/^Min aus Upload blockiert Buy Box – neuer Upload mit Min = effektiver Min empfohlen/);
    expect(minBlockiertBuybox({ istMin: 21, effMin: 19.8, buybox: 22.5 })).toBeNull();
    expect(minBlockiertBuybox({ istMin: 25, effMin: 25, buybox: 22.5 })).toBeNull();
    expect(minBlockiertBuybox({ istMin: 25, effMin: 19, buybox: null })).toBeNull();
  });
});
