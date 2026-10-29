import { describe, expect, it } from "vitest";
import { b2bSummen, gewinnJeStueck, leseBusinessReport, leseSalesTrafficB2b, mindestPreis, staffelPatch, staffelUploadDatei, staffelVorschlag } from "@/lib/amazon-business/logic";

// Amazon Business: B2B-Werte lesen, Staffelpreise mit Gewinnprüfung, Upload-Datei. Erfundene Werte und ASINs.

describe("B2B-Werte lesen", () => {
  it("Sales and Traffic (SP-API) mit B2B-Feldern", () => {
    const r = leseSalesTrafficB2b({
      reportSpecification: { dataStartTime: "2026-09-29", dataEndTime: "2026-10-28T00:00:00Z", marketplaceIds: ["A1PA6795UKMFR9"] },
      salesAndTrafficByAsin: [
        { childAsin: "B0TEST0001", sku: "TEST-1", salesByAsin: { unitsOrdered: 20, unitsOrderedB2B: 4, orderedProductSales: { amount: 399.8 }, orderedProductSalesB2B: { amount: 75.123 } }, trafficByAsin: { sessions: 300, sessionsB2B: 40, buyBoxPercentage: 90, buyBoxPercentageB2B: 80 } },
      ],
    });
    expect(r).toMatchObject({ land: "DE", von: "2026-09-29", bis: "2026-10-28" });
    expect(r.zeilen[0]).toEqual({ asin: "B0TEST0001", sku: "TEST-1", titel: null, sitzungen: 300, sitzungenB2b: 40, einheiten: 20, einheitenB2b: 4, umsatz: 399.8, umsatzB2b: 75.12, buybox: 90, buyboxB2b: 80 });
  });

  it("Geschäftsbericht (CSV, deutsch) mit B2B-Spalten", () => {
    const headers = ["(Übergeordnete) ASIN", "(Untergeordnete) ASIN", "Titel", "SKU", "Sitzungen – Summe", "Sitzungen – Summe – B2B", "Prozentsatz an Empfohlenes Angebot (Buy Box)", "Prozentsatz an Empfohlenes Angebot (Buy Box) – B2B", "Bestellte Einheiten", "Bestellte Einheiten – B2B", "Umsatz bestellter Produkte", "Umsatz bestellter Produkte – B2B"];
    const r = leseBusinessReport(headers, [["B0TESTPAR1", "B0TEST0001", "Testtopf", "TEST-1", "1.200", "150", "95,5 %", "88 %", "60", "12", "1.199,40 €", "239,88 €"], ["", "kaputt", "", "", "", "", "", "", "", "", "", ""]]);
    expect(r.fehler).toBeNull();
    expect(r.zeilen).toEqual([{ asin: "B0TEST0001", sku: "TEST-1", titel: "Testtopf", sitzungen: 1200, sitzungenB2b: 150, einheiten: 60, einheitenB2b: 12, umsatz: 1199.4, umsatzB2b: 239.88, buybox: 95.5, buyboxB2b: 88 }]);
  });

  it("ohne B2B-Spalten → verständlicher Fehler", () => {
    const r = leseBusinessReport(["(Untergeordnete) ASIN", "Sitzungen – Summe"], [["B0TEST0001", "5"]]);
    expect(r.fehler).toContain("Keine B2B-Spalten");
  });

  it("Summen: Anteil B2B, Buy Box gewichtet mit B2B-Sitzungen", () => {
    const z = (umsatz: number, umsatzB2b: number, sitzungenB2b: number, buyboxB2b: number | null, einheitenB2b = 1) => ({ asin: "B0TEST0001", sku: null, titel: null, sitzungen: null, sitzungenB2b, einheiten: null, einheitenB2b, umsatz, umsatzB2b, buybox: null, buyboxB2b });
    const s = b2bSummen([z(1000, 100, 30, 90, 3), z(500, 25, 10, 50, 1)]);
    expect(s).toMatchObject({ umsatz: 1500, umsatzB2b: 125, anteilProzent: 8.3, sitzungenB2b: 40, buyboxB2b: 80, einheitenB2b: 4, kaufquoteB2b: 10 });
  });
});

