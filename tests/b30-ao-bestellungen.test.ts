// Nachtrag B30 (06.11.2026): ArbitrageOne-Export „Einkäufe“ (PurchaseOrders) als Bestellliste. Nur erfundene Werte.
import { describe, expect, it } from "vitest";
import {
  aoBestellSpalten,
  aoBestellungenGruppieren,
  aoBestellungenLesen,
  aoStatusAus,
  bestellText,
  ekAusLieferungen,
  istBestellKopf,
  poStatusAus,
  sbCogWarnung,
  spaltenFehlerText,
  type AoBestellPosition,
} from "@/lib/arbitrageone/bestellungen-logic";
import { AO_EXPORTE } from "@/lib/arbitrageone/logic";

const KOPF = ["Bestellnummer", "Bestelldatum", "Lieferant", "ASIN", "Seller SKU", "FNSKU", "Produktname", "Menge", "EK netto", "USt", "Versandkosten", "Status"];
const zeile = (o: Partial<Record<string, unknown>> = {}) => KOPF.map((k) => o[k] ?? { Bestellnummer: "PO-1001", Bestelldatum: "02.11.2026", Lieferant: "Testshop", ASIN: "B0TEST0001", "Seller SKU": "TEST-SKU-1", FNSKU: "X00TEST001", Produktname: "Testartikel (erfunden)", Menge: 3, "EK netto": "12,50", USt: "19 %", Versandkosten: "4,90", Status: "Bestellt" }[k]);

const pos = (o: Partial<AoBestellPosition>): AoBestellPosition => ({ zeile: 2, bestellnummer: "PO-1", positionsId: null, datum: "2026-11-02", lieferant: "Testshop", asin: "B0TEST0001", sku: "TEST-SKU-1", fnsku: null, titel: null, menge: 1, ekNetto: 10, ekBrutto: 11.9, ustSatz: 19, versand: null, status: "geliefert", statusRoh: "Geliefert", lager: null, charge: null, waehrung: null, ...o });

