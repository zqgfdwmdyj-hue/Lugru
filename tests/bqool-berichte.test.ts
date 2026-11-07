// B31.5 BQool-Berichte „Listing Performance“ und „Daily Sales“ – reine Logik. Alle SKUs und Zahlen erfunden.
import { describe, expect, it } from "vitest";
import { berichtArt, buyboxAnteil, buyboxWochen, buyboxZeile, isoWoche, landAusRegeln, landVorschlag, leistungAuswerten, leseDailySales, leseListingPerformance, produktTeile, tagesLand, zahlDe, zeitraumAus } from "@/lib/bqool/berichte-logic";
import { tabellenArt } from "@/lib/uploads/erkennen";

const LP_KOPF = "﻿Products\tRules\tSales\tSales %\tOrders\tUnits Ordered\tRefunds\tEst. Profit\tBuy Box Wins\tLowest Price Win %\tAt Min %\tAt Max %\tBelow Min %\tAvg Offers\tAvg Position\tLowest Price Lost Non-Feature %\tReprice\tPrice Up\tPrice Down\tPrice Changes\tCompete Amazon %\tBuy Box Lost Amazon %\tBuy Box Lost FBA %\tBuy Box Lost FBM %".split("\t");
const DS_KOPF = "﻿Date\tSales\tSales (FBA)\tSales (FBM)\tOrders\tUnits Ordered\tEst. Profit\tBuy Box Wins\tAvg Offers".split("\t");

describe("Erkennung", () => {
  it("Listing Performance und Daily Sales an der Kopfzeile, Manage Listings bleibt „bqool“", () => {
    expect(berichtArt(LP_KOPF)).toBe("listing_performance");
    expect(berichtArt(DS_KOPF)).toBe("daily_sales");
    expect(tabellenArt(LP_KOPF, "Listing_Performance_123.txt")).toBe("bqool_listing_performance");
    expect(tabellenArt(DS_KOPF, "Daily_Sales_123.txt")).toBe("bqool_daily_sales");
    expect(berichtArt(["SKU", "ASIN", "Min Price", "Max Price", "Rule Name"])).toBeNull();
    expect(berichtArt(["Date", "Sales", "Orders"])).toBeNull();
  });
});

describe("Zahlen", () => {
  it("deutsche Beträge und Prozente, „-“ = leer", () => {
    expect(zahlDe("1.919,12 €")).toBe(1919.12);
    expect(zahlDe("97,35%")).toBe(97.35);
    expect(zahlDe("-278,00 €")).toBe(-278);
    expect(zahlDe("−6.573,40 €")).toBe(-6573.4);
    expect(zahlDe("(12,00)")).toBe(-12);
    expect(zahlDe("-")).toBeNull();
    expect(zahlDe("")).toBeNull();
    expect(zahlDe("613")).toBe(613);
    expect(zahlDe("1.234")).toBe(1234);
    expect(zahlDe("0.125")).toBe(0.125);
    expect(zahlDe("3,4")).toBe(3.4);
  });
});

describe("Produktspalte", () => {
  it("SKU und ASIN aus der Zelle – mit Bezeichnung, bekannter SKU oder einzelnem Wort", () => {
    expect(produktTeile("Testartikel Tasse blau\nASIN: B0TEST0001\nSKU: TEST-LP-1")).toEqual({ sku: "TEST-LP-1", asin: "B0TEST0001", titel: "Testartikel Tasse blau" });
    expect(produktTeile("Testartikel Socken B0TEST0002 TEST-LP-2", new Set(["TEST-LP-2"]))).toMatchObject({ sku: "TEST-LP-2", asin: "B0TEST0002" });
    expect(produktTeile("TEST-LP-3")).toMatchObject({ sku: "TEST-LP-3" });
    expect(produktTeile("Testartikel ohne Kennung")).toMatchObject({ sku: null });
  });
});

