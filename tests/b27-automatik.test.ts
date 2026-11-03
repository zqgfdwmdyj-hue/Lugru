import { describe, expect, it } from "vitest";
import { aoFormatSuchen, einkaeufeAus, kopfzeile, hatEinkaufSpalten, kurzFehler, lagerbestandAus, laufZeilen, spaltenNamen } from "@/lib/arbitrageone/logic";
import { parseArbitrageOne, readSheet } from "@/lib/imports/arbitrageone";
import { isNotWarmed } from "@/lib/sellerboard/warm";

// Nachtrag B27 (03.11.): nächtliche Automatik. Erfundene ASINs/SKUs.
const enc = (s: string) => new TextEncoder().encode(s);

describe("B27.1 ArbitrageOne-Exporte mit Titelzeilen und anderen Spaltennamen", () => {
  it("PurchaseOrders als HTML-.xls mit Titelzeile: Kopfzeile gefunden, Einkäufe gelesen", () => {
    const html = `<html><body><table>
      <tr><td>Bestellungen Export 03.11.2026</td></tr>
      <tr><td></td></tr>
      <tr><th>Bestellnummer</th><th>Bestelldatum</th><th>Lieferant</th><th>ASIN</th><th>SKU</th><th>Titel</th><th>Bestellmenge</th><th>Einzelpreis netto</th></tr>
      <tr><td>PO-1</td><td>02.11.2026</td><td>Testshop</td><td>B0TEST0001</td><td>T-SKU-1</td><td>Testartikel</td><td>3</td><td>12,50</td></tr>
    </table></body></html>`;
    const t = readSheet(enc(html));
    expect(kopfzeile(t, hatEinkaufSpalten)).toBeGreaterThan(0);
    expect(aoFormatSuchen(t)?.format).toBe("einkaeufe");
    const e = einkaeufeAus(t);
    expect(e.zeilen).toEqual([expect.objectContaining({ asin: "B0TEST0001", sku: "T-SKU-1", kaufdatum: "2026-11-02", menge: 3, ekNetto: 12.5, lieferant: "Testshop", rechnung: "PO-1" })]);
    // EK je SKU (Vorschau) über denselben Weg
    expect(parseArbitrageOne(t).rows).toEqual([expect.objectContaining({ asin: "B0TEST0001", sku: "T-SKU-1", costNet: 12.5 })]);
  });
  it("englische Spaltennamen (Order Date, Quantity Ordered, Unit Price)", () => {
    const t = [["Purchase Orders"], ["PO Number", "Order Date", "ASIN", "Seller SKU", "Quantity Ordered", "Unit Price"], ["PO-2", "2026-11-01", "B0TEST0002", "T-SKU-2", "2", "5.00"]];
    expect(einkaeufeAus(t).zeilen[0]).toMatchObject({ asin: "B0TEST0002", menge: 2, ekNetto: 5 });
  });
  it("Lagerbestand mit Titelzeile und Spalte „Menge“ statt „Bestand“", () => {
    const t = [["Lagerbestand Stichtag 03.11.2026"], [], ["ASIN", "SKU", "Titel", "Menge", "EK netto"], ["B0TEST0003", "T-SKU-3", "Test", 4, "2,50"]];
    const l = lagerbestandAus(t, "Lagerbestand_2026-11-03.xlsx", "2026-11-03");
    expect(l.stichtag).toBe("2026-11-03");
    expect(l.zeilen).toEqual([expect.objectContaining({ asin: "B0TEST0003", sku: "T-SKU-3", menge: 4, ekNetto: 2.5, wert: 10 })]);
  });
  it("unbekanntes Format: Fehlermeldung nennt die gefundenen Spalten (nur Namen)", () => {
    const t = [["Export"], ["Foo", "Bar", "Baz"], ["1", "2", "3"]];
    expect(spaltenNamen(t)).toEqual(["Foo", "Bar", "Baz"]);
    expect(() => parseArbitrageOne(t)).toThrow(/Gefundene Spalten: Foo, Bar, Baz/);
  });
});

describe("B27.2/B27.6 Lauf-Ergebnis lesbar", () => {
  it("Playwright-Zeitüberschreitung → kurzer Text ohne Protokoll", () => {
    const roh = 'page.waitForEvent: Timeout 120000ms exceeded while waiting for event "download"\n=========================== logs ===========================\nwaiting for event "download"\n============================================================';
    expect(kurzFehler(roh)).toBe("keine Datei nach 120 s");
    expect(kurzFehler("Export „BQool“: nach dem Klick kam weder eine Datei noch ein Dialog.\nCall log:\n  - x")).toBe("Export „BQool“: nach dem Klick kam weder eine Datei noch ein Dialog.");
  });
  it("je Export eine Zeile: Name · Status · Kurztext · Bildschirmfoto", () => {
    expect(laufZeilen([
      { titel: "Einkäufe", ok: true, text: "Einkäufe: 3 neu" },
      { titel: "BQool", ok: false, text: "keine Datei nach 300 s", bild: "/import/debug/x.png" },
      { titel: "Sellerboard", ok: true, uebersprungen: true, text: "übersprungen (nicht eingerichtet)" },
    ])).toEqual(["Einkäufe · ok · Einkäufe: 3 neu", "BQool · Fehler · keine Datei nach 300 s · Bildschirmfoto /import/debug/x.png", "Sellerboard · übersprungen · übersprungen (nicht eingerichtet)"]);
  });
});

describe("B27.4 sellerboard: abgelaufener Zeitraum wird erkannt", () => {
  it("NOT_WARMED und „warmed data … expired … call dashboard_period again“", () => {
    expect(isNotWarmed(new Error("sellerboard (dashboard_table): NOT_WARMED"))).toBe(true);
    expect(isNotWarmed(new Error("sellerboard (dashboard_table): The warmed data for this period expired part-way through your pull, before page 4 could be read. Call dashboard_period again with the SAME arguments"))).toBe(true);
    expect(isNotWarmed(new Error("sellerboard antwortet nicht (HTTP 503)."))).toBe(false);
  });
});
