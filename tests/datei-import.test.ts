import { describe, expect, it } from "vitest";
import { landUndZeitraumAus, sichererName, uploadPruefen } from "@/lib/datei-import/logic";
import { detectReport, parseStorageFees } from "@/lib/reports/amazon";
import { abrechnungAusTransaktionen, normMarktplatz, transaktionsAuswertung } from "@/lib/reports/transaktionen";
import { leseUstBerichtJePeriode, ossQuartal, umsatzJeSteuerland, ustZusammenfuehren } from "@/lib/buchhaltung/ust-bericht";
import { readTable } from "@/lib/tabular";

// Datei-Import (Bauauftrag): Upload-Prüfung, Land/Zeitraum, Amazon-Transaktionsbericht (Kopfzeilen, Übertrag =
// Auszahlung, Marktplatz), Lagergebühren, Umsatzsteuer je Periode und OSS. Alle Daten erfunden.

const enc = (s: string) => new TextEncoder().encode(s);

describe("Upload-Adresse", () => {
  const jetzt = new Date("2026-10-31T12:00:00Z");
  const gueltig = { gueltigBis: new Date("2026-10-31T12:10:00Z"), benutztAm: null };
  it("gültig, unbekannt, abgelaufen, benutzt, zu groß, leer", () => {
    expect(uploadPruefen(gueltig, { jetzt, groesse: 1000 })).toBeNull();
    expect(uploadPruefen(null, { jetzt, groesse: 1 })?.status).toBe(404);
    expect(uploadPruefen({ ...gueltig, gueltigBis: new Date("2026-10-31T11:59:00Z") }, { jetzt, groesse: 1 })).toMatchObject({ status: 410, code: "abgelaufen" });
    expect(uploadPruefen({ ...gueltig, benutztAm: jetzt }, { jetzt, groesse: 1 })).toMatchObject({ status: 410, code: "benutzt" });
    expect(uploadPruefen(gueltig, { jetzt, groesse: 51 * 1024 * 1024 })).toMatchObject({ status: 413, code: "zu_gross" });
    expect(uploadPruefen(gueltig, { jetzt, groesse: 0 })).toMatchObject({ status: 400, code: "leer" });
  });
  it("Dateiname ohne Pfad", () => {
    expect(sichererName("../../etc/passwd")).toBe("passwd");
    expect(sichererName("C:\\x\\Bericht.csv")).toBe("Bericht.csv");
  });
});

describe("Land und Zeitraum aus dem Hinweis", () => {
  it("verschiedene Schreibweisen", () => {
    expect(landUndZeitraumAus("DE, 01.10.–31.10.2026")).toEqual({ land: "DE", von: "2026-10-01", bis: "2026-10-31" });
    expect(landUndZeitraumAus("Marktplatz FR, Jan–Okt 2026")).toEqual({ land: "FR", von: "2026-01-01", bis: "2026-10-31" });
    expect(landUndZeitraumAus("IT 2026-02")).toEqual({ land: "IT", von: "2026-02-01", bis: "2026-02-28" });
    expect(landUndZeitraumAus("ES 2026-09-01 bis 2026-09-15")).toEqual({ land: "ES", von: "2026-09-01", bis: "2026-09-15" });
    expect(landUndZeitraumAus("irgendwas")).toEqual({ land: null, von: null, bis: null });
  });
});