describe("Listing Performance lesen", () => {
  const z = (p: string, regel: string, sales: string, units: string, profit: string, bb: string, below: string, extra: Partial<Record<"up" | "chg", string>> = {}) =>
    [p, regel, sales, "1%", "1", units, "0", profit, bb, "0%", "0%", "0%", below, "3", "2", "0%", "10", extra.up ?? "5", "5", extra.chg ?? "12,00 €", "0%", "0%", "0%", "0%"];
  it("eine Zeile je SKU; doppelte SKU (zwei Regeln) zusammengefasst, Regel der Zeile mit Daten", () => {
    const r = leseListingPerformance(LP_KOPF, [
      z("SKU: TEST-LP-1", "ia", "1.919,12 €", "8", "120,50 €", "97,35%", "0%"),
      z("SKU: TEST-LP-2", "ia", "-", "-", "-", "-", "-"),
      z("SKU: TEST-LP-2", "Abverkauf", "50,00 €", "2", "-30,00 €", "40%", "60%"),
      ["Total", "-", "1.969,12 €", "100%", "3", "10", "0", "90,50 €", "68,5%", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["Testartikel ohne Kennung", "ia", "1,00 €"],
    ]);
    expect(r.zeilen.map((x) => [x.sku, x.regel, x.sales, x.units, x.profit, x.bbWins, x.belowMin])).toEqual([
      ["TEST-LP-1", "ia", 1919.12, 8, 120.5, 97.35, 0],
      ["TEST-LP-2", "Abverkauf", 50, 2, -30, 40, 60],
    ]);
    expect(r.doppelt).toBe(1);
    expect(r.ohneSku).toBe(1);
    expect(r.zeilen[1].zusatz.Regeln).toBe("ia, Abverkauf");
    expect(buyboxAnteil(r.zeilen, r.summe)).toBe(68.5);
    expect(buyboxAnteil(r.zeilen, null)).toBe(68.7);
  });
});

describe("Daily Sales lesen", () => {
  it("Datum in mehreren Schreibweisen, Tag/Monat über aufeinanderfolgende Tage entschieden, Summenzeile ungültig", () => {
    const zeile = (d: string, s: string) => [d, s, s, "0,00 €", "2", "3", "10,00 €", "50%", "4"];
    expect(leseDailySales(DS_KOPF, [zeile("2026-11-05", "100,00 €"), zeile("Total", "1,00 €")])).toMatchObject({ tage: [{ tag: "2026-11-05", sales: 100, bbWins: 50 }], ungueltig: 1 });
    expect(leseDailySales(DS_KOPF, [zeile("01/11/2026", "1"), zeile("02/11/2026", "2"), zeile("03/11/2026", "3")]).tage.map((t) => t.tag)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(leseDailySales(DS_KOPF, [zeile("11/01/2026", "1"), zeile("11/02/2026", "2")]).tage.map((t) => t.tag)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(leseDailySales(DS_KOPF, [zeile("13/11/2026", "1")]).tage[0].tag).toBe("2026-11-13");
    expect(leseDailySales(DS_KOPF, [zeile("Nov 06, 2026", "1"), zeile("06.11.2026", "2")]).tage.map((t) => t.sales)).toEqual([2]);
  });
});

describe("Land ableiten", () => {
  it("Regelname: „Abverkauf DE“ → DE, „Abverkauf“ schließt DE aus", () => {
    expect(landAusRegeln(["ia", "Abverkauf DE"])).toEqual({ land: "DE", moeglich: ["DE"] });
    expect(landAusRegeln(["ia", "Abverkauf"])).toEqual({ land: null, moeglich: ["FR", "IT", "ES"] });
    expect(landAusRegeln(["ia"])).toEqual({ land: null, moeglich: ["DE", "FR", "IT", "ES"] });
  });
  it("Abgleich mit dem letzten Ist je Land; sonst Rückfrage mit Vorschlag", () => {
    const ist = {
      DE: new Map([["A", "ia"], ["B", "ia"], ["C", "ia"], ["D", "Abverkauf DE"]]),
      FR: new Map([["A", "ia"], ["B", "Abverkauf"]]),
      IT: new Map([["A", "Abverkauf"], ["C", "ia"]]),
    };
    const fr = landVorschlag([{ sku: "A", regel: "ia" }, { sku: "B", regel: "Abverkauf" }], ist);
    expect(fr).toMatchObject({ land: "FR", sicher: true });
    const unklar = landVorschlag([{ sku: "A", regel: "ia" }], { FR: new Map([["A", "ia"], ["X", "ia"]]), IT: new Map([["A", "ia"], ["Y", "ia"]]) });
    expect(unklar).toMatchObject({ land: null, sicher: false });
    expect(unklar.vorschlag).not.toBeNull();
    expect(landVorschlag([{ sku: "Z", regel: "ia" }], {})).toMatchObject({ land: null, vorschlag: null });
  });
  it("Daily Sales: Umsatz gegen die Listing-Performance-Summe je Land", () => {
    const tage = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].map((tag) => ({ tag, sales: 100, salesFba: 100, salesFbm: 0, orders: 1, units: 1, profit: 10, bbWins: 50, zusatz: {} }));
    const lp = [
      { land: "DE" as const, stichtag: "2026-11-07", tage: 7, sales: 702 },
      { land: "FR" as const, stichtag: "2026-11-07", tage: 7, sales: 300 },
    ];
    expect(tagesLand(tage, lp)).toMatchObject({ land: "DE", sicher: true });
    expect(tagesLand(tage, [{ land: "FR", stichtag: "2026-11-07", tage: 7, sales: 300 }])).toMatchObject({ land: null, vorschlag: "FR" });
    expect(tagesLand(tage, [])).toMatchObject({ land: null, vorschlag: null });
  });
});

describe("Auswertung", () => {
  const leer = { asin: null, titel: null, orders: null, lowestWin: null, atMin: null, atMax: null, avgOffers: null, avgPosition: null, reprice: null, priceDown: null, bbLostAmazon: null, bbLostFba: null, bbLostFbm: null, zusatz: {} };
  const z = (sku: string, o: { regel?: string; below?: number; bb?: number; profit?: number; up?: number; chg?: number }) => ({ ...leer, land: "DE", sku, regel: o.regel ?? "ia", sales: 10, units: 1, profit: o.profit ?? 5, bbWins: o.bb ?? 50, belowMin: o.below ?? 0, priceUp: o.up ?? 0, priceChanges: o.chg ?? 0 });
  it("drei Listen mit Vorschlag", () => {
    const k = new Map([
      ["DE|U1", { bqMin: 120, effMin: 100, liquidation: false }],
      ["DE|U2", { bqMin: 100, effMin: 100, liquidation: false }],
      ["DE|V1", { bqMin: 50, effMin: 60, liquidation: false }],
      ["DE|V2", { bqMin: 50, effMin: 40, liquidation: true }],
    ]);
    const r = leistungAuswerten([z("U1", { below: 80, bb: 5 }), z("U2", { below: 50, bb: 0 }), z("U3", { below: 90, bb: 0 }), z("OK", { below: 40, bb: 5 }), z("V1", { profit: -10 }), z("V2", { profit: -278, regel: "Abverkauf DE" }), z("P1", { chg: -6573.4 }), z("P2", { up: 613, below: 100, bb: 20 })], k);
    expect(r.unterMin.map((f) => [f.sku, f.art])).toEqual([["U3", "ek_fehlt"], ["U1", "min_senken"], ["U2", "pruefen"]]);
    expect(r.unterMin[1].vorschlag).toBe("Min senken auf effektiven Min 100,00 € (jetzt 120,00 €)");
    expect(r.verlust.map((f) => [f.sku, f.art])).toEqual([["V2", "liquidation"], ["V1", "min_anheben"]]);
    expect(r.preisbewegung.map((f) => f.sku)).toEqual(["P1", "P2"]);
    expect(r.preisbewegung[1].vorschlag).toBe("613 Erhöhungen bei Below Min 100 % – BQool-Regel prüfen");
  });
  it("Buy-Box-Zeile, Wochen, Zeitraum", () => {
    expect(buyboxZeile([{ land: "ES", anteil: 53 }, { land: "DE", anteil: 29.4 }, { land: "FR", anteil: null }])).toBe("Buy Box DE 29 %, ES 53 %");
    expect(buyboxZeile([])).toBeNull();
    expect(isoWoche("2026-11-07")).toBe("2026-W45");
    expect(isoWoche("2027-01-01")).toBe("2026-W53");
    expect(buyboxWochen([{ land: "DE", stichtag: "2026-11-02", anteil: 20 }, { land: "DE", stichtag: "2026-11-07", anteil: 29 }, { land: "DE", stichtag: "2026-10-30", anteil: 25 }])).toEqual([{ woche: "2026-W45", je: { DE: 29 } }, { woche: "2026-W44", je: { DE: 25 } }]);
    expect(zeitraumAus("Listing_Performance_30 Tage")).toBe(30);
    expect(zeitraumAus(null)).toBe(7);
  });
  it("Morgenbericht: Buy-Box-Zeile hinter der BQool-Upload-Zeile", async () => {
    const { morgenText } = await import("@/lib/push/logic");
    expect(morgenText({ ueberNacht: 0, fristen: 1, wichtig: 0, paletten: 0, bqool: "BQool-Upload wartet auf Freigabe (DE 2)", buybox: "Buy Box DE 30 %, FR 40 %" })).toBe("BQool-Upload wartet auf Freigabe (DE 2) · Buy Box DE 30 %, FR 40 % · 1 Frist heute.");
  });
});
