// B33 BQool-Formel, Regel-Katalog je Land, Min-Reset, Nachkontrolle, Processing Report – reine Logik. Erfundene Werte
// (die 20 Eichzeilen aus dem Auftrag stehen nicht im Repo).
import { describe, expect, it } from "vitest";
import {
  bqoolMarge,
  bqoolPreisFuerMarge,
  breakEvenMin,
  effektiverMin,
  gebuehrenFuerLand,
  KATALOG_STANDARD,
  katalogRegel,
  minEntscheidung,
  provisionFuer,
  PROVISION_STAFFELN_STANDARD,
  satzRunden,
  schnelldreherRegel,
  setztMinZurueck,
  staffelAlsText,
  staffelAusText,
  staffelFuer,
  stufenText,
  UST,
  vergleiche,
  type ExportZeile,
} from "@/lib/bqool/export-logic";
import { gebuehrenAusListing } from "@/lib/bqool/logic";
import { bqoolZeit, nachkontrolle, processingReportZeilen, uploadFehlerText, versatzMinuten } from "@/lib/bqool/kreislauf-logic";
import { befundePruefen, type CheckEingabe } from "@/lib/bqool/listing-check-logic";
import { bqoolAbleiten } from "@/lib/automatik/bqool-logic";
import { landAusStore, parseFees } from "@/lib/reports/amazon";