describe("Staffelpreise mit Gewinnprüfung", () => {
  const k = { ek: 8, fba: 3.5, provision: 0.15, mwst: 0.19 };
  it("Gewinn je Stück und Mindestpreis", () => {
    // 19,99 / 1,19 = 16,80 − 3,00 − 8 − 3,5 = 2,30
    expect(gewinnJeStueck(19.99, k)).toBe(2.3);
    // (8 + 3,5 + 1) / (1/1,19 − 0,15) = 12,5 / 0,69034 = 18,11 (aufgerundet)
    expect(mindestPreis(k, 1)).toBe(18.11);
  });
  it("Rabatte 3/5/8 % – nie unter Mindestpreis; Stufe, die nicht günstiger wird, entfällt", () => {
    const v = staffelVorschlag(19.99, k);
    expect(v.mindestPreis).toBe(18.11);
    expect(v.stufen.map((s) => [s.ab, s.preis, s.ok])).toEqual([
      [3, 19.39, true],
      [10, 18.99, true],
      [25, 18.39, true],
    ]);
    const eng = staffelVorschlag(18.5, k);
    expect(eng.stufen.map((s) => [s.ab, s.preis, s.ok])).toEqual([
      [3, 18.11, true],
      [10, 18.11, false],
      [25, 18.11, false],
    ]);
    expect(eng.stufen[0].hinweis).toContain("Mindestpreis");
    expect(eng.stufen.every((s) => s.gewinn >= 1)).toBe(true);
  });
  it("ohne EK keine Vorschläge", () => {
    expect(staffelVorschlag(19.99, { ...k, ek: null }).fehler).toContain("EK fehlt");
  });
});

describe("Upload-Datei und Schnittstelle", () => {
  it("Tabulator-Datei mit Business-Preis und festen Staffelpreisen (nur gültige Stufen)", () => {
    const t = staffelUploadDatei([{ sku: "TEST-1", businessPreis: 19.99, stufen: [{ ab: 3, preis: 19.39, ok: true }, { ab: 10, preis: 19.39, ok: false }] }]);
    const [kopf, zeile] = t.split("\r\n");
    expect(kopf.split("\t").slice(0, 5)).toEqual(["sku", "business-price", "quantity-price-type", "quantity-lower-bound1", "quantity-price1"]);
    expect(zeile.split("\t").slice(0, 7)).toEqual(["TEST-1", "19.99", "fixed", "3", "19.39", "", ""]);
  });
  it("Listings-Patch: B2B-Angebot mit Mengenrabatten", () => {
    const p = staffelPatch("A1PA6795UKMFR9", 19.99, [{ ab: 3, preis: 19.39, ok: true }, { ab: 10, preis: 18.99, ok: true }]);
    expect(p[0].value[0]).toMatchObject({ audience: "B2B", our_price: [{ schedule: [{ value_with_tax: 19.99 }] }], quantity_discount_plan: [{ schedule: [{ discount_type: "fixed", levels: [{ lower_bound: 3, value: 19.39 }, { lower_bound: 10, value: 18.99 }] }] }] });
  });
});

describe("Zeitraum wählen", () => {
  const p = (land: string, von: string, bis: string) => ({ land, von, bis, quelle: "api", abgerufenAm: new Date(0) });
  const alle = [p("DE", "2026-09-29", "2026-10-28"), p("DE", "2026-09-01", "2026-09-30"), p("FR", "2026-09-29", "2026-10-28")];
  it("letzte je Land, Monat, genauer Zeitraum, Land-Filter", async () => {
    const { waehlePerioden } = await import("@/lib/amazon-business/logic");
    expect(waehlePerioden(alle, undefined).map((x) => `${x.land}:${x.bis}`)).toEqual(["DE:2026-10-28", "FR:2026-10-28"]);
    expect(waehlePerioden(alle, "2026-09").map((x) => `${x.land}:${x.bis}`)).toEqual(["DE:2026-09-30"]);
    expect(waehlePerioden(alle, "2026-09-01:2026-09-30", "DE")).toHaveLength(1);
    expect(waehlePerioden(alle, undefined, "FR").map((x) => x.land)).toEqual(["FR"]);
  });
});
