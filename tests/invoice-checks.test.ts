import { describe, expect, it } from "vitest";
import { bookedAmount, detectDocType, extractInvoiceDate, findDuplicates, readDate, type DupRow } from "@/lib/invoices/checks";

// Rechnungsprüfung: Datum, Belegart, Duplikate. Fiktive Belege.

describe("Rechnungsdatum", () => {
  it("der gemeldete Fall: 12/01/2026 ist der 12. Januar, nicht der 1. Dezember", () => {
    const r = extractInvoiceDate("Invoice date: 12/01/2026\nTotal 19,99 €", "2026-01-12");
    expect(r).toEqual({ date: "2026-01-12", source: "text" });
  });
  it("ohne Dateiname: europäisch lesen, aber als unsicher markieren (mit der anderen Lesart)", () => {
    const r = extractInvoiceDate("Rechnungsdatum 12/01/2026", null);
    expect(r.date).toBe("2026-01-12");
    expect(r.uncertain).toMatch(/nicht eindeutig/);
    expect(r.suggestion).toBe("2026-12-01");
  });
  it("eindeutige Schrägstrich-Daten", () => {
    expect(readDate("25/01/2026", null).date).toBe("2026-01-25");
    expect(readDate("01/25/2026", null).date).toBe("2026-01-25");
    expect(readDate("05/05/26", null).date).toBe("2026-05-05");
  });
  it("deutsche Schreibweisen und Monatsnamen", () => {
    expect(extractInvoiceDate("Rechnungsdatum: 01.12.2026", null).date).toBe("2026-12-01");
    expect(extractInvoiceDate("Datum 3. März 2026", null).date).toBe("2026-03-03");
    expect(extractInvoiceDate("Invoice date Jan 12, 2026", null).date).toBe("2026-01-12");
    expect(extractInvoiceDate("Rechnungsdatum 2026-01-12", null).date).toBe("2026-01-12");
  });
  it("Rechnungsdatum zählt vor Bestell- und Lieferdatum, auch wenn es später im Text steht", () => {
    const text = "Bestelldatum: 02.01.2026\nLieferdatum: 05.01.2026\nRechnungsdatum: 06.01.2026";
    expect(extractInvoiceDate(text, null).date).toBe("2026-01-06");
  });
  it("vertauschtes Datum im Text, Dateiname eindeutig → Dateiname gilt", () => {
    // Text (falsch amerikanisch gelesen wäre 2026-12-01) – hier explizit ISO falsch herum
    expect(extractInvoiceDate("Datum: 2026-12-01", "2026-01-12")).toEqual({ date: "2026-01-12", source: "dateiname" });
  });
  it("Text weicht stark vom Dateinamen ab → unsicher mit Vorschlag", () => {
    const r = extractInvoiceDate("Rechnungsdatum: 15.03.2026", "2026-01-12");
    expect(r.date).toBe("2026-03-15");
    expect(r.uncertain).toMatch(/weicht vom Dateinamen/);
    expect(r.suggestion).toBe("2026-01-12");
  });
  it("ohne Datum im Text: Dateiname; ganz ohne: unsicher", () => {
    expect(extractInvoiceDate("Summe 10 €", "2026-02-02")).toEqual({ date: "2026-02-02", source: "dateiname" });
    expect(extractInvoiceDate("Summe 10 €", null).uncertain).toMatch(/Kein Rechnungsdatum/);
  });
  it("Datum in der Zukunft ist unplausibel", () => {
    const r = extractInvoiceDate("Rechnungsdatum 01.12.2027", null, "2026-10-24");
    expect(r.uncertain).toMatch(/Zukunft/);
  });
});

describe("Belegart", () => {
  it("erkennt die Art im Kopf", () => {
    expect(detectDocType("GUTSCHRIFT Nr. 4711\nzur Rechnung 4700").type).toBe("gutschrift");
    expect(detectDocType("Auftragsbestätigung\nIhre Bestellung …").type).toBe("bestaetigung");
    expect(detectDocType("Rechnung Nr. RE-1\nLieferschein liegt bei").type).toBe("rechnung");
    expect(detectDocType("Stornorechnung zu RE-1").type).toBe("storno");
    expect(detectDocType("Lieferschein 123").type).toBe("lieferschein");
    expect(detectDocType("", "2026-01-01-scan.pdf")).toEqual({ type: "unbekannt", uncertain: expect.stringMatching(/Kein Text/) });
  });
  it("Gutschrift nur tief im Text: unsicher", () => {
    const r = detectDocType(`${"x ".repeat(400)}\nGutschrift wird verrechnet`);
    expect(r.type).toBe("gutschrift");
    expect(r.uncertain).toBeTruthy();
  });
  it("Summen: Gutschrift abziehen, Bestätigung nicht zählen", () => {
    expect(bookedAmount("rechnung", 10)).toBe(10);
    expect(bookedAmount("gutschrift", 10)).toBe(-10);
    expect(bookedAmount("bestaetigung", 10)).toBe(0);
  });
});

describe("Duplikate", () => {
  const r = (p: Partial<DupRow> & { id: string }): DupRow => ({ invoiceNumber: null, invoiceDate: null, totalGross: null, sourceKey: null, supplierId: null, vendor: null, docType: "rechnung", ...p });
  it("gleiche Nummer beim selben Aussteller", () => {
    const a = r({ id: "a", invoiceNumber: "RE-2026-001", sourceKey: "shop" });
    expect(findDuplicates(a, [r({ id: "b", invoiceNumber: "re 2026/001", sourceKey: "shop" }), r({ id: "c", invoiceNumber: "RE-2026-001", sourceKey: "anderer" })])).toEqual([{ id: "b", reason: "gleiche Rechnungsnummer RE-2026-001" }]);
  });
  it("ohne Nummer: gleicher Aussteller, Datum und Betrag", () => {
    const a = r({ id: "a", sourceKey: "shop", invoiceDate: "2026-01-12", totalGross: 19.99 });
    expect(findDuplicates(a, [r({ id: "b", sourceKey: "shop", invoiceDate: "2026-01-12", totalGross: 19.99 }), r({ id: "c", sourceKey: "shop", invoiceDate: "2026-01-13", totalGross: 19.99 })]).map((d) => d.id)).toEqual(["b"]);
  });
  it("Gutschrift zur Rechnung ist kein Duplikat", () => {
    const a = r({ id: "a", invoiceNumber: "4711", sourceKey: "shop", docType: "gutschrift" });
    expect(findDuplicates(a, [r({ id: "b", invoiceNumber: "4711", sourceKey: "shop" })])).toEqual([]);
  });
});
