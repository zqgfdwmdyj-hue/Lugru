import { describe, expect, it } from "vitest";
import { folderIdFromLink, parseEmbeddedFolder } from "@/lib/integrations/drive-link";
import { extractInvoiceFacts, guessKind, matchBySum, parseInvoiceFileName } from "@/lib/invoices/parse";

describe("Rechnungen", () => {
  it("Dateinamen von Invoice Fetcher", () => {
    expect(parseInvoiceFileName("2026-09-27-amazon-business-api-LU1234.pdf")).toEqual({ date: "2026-09-27", sourceKey: "amazon-business-api" });
    expect(parseInvoiceFileName("2026-09-25-hd-plus-de-2026-09-25.pdf")).toEqual({ date: "2026-09-25", sourceKey: "hd-plus-de" });
    expect(parseInvoiceFileName("scan.pdf")).toEqual({ date: null, sourceKey: null });
  });

  it("Eckdaten aus dem Text", () => {
    const text = `Rechnung
Rechnungsnummer: DE12345-678
Rechnungsdatum: 22.09.2026
Bestellnummer 302-1234567-7654321
Artikel ASIN B0TEST0001  2 x 10,00 €
Zwischensumme netto 16,81 €
MwSt 19 % 3,19 €
Gesamtbetrag 20,00 €`;
    expect(extractInvoiceFacts(text)).toEqual({
      invoiceNumber: "DE12345-678",
      invoiceDate: "2026-09-22",
      orderNumber: "302-1234567-7654321",
      totalGross: 20,
      totalNet: 16.81,
      asins: ["B0TEST0001"],
    });
  });

  it("Tausenderpunkte", () => {
    expect(extractInvoiceFacts("Rechnungsbetrag: 1.234,56 EUR").totalGross).toBe(1234.56);
  });

  it("Einordnung nach Quelle", () => {
    expect(guessKind("amazon-business-api")).toBe("goods");
    expect(guessKind("hd-plus-de")).toBe("expense");
    expect(guessKind("irgendwas")).toBe("unknown");
  });

  it("Summenabgleich findet eindeutige Kombination", () => {
    const c = [
      { id: "a", gross: 11.9 },
      { id: "b", gross: 23.8 },
      { id: "c", gross: 50 },
    ];
    expect(matchBySum(c, 35.7)?.map((x) => x.id)).toEqual(["a", "b"]);
    expect(matchBySum(c, 99)).toBeNull();
  });
});

describe("Drive-Ordner über den Freigabelink", () => {
  it("erkennt die Ordner-ID in allen Link-Formen", () => {
    expect(folderIdFromLink("https://drive.google.com/drive/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks?usp=sharing")).toBe("1KpLl_1tcK0eeehzN980zbG-3M2nhbVks");
    expect(folderIdFromLink("https://drive.google.com/drive/u/0/folders/1KpLl_1tcK0eeehzN980zbG")).toBe("1KpLl_1tcK0eeehzN980zbG");
    expect(folderIdFromLink("https://drive.google.com/open?id=1KpLl_1tcK0eeehzN980zbG")).toBe("1KpLl_1tcK0eeehzN980zbG");
    expect(folderIdFromLink("1KpLl_1tcK0eeehzN980zbG")).toBe("1KpLl_1tcK0eeehzN980zbG");
    expect(folderIdFromLink("rechnungen")).toBeNull();
  });

  it("liest Dateien und Unterordner aus der eingebetteten Ansicht", () => {
    const html = `<div class="flip-entries"><div class="flip-entry" id="entry-1aMZqPaU03E7XOQNXtjSCd" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/1aMZqPaU03E7XOQNXtjSCd" target="_blank"><div class="flip-entry-title">2026-09</div></a></div><div class="flip-entry-last-modified"><div>28.09.26</div></div></div><div class="flip-entry" id="entry-1Z2VYnXb01h-3uvEpt" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/1Z2VYnXb01h-3uvEpt/view?usp=drive_web" target="_blank"><div class="flip-entry-thumb"><img src="x" alt="PDF"/></div><div class="flip-entry-title">Rechnung A &amp; B.pdf</div></a></div><div class="flip-entry-last-modified"><div>12:30</div></div></div></div>`;
    expect(parseEmbeddedFolder(html)).toEqual([
      { id: "1aMZqPaU03E7XOQNXtjSCd", name: "2026-09", folder: true, modified: "28.09.26" },
      { id: "1Z2VYnXb01h-3uvEpt", name: "Rechnung A & B.pdf", folder: false, modified: "12:30" },
    ]);
  });
});