// Erfundener Transaktionsbericht im deutschen Format: Hinweiszeilen, dann Kopf; Komma als Dezimaltrenner.
const KOPF = ["Datum/Uhrzeit", "Abrechnungsnummer", "Typ", "Bestellnummer", "SKU", "Beschreibung", "Menge", "Marketplace", "Versand", "Umsätze", "Produktumsatzsteuer", "Gutschrift für Versandkosten", "Rabatte aus Werbeaktionen", "Verkaufsgebühren", "Gebühren zu Versand durch Amazon", "Andere Transaktionsgebühren", "Andere", "Gesamt"];
const z = (...x: string[]) => x.map((v) => `"${v}"`).join(",");
const TX = [
  '"Enthält Amazon Marketplace, Versand durch Amazon und Amazon Marketplace Webservices-Transaktionen"',
  '"Alle Beträge in Euro, sofern nicht anders angegeben"',
  '"Definitionen:"',
  '"Umsatzsteuer für Verkäufe: erfundene Erklärung"',
  '"Verkaufsgebühren: erfundene Erklärung"',
  '"Gebühren zu Versand durch Amazon: erfundene Erklärung"',
  '"Andere Transaktionsgebühren: erfundene Erklärung"',
  '"Andere: erfundene Erklärung"',
  "",
  z(...KOPF),
  z("02.01.2026 08:00:00 UTC", "9001", "Bestellung", "302-0000000-0000001", "TEST-SKU-1", "Testsocken (erfunden)", "2", "amazon.de", "Versand durch Amazon", "20,00", "3,80", "0", "-1,00", "-3,00", "-4,50", "0", "0", "15,30"),
  z("03.01.2026 09:00:00 UTC", "9001", "Erstattung", "302-0000000-0000001", "TEST-SKU-1", "Testsocken (erfunden)", "1", "Amazon.de", "Versand durch Amazon", "-10,00", "-1,90", "0", "0", "1,20", "0", "0", "0", "-10,70"),
  z("05.01.2026 10:00:00 UTC", "9001", "Servicegebühr", "", "", "Abonnementgebühr", "", "", "", "0", "0", "0", "0", "0", "0", "-39,00", "0", "-39,00"),
  z("06.01.2026 10:00:00 UTC", "9001", "Anpassung", "", "TEST-SKU-1", "FBA Lagerbestand – Erstattung – Beschädigung: Lager", "1", "amazon.de", "", "0", "0", "0", "0", "0", "0", "0", "8,00", "8,00"),
  z("15.01.2026 11:00:00 UTC", "9001", "Übertrag", "", "", "An Bankkonto", "", "", "", "0", "0", "0", "0", "0", "0", "0", "-26,40", "-26,40"),
  z("16.01.2026 08:00:00 UTC", "9002", "Bestellung", "302-0000000-0000002", "TEST-SKU-2", "Testmütze (erfunden)", "1", "amazon.de", "Versand durch Amazon", "12,00", "2,28", "0", "0", "-1,80", "-3,10", "0", "0", "9,38"),
].join("\n");