describe("B30.1 Spalten aus der Datei", () => {
  it("deutsche Bestellliste: jede Spalte richtig zugeordnet, Bestelldatum nicht als Bestellnummer", () => {
    const c = aoBestellSpalten(KOPF);
    expect(c).toMatchObject({ bestellnummer: 0, datum: 1, lieferant: 2, asin: 3, sku: 4, fnsku: 5, titel: 6, menge: 7, ekNetto: 8, ust: 9, versand: 10, status: 11 });
    expect(istBestellKopf(KOPF)).toBe(true);
  });

  it("englische Spalten: Einzelpreis vor Summe, ohne netto/brutto im Namen = netto angenommen", () => {
    const r = aoBestellungenLesen([["Order ID", "Order Date", "Supplier", "ASIN", "SKU", "Title", "Quantity", "Unit Price", "Total", "Status"], ["A-1", "2026-11-03", "Test Store", "B0TEST0002", "TEST-SKU-2", "Test item", "2", "7.50", "15.00", "Delivered"]]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preisArt).toBe("netto angenommen");
    expect(r.spalten).toMatchObject({ ek: "Unit Price", gesamt: "Total", menge: "Quantity", datum: "Order Date" });
    expect(r.positionen[0]).toMatchObject({ ekNetto: 7.5, ekBrutto: 8.925, status: "geliefert", menge: 2 });
  });

  it("Brutto mit USt-Satz → netto gerechnet; nur Gesamtpreis → je Stück", () => {
    const b = aoBestellungenLesen([["Bestelldatum", "ASIN", "Menge", "Einzelpreis brutto", "MwSt"], ["05.11.2026", "B0TEST0003", 1, "23,80", "19"]]);
    expect(b.ok && b.preisArt).toBe("brutto");
    expect(b.ok && b.positionen[0].ekNetto).toBe(20);
    const g = aoBestellungenLesen([["Datum", "ASIN", "Menge", "Gesamtpreis netto"], ["05.11.2026", "B0TEST0004", 4, "50,00"]]);
    expect(g.ok && g.positionen[0].ekNetto).toBe(12.5);
    // USt als 0,07 → 7 %
    const u = aoBestellungenLesen([["Bestelldatum", "ASIN", "Menge", "EK netto", "USt"], ["05.11.2026", "B0TEST0005", 1, "10,00", "0,07"]]);
    expect(u.ok && u.positionen[0]).toMatchObject({ ustSatz: 7, ekBrutto: 10.7 });
  });

  it("„Menge geliefert“ zählt nicht als Bestellmenge", () => {
    const c = aoBestellSpalten(["ASIN", "Bestelldatum", "Menge geliefert", "Menge", "EK netto"]);
    expect(c.menge).toBe(3);
    expect(aoBestellSpalten(["ASIN", "Bestelldatum", "Menge geliefert", "EK netto"]).menge).toBeUndefined();
  });

  it("fehlende Spalten: Meldung nennt gefundene und fehlende (B30.2)", () => {
    const r = aoBestellungenLesen([["Bestellnummer", "ASIN", "Menge", "Lieferant"], ["PO-1", "B0TEST0001", 1, "Testshop"]]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fehlt).toEqual(["Bestelldatum", "EK (Einzelpreis oder Gesamtpreis)"]);
    expect(spaltenFehlerText(r)).toBe("ArbitrageOne – Bestellungen: Spalten fehlen – gefunden: Bestellnummer, ASIN, Menge, Lieferant; fehlt: Bestelldatum, EK (Einzelpreis oder Gesamtpreis).");
  });

  it("fehlende Spalten mit Titelzeile davor: „gefunden“ nennt die Kopfzeile, nicht den Titel", () => {
    const mitAsin = aoBestellungenLesen([["PurchaseOrders Export"], [], ["Bestellnummer", "Lieferant", "ASIN", "Produktname"], ["PO-1", "Testshop", "B0TEST0001", "Testartikel"]]);
    expect(mitAsin.ok).toBe(false);
    if (mitAsin.ok) return;
    expect(mitAsin.gefunden).toEqual(["Bestellnummer", "Lieferant", "ASIN", "Produktname"]);
    expect(mitAsin.fehlt).toEqual(["Menge", "Bestelldatum", "EK (Einzelpreis oder Gesamtpreis)"]);
    // ohne ASIN-Spalte: erste Zeile mit mindestens 3 Spaltennamen
    const ohneAsin = aoBestellungenLesen([["Export vom 05.11.2026"], ["Order", "Shop", "Artikel", "Anzahl"], ["PO-1", "Testshop", "Testartikel", 2]]);
    expect(ohneAsin.ok).toBe(false);
    if (ohneAsin.ok) return;
    expect(ohneAsin.gefunden).toEqual(["Order", "Shop", "Artikel", "Anzahl"]);
    expect(ohneAsin.fehlt[0]).toBe("ASIN");
  });

  it("Titelzeilen davor, Leer- und Summenzeilen, ungültige ASIN, Datum mit Uhrzeit und Excel-Zahl", () => {
    const r = aoBestellungenLesen([["Bestellungen Export 06.11.2026"], [], KOPF, zeile(), zeile({ ASIN: "KEINEASIN", Bestellnummer: "PO-1002" }), zeile({ Bestellnummer: "PO-1003", Bestelldatum: "06.11.2026 08:05" }), zeile({ Bestellnummer: "PO-1004", Bestelldatum: 46331 }), ["", "", "", "", "", "", "Summe", "", "37,50"]]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.positionen.map((p) => p.datum)).toEqual(["2026-11-02", "2026-11-06", "2026-11-05"]);
    expect(r.uebersprungen).toBe(1);
    expect(r.positionen[0]).toMatchObject({ zeile: 4, bestellnummer: "PO-1001", sku: "TEST-SKU-1", fnsku: "X00TEST001", ekNetto: 12.5, ekBrutto: 14.875, ustSatz: 19, versand: 4.9, status: "bestellt" });
    expect(r.statusWerte).toEqual({ Bestellt: 3 });
  });

  it("Status-Texte", () => {
    expect(["Bestellt", "Geliefert", "Storniert", "Versendet", "teilweise geliefert", "Eingelagert", "Delivered", "Cancelled", "irgendwas", ""].map(aoStatusAus)).toEqual(["bestellt", "geliefert", "storniert", "versendet", "teilweise", "geliefert", "geliefert", "storniert", null, null]);
  });

  it("Abruf übergibt „Einkäufe“ als ao_einkaeufe (B30.2)", () => {
    expect(AO_EXPORTE.find((e) => e.key === "einkaeufe")?.art).toBe("ao_einkaeufe");
    expect(AO_EXPORTE.find((e) => e.key === "sellerboard")?.art).toBe("ek_liste");
  });
});