describe("B33.1 BQool-Formel", () => {
  const de = { cost: 11.9, fba: 3.5, ust: UST.DE, provision: 0.15 };
  it("P(m) = (F + C/(1+v)) / (1/(1+v) − r − m), kaufmännisch auf den Cent", () => {
    // (3,5 + 11,9/1,19) / (1/1,19 − 0,15 − 0,10) = 13,5 / 0,590336 = 22,868 → 22,87
    expect(bqoolPreisFuerMarge({ ...de, margeProzent: 10 })).toBe(22.87);
    // IT: (3,5 + 11,9/1,22) / (1/1,22 − 0,25) = 13,2541 / 0,569672 = 23,266 → 23,27
    expect(bqoolPreisFuerMarge({ ...de, ust: UST.IT, margeProzent: 10 })).toBe(23.27);
    expect(bqoolPreisFuerMarge({ ...de, provision: 0.6, margeProzent: 30 })).toBeNull();
  });
  it("Marge = Est. Profit / P – Umkehrung von P(m) (< 0,1 Prozentpunkte)", () => {
    const p = bqoolPreisFuerMarge({ ...de, margeProzent: 10 })!;
    expect(Math.abs(bqoolMarge({ ...de, preis: p })! - 10)).toBeLessThan(0.1);
    expect(bqoolMarge({ ...de, preis: 18 })!).toBeLessThan(0);
    expect(bqoolMarge({ ...de, preis: 0 })).toBeNull();
  });
  it("Cost ist brutto (Datei-Konvention) und wird mit der USt des Landes geteilt; Additional Cost geht nicht ein", () => {
    // Bei DE gleich dem Break-even mit EK netto 10, ohne Fix/Zusatz
    expect(bqoolPreisFuerMarge({ ...de, margeProzent: 0 })).toBe(breakEvenMin({ ek: 10, fba: 3.5, fix: 0, zusatz: 0, ust: UST.DE, provision: 0.15, margeProzent: 0 }));
  });
  it("Provision mit Preisstufen: kleinster Preis, der die Marge erreicht (Beauty bis 10 € 8 %)", () => {
    const beauty = PROVISION_STAFFELN_STANDARD[0].stufen;
    const it_ = { cost: 2.4, fba: 3, ust: UST.IT };
    // K = 3 + 2,4/1,22 = 4,9672 → 8 %: 4,9672 / 0,639672 = 7,77 (≤ 10 €)
    expect(bqoolPreisFuerMarge({ ...it_, provision: beauty, margeProzent: 10 })).toBe(7.77);
    expect(bqoolPreisFuerMarge({ ...it_, provision: 0.15, margeProzent: 10 })).toBe(8.72);
    // K = 7: mit 8 % wären es 10,94 (> 10 €) → Stufe 15 %: 7 / 0,569672 = 12,29
    expect(bqoolPreisFuerMarge({ cost: 0, fba: 7, ust: UST.IT, provision: beauty, margeProzent: 10 })).toBe(12.29);
    expect(bqoolMarge({ ...it_, provision: beauty, preis: 7.77 })!).toBeCloseTo(10, 0);
  });
  it("Satz aus Betrag/Preis: 0,5-%-Schritte bei Cent-Rundung, sonst 4 Stellen", () => {
    expect(satzRunden(1.61 / 10.74)).toBe(0.15);
    expect(satzRunden(4.57 / 65.34)).toBe(0.07);
    expect(satzRunden(0.0782)).toBe(0.0782);
  });
  it("Preisstufen nur, wenn die Kategorie passt und der beobachtete Satz zum Preis passt", () => {
    expect(provisionFuer({ satz: 0.15, preis: 12, kategorie: "Beauty" })).toEqual(PROVISION_STAFFELN_STANDARD[0].stufen);
    expect(provisionFuer({ satz: 0.15, preis: 8, kategorie: "Beauty" })).toBe(0.15);
    expect(provisionFuer({ satz: 0.07, preis: 80, kategorie: "Electronics" })).toBe(0.07);
    expect(provisionFuer({ satz: 0.15, preis: 30, kategorie: null })).toBe(0.15);
  });
  it("Gebühren je Land: BQool-Liste vor Amazon vor Produkt; außerhalb DE ist der Produktwert geschätzt", () => {
    const produkt = { fba: 3.2, satz: 0.15 };
    expect(gebuehrenFuerLand({ land: "FR", bqool: { fba: 5.9, satz: 0.15, preis: 30, kategorie: null }, amazon: { fba: 5.5, satz: 0.15, preis: 30, kategorie: null }, produkt })).toMatchObject({ fba: 5.9, quelle: "bqool", geschaetzt: false });
    expect(gebuehrenFuerLand({ land: "IT", amazon: { fba: 5.4, satz: 0.07, preis: 90, kategorie: "Electronics" }, produkt })).toMatchObject({ fba: 5.4, satz: 0.07, provision: 0.07, quelle: "amazon", geschaetzt: false });
    expect(gebuehrenFuerLand({ land: "ES", produkt })).toMatchObject({ fba: 3.2, quelle: "produkt", geschaetzt: true });
    expect(gebuehrenFuerLand({ land: "DE", produkt })).toMatchObject({ quelle: "produkt", geschaetzt: false });
    expect(gebuehrenFuerLand({ land: "DE", produkt: { ...produkt, geschaetzt: true } }).geschaetzt).toBe(true);
  });
  it("BQool-Liste: Referral-/FBA-Spalten am Namen erkannt (Betrag oder Satz), Kategorie", () => {
    expect(gebuehrenAusListing({ "Referral Fee": "3.00", "FBA Fee": "4.10", Cost: "11.90" }, 20)).toEqual({ fba: 4.1, satz: 0.15, kategorie: null });
    expect(gebuehrenAusListing({ "Referral Fee %": "15%", "Fulfillment Fee": "5,99", Category: "Beauty" }, null)).toEqual({ fba: 5.99, satz: 0.15, kategorie: "Beauty" });
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

describe("B33.2/B33.3 Katalog je Land und Min-Reset", () => {
  const formel = { cost: 11.9, fba: 3.5, ust: UST.DE, provision: 0.15, untergrenze: null };
  it("Stufen laut BQool 08.11. (ia, Abverkauf je Land, Regel-IDs)", () => {
    const ia = katalogRegel(KATALOG_STANDARD, "ia")!;
    expect(staffelFuer(ia, "DE")!.map((x) => x.marge)).toEqual([10, 8, 7, 5, 3, 1, 0]);
    expect(staffelFuer(ia, "DE")![0].bedingung).toBe("Available ≥ 1");
    expect(staffelFuer(ia, "FR")!.map((x) => (x.typ === "lowest_price" ? `LP+${x.aufschlag}` : x.marge))).toEqual([11, 8, "LP+6", 4, 3, 1, 0]);
    expect(staffelFuer(ia, "IT")![0]).toMatchObject({ typ: "lowest_price", aufschlag: 11, bedingung: "Inbound ≥ 0" });
    expect(staffelFuer(ia, "ES")!.map((x) => x.marge)).toEqual([11, 8, 5, 4, 3, 1, 0]);
    expect(staffelFuer(katalogRegel(KATALOG_STANDARD, "Abverkauf DE"), "DE")!.map((x) => x.marge)).toEqual([5, 4, 3, 1, 0, 1, 0]);
    const abv = katalogRegel(KATALOG_STANDARD, "Abverkauf")!;
    expect(staffelFuer(abv, "FR")!.map((x) => x.typ ?? "marge")).toEqual(["marge", "marge", "lowest_price", "marge", "sales_maximizer", "marge", "marge"]);
    expect(staffelFuer(abv, "FR")![3]).toMatchObject({ marge: 1, strategie: "Profit Booster" });
    expect(staffelFuer(abv, "ES")![4].typ).toBe("sales_maximizer");
    expect(ia.bqoolIds).toEqual({ DE: 37, FR: 39, IT: 40, ES: 38 });
    expect(katalogRegel(KATALOG_STANDARD, "Liquidation")!.bqoolIds).toEqual({ DE: 43, ES: 44, FR: 45, IT: 46 });
  });
  it("Stufen ohne feste Marge: keine Prozentzahl, kein Min", () => {
    const ia = katalogRegel(KATALOG_STANDARD, "ia")!;
    expect(stufenText(staffelFuer(ia, "FR")![2])).toMatch(/Lowest Price \+ 6 %“ – keine feste Marge/);
    expect(stufenText(staffelFuer(katalogRegel(KATALOG_STANDARD, "Abverkauf"), "IT")![4])).toBe("Sales Maximizer – keine feste Marge");
    expect(stufenText(staffelFuer(ia, "DE")![0])).toBe("10 % (Available ≥ 1)");
    expect(effektiverMin({ ...formel, regel: ia, land: "FR", alterTage: 70 })).toMatchObject({ min: null, art: "wettbewerb" });
  });
  it("Margen-Reset: ia/Abverkauf ja, Liquidation/mbb nein", () => {
    expect(setztMinZurueck(katalogRegel(KATALOG_STANDARD, "ia"))).toBe(true);
    expect(setztMinZurueck(katalogRegel(KATALOG_STANDARD, "Abverkauf"))).toBe(true);
    expect(setztMinZurueck(katalogRegel(KATALOG_STANDARD, "Liquidation"))).toBe(false);
    expect(setztMinZurueck(katalogRegel(KATALOG_STANDARD, "mbb"))).toBe(false);
    // gespeicherter alter Katalog ohne Feld: Margen-Regel setzt zurück
    expect(setztMinZurueck({ name: "alt", laender: null, strategie: "", staffel: [{ bisTage: null, marge: 3 }], festeUntergrenze: false, risiko: false, hinweis: "" })).toBe(true);
  });
  it("Staffel als Text und zurück (LP+x, SM, PB, Bedingung)", () => {
    const st = staffelFuer(katalogRegel(KATALOG_STANDARD, "Abverkauf"), "FR")!;
    const t = staffelAlsText(st);
    expect(t).toBe("30:5 SB, 60:4 SB, 90:LP+3, 180:1 SB PB, 270:SM, 365:1 SB, :0 SB");
    expect(staffelAusText(t)).toEqual(st);
    expect(staffelAusText("30:10 SB [Available ≥ 1], 90:LP+6 SM, :0")).toEqual([
      { bisTage: 30, marge: 10, unterregel: "Sales Booster", bedingung: "Available ≥ 1" },
      { bisTage: 90, marge: 0, typ: "lowest_price", aufschlag: 6, strategie: "Sales Maximizer" },
      { bisTage: null, marge: 0 },
    ]);
    expect(staffelAusText("  ")).toBeNull();
  });
  it("„nur Änderungen“: reine Min-Abweichung bei Reset-Regel ist keine Änderung", () => {
    const z = (sku: string, min: number): ExportZeile => ({ land: "DE", sku, cost: 10, zusatz: 0, regel: "ia", min, max: 50 });
    const ist = new Map([
      ["A", { regel: "ia", min: 20, max: 50 }],
      ["B", { regel: "ia", min: null, max: 50 }],
      ["C", { regel: "ia", min: 20, max: 40 }],
    ]);
    const v = vergleiche([z("A", 22), z("B", 22), z("C", 22)], ist, { minZaehlt: () => false });
    expect(v.map((x) => x.art)).toEqual(["gleich", "geaendert", "geaendert"]);
    expect(vergleiche([z("A", 22)], ist).map((x) => x.art)).toEqual(["geaendert"]);
  });
});

describe("B33.4 Frischbestand-Falle", () => {
  const basis: CheckEingabe = { land: "DE", sku: "TEST-SKU-FB", asin: "B0TESTFB01", titel: "Test", bestand: 10, status: "aktiv", minBqool: 30, maxBqool: 60, preis: 30, buybox: 26, bb30: 26, rang: 5000, monatlichVerkauft: 30, verkaeufe7: 0, verkaeufe30: 0, bbUeberMaxTage: 0, ohneBuyboxTage: 7, breakEven: 22, effMin: 30, zielMin: 30, liquidationFreigegeben: false, gebrauchtMitNeupreisMin: false, schnelldreher: false, schnelldreherKandidat: false, reichweite: 30, lagerdauer: 12, kapital: 200, verkaufspreisMedian: null, verkaufspreisAnzahl: 0, istRegel: "ia", istMinReset: true, stufeText: "10 % (Available ≥ 1)" };
  it("Stufe 0–30, Min über Buy Box, 7 Tage kein Verkauf → Hinweis mit Regelwechsel statt Min-Upload", () => {
    const b = befundePruefen(basis).find((x) => x.nr === 11)!;
    expect(b.titel).toBe("Frischbestand-Falle");
    expect(b.aktion).toBe("hinweis");
    expect(b.vorschlag).toMatch(/„ia“ setzt den Min täglich .* 0–30 \(10 % \(Available ≥ 1\)\).*Regel wechseln/);
    // Befund 1 nennt den Regelwechsel als einzigen Weg
    expect(befundePruefen(basis).find((x) => x.nr === 1)!.vorschlag).toMatch(/nur über Regelwechsel auf Liquidation/);
  });
  it("nicht bei Verkauf in 7 Tagen, älterer Ware oder Min unter Buy Box", () => {
    expect(befundePruefen({ ...basis, verkaeufe7: 1 }).some((x) => x.nr === 11)).toBe(false);
    expect(befundePruefen({ ...basis, lagerdauer: 45 }).some((x) => x.nr === 11)).toBe(false);
    expect(befundePruefen({ ...basis, minBqool: 25 }).some((x) => x.nr === 11)).toBe(false);
    expect(befundePruefen({ ...basis, verkaeufe7: null }).some((x) => x.nr === 11)).toBe(false);
  });
});

describe("B33.5 Schnelldreher", () => {
  it("Variante 2/3: Regel „Schnelldreher“ = alle Stufen 7 %, mit bzw. ohne Min-Reset", () => {
    const r = schnelldreherRegel("Schnelldreher", 7);
    expect(r.staffel!.every((x) => x.marge === 7)).toBe(true);
    expect(setztMinZurueck(r)).toBe(true);
    expect(setztMinZurueck(schnelldreherRegel("Schnelldreher Test", 7, false))).toBe(false);
  });
  it("Variante 1: Liquidation ohne festen Min → Min = Boden P(7 %)", () => {
    const liq = katalogRegel(KATALOG_STANDARD, "Liquidation");
    const e = minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: null, effMin: null, breakEven: 20, liquidation: "Liquidation", boden: 21.5, schnelldreher: true });
    expect(e).toMatchObject({ art: "liquidation", min: 21.5 });
    expect(minEntscheidung({ regelName: "Liquidation", regel: liq, gewuenscht: 23, effMin: null, breakEven: 20, liquidation: "Liquidation", boden: 21.5, schnelldreher: true }).min).toBe(23);
  });
});

describe("B33.6 Nachkontrolle, Processing Report, BQool-Zeit", () => {
  it("Min vorher/Datei/nachher; Reset-Regel = Hinweis, Liquidation = Fehler", () => {
    const k = nachkontrolle(
      [
        { land: "DE", sku: "A", regel: "ia", min: 20, minVorher: 25, minReset: true },
        { land: "DE", sku: "B", regel: "Liquidation", min: 18, minVorher: 19, minReset: false },
        { land: "FR", sku: "C", regel: "ia", min: 30, minVorher: 31, minReset: true },
      ],
      new Map([
        ["DE|A", { regel: "ia", min: 24.4 }],
        ["DE|B", { regel: "Liquidation", min: 19 }],
        ["FR|C", { regel: "ia", min: 30 }],
      ]),
    );
    expect(k.abweichungen).toEqual([{ land: "DE", sku: "B", text: "Min vorher 19,00 / Datei 18,00 / nachher 19,00 – Min hätte stehen bleiben müssen" }]);
    expect(k.hinweise).toEqual([{ land: "DE", sku: "A", text: "Min vorher 25,00 / Datei 20,00 / nachher 24,40 – Min wird täglich zurückgesetzt – kein Fehler" }]);
    expect(k.minVergleich!.map((m) => m.status)).toEqual(["reset", "fehler", "gleich"]);
    expect(k.text).toMatch(/1 Abweichung bei 3 SKUs.*1 SKU mit anderem Min bei Regel mit täglichem Reset – kein Fehler/);
  });
  it("Processing Report: Tab-Datei, HTML, Freitext", () => {
    expect(processingReportZeilen("Row\tSellerSKU\tStatus\tMessage\r\n3\tTEST-SKU-P1\tError\tInvalid Min Price\r\n")).toEqual([{ sku: "TEST-SKU-P1", text: "3 · TEST-SKU-P1 · Error · Invalid Min Price" }]);
    expect(processingReportZeilen("<table><tr><td>4</td><td>TEST-SKU-P2</td><td>Error: Max below Min</td></tr></table>", ["TEST-SKU-P2"])).toEqual([{ sku: "TEST-SKU-P2", text: "4 · TEST-SKU-P2 · Error: Max below Min" }]);
    expect(processingReportZeilen("Processing Report\n1 Error\nRow 5: SKU TEST-SKU-P3 – rule not found")).toEqual([{ sku: "TEST-SKU-P3", text: "Row 5: SKU TEST-SKU-P3 – rule not found" }]);
    expect(processingReportZeilen("All rows processed successfully")).toEqual([]);
  });
  it("BQool-Zeit UTC+02:00 → deutsche Zeit (November 1 Stunde früher)", () => {
    expect(bqoolZeit("11/07/2026 3:32 PM")).toEqual({ iso: "2026-11-07T13:32:00.000Z", berlin: "07.11., 14:32" });
    expect(bqoolZeit("11/07/2026 9:23 PM")!.berlin).toBe("07.11., 20:23");
    expect(bqoolZeit("2026-11-07 15:32")!.berlin).toBe("07.11., 14:32");
    expect(bqoolZeit("07.11.2026 15:32", versatzMinuten("+01:00"))!.berlin).toBe("07.11., 15:32");
    expect(bqoolZeit("gestern")).toBeNull();
    expect(versatzMinuten(undefined)).toBe(120);
  });
  it("Hinweistext je Upload mit Land, deutscher und BQool-Zeit und Fehlerzeile", () => {
    const z = bqoolZeit("11/07/2026 3:32 PM")!;
    expect(uploadFehlerText({ land: "DE", zeitBqool: "11/07/2026 3:32 PM", zeitDe: z.berlin, iso: z.iso, datei: "BQool_DE.txt", fehlerAnzahl: 1, zeilen: [{ sku: "TEST-SKU-P1", text: "3 · TEST-SKU-P1 · Error · Invalid Min Price" }] })).toBe("DE 07.11., 14:32 (BQool 11/07/2026 3:32 PM) BQool_DE.txt: 1 Fehler – TEST-SKU-P1: Error · Invalid Min Price");
  });
  it("Berichtsseiten mit locale=DE werden je Land abgeleitet", () => {
    expect(bqoolAbleiten("https://mc.bqool.example/reports?setApp=1&module=R&locale=DE", "FR")).toBe("https://mc.bqool.example/reports?setApp=1&module=R&locale=FR");
    expect(bqoolAbleiten("https://mc.bqool.example/repricing/amazonde", "ES")).toBe("https://mc.bqool.example/repricing/amazones");
  });
});
