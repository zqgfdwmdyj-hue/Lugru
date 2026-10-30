import { describe, expect, it } from "vitest";
import { artNachEndung, istPdf, istZip, jsonArt, pdfArt, tabellenArt } from "@/lib/uploads/erkennen";

// Zentrale Uploads – Erkennung der Dateiart (erfundene Kopfzeilen).

describe("Tabellen", () => {
  it("Sparkasse CSV-CAMT, Amex, USt-Bericht, BQool, Amazon Business; sonst allgemeiner Import", () => {
    expect(tabellenArt(["Auftragskonto", "Buchungstag", "Valutadatum", "Buchungstext", "Verwendungszweck", "Beguenstigter/Zahlungspflichtiger", "Betrag", "Waehrung"], "umsaetze.csv")).toBe("kontoauszug");
    expect(tabellenArt(["Datum", "Beschreibung", "Karteninhaber", "Konto #", "Betrag"], "activity.csv")).toBe("amex");
    expect(tabellenArt(["Datum", "Beschreibung", "Betrag"], "amex-oktober.csv")).toBe("amex");
    expect(tabellenArt(["TRANSACTION_TYPE", "TAXABLE_JURISDICTION", "TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL"], "vat.csv")).toBe("ust_bericht");
    expect(tabellenArt(["Marketplace", "SKU", "ASIN", "Your Price", "Min Price", "Max Price", "Strategy"], "bqool.xlsx")).toBe("bqool");
    expect(tabellenArt(["SKU", "Min Price", "Max Price"], "Repricer_BQool.csv")).toBeNull();
    expect(tabellenArt(["(Untergeordnete) ASIN", "Titel", "Bestellte Einheiten – B2B", "Umsatz – B2B"], "business.csv")).toBe("amazon_business");
    expect(tabellenArt(["settlement-id", "amount-type", "amount"], "settlement.txt")).toBeNull();
  });
});

describe("Sonstige", () => {
  it("JSON-Call-Archiv, PDF-Text, Endungen, Datei-Signaturen", () => {
    expect(jsonArt([{ sourceDocId: "x", summary: "…" }])).toBe("call_archiv");
    expect(jsonArt({ calls: [{ transcript: "…" }] })).toBe("call_archiv");
    expect(jsonArt({ foo: 1 })).toBeNull();
    expect(pdfArt("Kontoauszug 5/2026\nKontostand am 30.04.2026 1.000,00 +\n03.05.2026 03.05.2026 Überweisung -119,00\n")).toBe("kontoauszug");
    expect(pdfArt("Rechnung Nr. 4711\nNetto 100,00 € USt 19 % 19,00 €")).toBe("beleg");
    const transkript = Array.from({ length: 20 }, (_, i) => `${i % 2 ? "Anna Test" : "Ben Test"}: Satz ${i}`).join("\n");
    expect(pdfArt(transkript)).toBe("call");
    expect(artNachEndung("kassenzettel.JPG")).toBe("beleg");
    expect(artNachEndung("call.vtt")).toBe("call");
    expect(artNachEndung("auszug.xml")).toBe("kontoauszug");
    expect(artNachEndung("x.csv")).toBeNull();
    expect(istPdf(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(istZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
  });
});