describe("Amazon-Transaktionsbericht", () => {
  const t = readTable(enc(TX));
  it("Kopfzeilen übersprungen und als Transaktionsbericht erkannt", () => {
    expect(t.headers[0]).toBe("Datum/Uhrzeit");
    expect(detectReport(t)).toBe("transactions");
  });

  it("Auswertung: Zeitraum, Marktplatz vereinheitlicht, Abrechnungen, Summen je Typ, Übertrag = Auszahlung", () => {
    const a = transaktionsAuswertung(t);
    expect(a.zeilen).toBe(6);
    expect(a.abrechnungen).toBe(2);
    expect(a.zeitraum).toEqual({ von: "2026-01-02", bis: "2026-01-16" });
    expect(a.marktplaetze).toEqual(["amazon.de"]);
    expect(normMarktplatz("Amazon.de")).toBe("amazon.de");
    expect(a.summenJeTyp.find((x) => x.typ === "Bestellung")).toEqual({ typ: "Bestellung", anzahl: 2, summe: 24.68 });
    expect(a.auszahlungen).toEqual([{ datum: "2026-01-15", betrag: 26.4, abrechnung: "9001" }]);
    expect(a.warnungen.join(" ")).toContain("Nur ein Marktplatz");
    expect(a.warnungen.join(" ")).toContain("Übertrag");
  });

  it("abgeleitete Abrechnungszeilen ergeben je Zeile genau „Gesamt“, Übertrag ist keine Zeile, sondern Auszahlung", () => {
    const { abrechnungen, zeilen } = abrechnungAusTransaktionen(t, (typ, b) => /anpassung/i.test(typ) && /erstattung/i.test(b));
    const k1 = abrechnungen.find((k) => k.settlementId === "9001")!;
    expect(k1.totalAmount).toBe(26.4);
    expect(k1.depositDate?.toISOString()).toBe("2026-01-15T11:00:00.000Z");
    expect(abrechnungen.find((k) => k.settlementId === "9002")!.depositDate).toBeNull();
    const summe = (nr: string) => Math.round(zeilen.filter((x) => x.settlementId === nr).reduce((n, x) => n + x.amount, 0) * 100) / 100;
    expect(summe("9001")).toBe(Math.round((15.3 - 10.7 - 39 + 8) * 100) / 100);
    expect(summe("9002")).toBe(9.38);
    expect(zeilen.some((x) => x.transactionType === "Übertrag")).toBe(false);
    const principal = zeilen.find((x) => x.transactionType === "Order" && x.amountType === "ItemPrice" && x.amountDescription === "Principal" && x.sku === "TEST-SKU-1")!;
    expect(principal).toMatchObject({ amount: 20, quantity: 2, quelle: "transaktionen", fulfillmentId: "AFN" });
    expect(zeilen.find((x) => x.transactionType === "Anpassung")!.amountDescription).toMatch(/^Reimbursement/);
    // Gleiche Datei → gleiche Zeilen-Hashes (kein Doppelimport)
    expect(abrechnungAusTransaktionen(readTable(enc(TX)), () => false).zeilen.map((x) => x.rowHash)).toEqual(zeilen.map((x) => x.rowHash));
  });
});

describe("Lagergebühren je Monat", () => {
  const kopf = "asin,fnsku,product_name,fulfillment_center,country_code,longest_side,median_side,shortest_side,measurement_units,weight,weight_units,item_volume,volume_units,product_size_tier,average_quantity_on_hand,average_quantity_pending_removal,estimated_total_item_volume,month_of_charge,storage_utilization_ratio,storage_utilization_ratio_units,base_rate,utilization_surcharge_rate,avg_qty_for_sus,est_vol_for_sus,est_base_msf,est_sus,currency,estimated_monthly_storage_fee,category,eligible_for_inventory_discount,qualifies_for_inventory_discount,total_incentive_fee_amount,breakdown_incentive_fee_amount,average_quantity_customer_orders";
  const zeile = (asin: string, land: string, fee: string) => `${asin},X00TEST,Testartikel (erfunden),TST1,${land},10,5,2,centimeters,0.2,kilograms,0.0001,cubic meters,Standard,3.5,0,0.00035,2026-05,1.2,weeks,27.54,0,0,0,0.01,0,EUR,${fee},Testkategorie,N,N,0,,0`;
  it("erkannt und je ASIN/Land gelesen (Punkt als Dezimaltrenner)", () => {
    const t = readTable(enc([kopf, zeile("B0TESTLG01", "DE", "0.0347"), zeile("B0TESTLG01", "FR", "0.0123"), zeile("b0testlg02", "DE", "1.5")].join("\n")));
    expect(detectReport(t)).toBe("storageFees");
    const p = parseStorageFees(t);
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({ monat: "2026-05", asin: "B0TESTLG01", land: "DE", gebuehr: 0.0347, bestandSchnitt: 3.5, waehrung: "EUR" });
    expect(p[2].asin).toBe("B0TESTLG02");
  });
});