describe("B30.1 Bestellungen, doppelte Positionen, Status", () => {
  it("Positionen nach Bestellnummer; gleiche ASIN zweimal → zwei Schlüssel; ohne Nummer nach Lieferant + Datum", () => {
    const b = aoBestellungenGruppieren([pos({ zeile: 2 }), pos({ zeile: 3 }), pos({ zeile: 4, asin: "B0TEST0009", sku: null }), pos({ zeile: 5, bestellnummer: null, lieferant: "Anderer Shop" })]);
    expect(b).toHaveLength(2);
    expect(b[0].nummer).toBe("AO-PO-1");
    expect(b[0].positionen.map((p) => p.schluessel)).toEqual(["nr:po-1|B0TEST0001|test-sku-1|1", "nr:po-1|B0TEST0001|test-sku-1|2", "nr:po-1|B0TEST0009||1"]);
    expect(b[1].schluessel).toBe("ld:anderer shop|2026-11-02");
    expect(b[1].nummer).toMatch(/^AO-20261102-[0-9A-Z]{6}$/);
    // Positions-ID hat Vorrang
    expect(aoBestellungenGruppieren([pos({ positionsId: "L-77" })])[0].positionen[0].schluessel).toBe("pid:l-77");
  });

  it("gleicher Schlüssel in der nächsten Tagesdatei (auch mit neuem Status)", () => {
    const heute = aoBestellungenGruppieren([pos({ status: "bestellt" })])[0].positionen[0].schluessel;
    const morgen = aoBestellungenGruppieren([pos({ status: "geliefert" })])[0].positionen[0].schluessel;
    expect(morgen).toBe(heute);
  });

  it("Versandkosten: in jeder Zeile gleich → einmal, sonst Summe", () => {
    expect(aoBestellungenGruppieren([pos({ versand: 4.9 }), pos({ versand: 4.9, asin: "B0TEST0002" })])[0].versand).toBe(4.9);
    expect(aoBestellungenGruppieren([pos({ versand: 2 }), pos({ versand: 3, asin: "B0TEST0002" })])[0].versand).toBe(5);
  });

  it("Status der Bestellung aus den Positionen; ohne Status nach 21 Tagen geliefert", () => {
    const h = "2026-11-06";
    expect(poStatusAus([{ status: "geliefert", datum: h }, { status: "geliefert", datum: h }], h)).toBe("received");
    expect(poStatusAus([{ status: "geliefert", datum: h }, { status: "bestellt", datum: h }], h)).toBe("partial");
    expect(poStatusAus([{ status: "storniert", datum: h }], h)).toBe("cancelled");
    expect(poStatusAus([{ status: "geliefert", datum: h }, { status: "storniert", datum: h }], h)).toBe("received");
    expect(poStatusAus([{ status: "versendet", datum: h }], h)).toBe("shipped");
    expect(poStatusAus([{ status: null, datum: "2026-11-01" }], h)).toBe("ordered");
    expect(poStatusAus([{ status: null, datum: "2026-10-10" }], h)).toBe("received");
  });
});

describe("B30.1.3 EK je SKU aus den Lieferungen", () => {
  it("mengengewichteter Durchschnitt der letzten 3 gelieferten Positionen; storniert/offen zählen nicht", () => {
    const ek = ekAusLieferungen(
      [
        pos({ datum: "2026-10-01", menge: 10, ekNetto: 5 }), // älteste – fällt bei 4 Lieferungen raus
        pos({ datum: "2026-10-10", menge: 2, ekNetto: 10 }),
        pos({ datum: "2026-10-20", menge: 1, ekNetto: 13 }),
        pos({ datum: "2026-11-01", menge: 1, ekNetto: 11 }),
        pos({ datum: "2026-11-05", menge: 5, ekNetto: 1, status: "bestellt" }),
        pos({ datum: "2026-11-05", menge: 5, ekNetto: 1, status: "storniert" }),
        pos({ sku: "TEST-SKU-2", datum: "2026-11-02", menge: 3, ekNetto: 4 }),
      ],
      "2026-11-06",
    );
    expect(ek).toEqual([
      { sku: "TEST-SKU-1", asin: "B0TEST0001", ekNetto: 11, lieferungen: 3, stueck: 4, letzte: "2026-11-01" },
      { sku: "TEST-SKU-2", asin: "B0TEST0001", ekNetto: 4, lieferungen: 1, stueck: 3, letzte: "2026-11-02" },
    ]);
  });

  it("Warnung bei mehr als 10 % Abweichung zum sellerboard-COG", () => {
    expect(sbCogWarnung(12, 10)).toBe("weicht +20 % vom sellerboard-COG (10,00 €) ab");
    expect(sbCogWarnung(8.5, 10)).toBe("weicht -15 % vom sellerboard-COG (10,00 €) ab");
    expect(sbCogWarnung(10.5, 10)).toBeNull();
    expect(sbCogWarnung(12, 0.01)).toBeNull();
    expect(sbCogWarnung(12, null)).toBeNull();
  });

  it("Ergebnistext „n Bestellungen, m Positionen, k ohne Zuordnung“", () => {
    expect(bestellText({ bestellungen: 1, positionen: 1, ohneZuordnung: 0 })).toBe("1 Bestellung, 1 Position, 0 ohne Zuordnung");
    expect(bestellText({ bestellungen: 12, positionen: 30, ohneZuordnung: 4 })).toBe("12 Bestellungen, 30 Positionen, 4 ohne Zuordnung");
  });
});