describe("Umsatzsteuer-Transaktionsbericht je Periode", () => {
  const kopf = ["UNIQUE_ACCOUNT_IDENTIFIER", "ACTIVITY_PERIOD", "SALES_CHANNEL", "MARKETPLACE", "PROGRAM_TYPE", "TRANSACTION_TYPE", "TRANSACTION_EVENT_ID", "TRANSACTION_COMPLETE_DATE", "SELLER_SKU", "ASIN", "QTY", "DEPARTURE_COUNTRY", "ARRIVAL_COUNTRY", "TAXABLE_JURISDICTION", "TAX_REPORTING_SCHEME", "TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL", "TOTAL_ACTIVITY_VALUE_VAT_AMT", "TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL", "PRICE_OF_ITEMS_VAT_RATE_PERCENT", "TRANSACTION_CURRENCY_CODE"];
  const r = (p: string, typ: string, datum: string, von: string, nach: string, land: string, schema: string, netto: string, ust: string, brutto: string, satz: string, qty = "1") => ["A1", p, "AFN", "amazon.de", "REGULAR", typ, "302-0000000-0000009", datum, "TEST-SKU", "B0TESTUST1", qty, von, nach, land, schema, netto, ust, brutto, satz, "EUR"].join("\t");
  const txt = [
    kopf.join("\t"),
    r("2026-JUL", "SALE", "03-07-2026", "DE", "DE", "DE", "REGULAR", "100.00", "19.00", "119.00", "0.19"),
    r("2026-JUL", "SALE", "04-07-2026", "DE", "AT", "AT", "UNION-OSS", "50.00", "10.00", "60.00", "0.20"),
    r("2026-JUL", "REFUND", "05-07-2026", "DE", "AT", "AT", "UNION-OSS", "-10.00", "-2.00", "-12.00", "0.20"),
    r("2026-JUL", "FC_TRANSFER", "06-07-2026", "DE", "PL", "", "", "0", "0", "0", "", "5"),
    r("2026-JUL", "INVOICE", "07-07-2026", "DE", "DE", "", "", "200.00", "38.00", "238.00", ""),
    r("2026-JUN", "SALE", "30-06-2026", "DE", "FR", "FR", "UNION-OSS", "20.00", "4.00", "24.00", "0.20"),
  ].join("\n");

  it("Zeilen anderer Perioden gehören zur Periode der Zeile; Verbringungen, INVOICE ohne Steuerland getrennt", () => {
    const p = leseUstBerichtJePeriode(enc(txt));
    expect(p.map((x) => [x.monat, x.zeilen])).toEqual([["2026-06", 1], ["2026-07", 5]]);
    const jul = p.find((x) => x.monat === "2026-07")!.auswertung;
    expect(jul.periode).toBe("2026-07");
    expect(jul.transfers).toEqual([{ von: "DE", nach: "PL", netto: 0, anzahl: 1, stueck: 5 }]);
    expect(jul.ohneSteuerland).toEqual([{ vorgang: "INVOICE", netto: 200, ust: 38, brutto: 238, anzahl: 1 }]);
    expect(jul.jeTyp).toMatchObject({ SALE: 2, REFUND: 1, FC_TRANSFER: 1, INVOICE: 1 });
    const laender = umsatzJeSteuerland(jul);
    expect(laender.find((l) => l.land === "DE")).toMatchObject({ netto: 100, ust: 19, brutto: 119, oss: 0, lokal: 100 });
    expect(laender.find((l) => l.land === "AT")).toMatchObject({ netto: 40, brutto: 48, oss: 40 });
    // INVOICE nicht im Umsatz
    expect(laender.reduce((n, l) => n + l.brutto, 0)).toBe(167);
  });

  it("OSS je Quartal und Zusammenführen mehrerer Dateien", () => {
    const p = leseUstBerichtJePeriode(enc(txt));
    const oss = ossQuartal(p.map((x) => x.auswertung));
    expect(oss).toEqual([
      { land: "AT", satz: 0.2, netto: 40, ust: 8, anzahl: 2 },
      { land: "FR", satz: 0.2, netto: 20, ust: 4, anzahl: 1 },
    ]);
    const jun = p.find((x) => x.monat === "2026-06")!.auswertung;
    const doppelt = ustZusammenfuehren([jun, jun]);
    expect(umsatzJeSteuerland(doppelt).find((l) => l.land === "FR")!.netto).toBe(40);
  });
});
