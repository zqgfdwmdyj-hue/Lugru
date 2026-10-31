import { describe, expect, it } from "vitest";
import { detectDocType, invoiceSignals, NOT_BOOKED, notInvoiceReason } from "@/lib/invoices/checks";
import { extractInvoiceFacts, plausibleInvoiceNumber } from "@/lib/invoices/parse";

// Belegqualität: AGB/Garantie/Werbung aussortieren, unplausible Rechnungsnummern – erfundene Texte.

const INVOICE = "Testhandel GmbH · Rechnung · Rechnungsnummer: RE-2026-0815 · Datum 01.10.2026 · Pos. 1 Testartikel 2 Stk 19,90 € · Gesamtbetrag 39,80 € · enthaltene MwSt 19 % 6,35 €";
const AGB = "Allgemeine Geschäftsbedingungen der Testhandel GmbH · § 1 Geltung · Die Rechnung wird per E-Mail versandt. Bei Fragen zur Rechnung erreichen Sie uns jederzeit.";
const WARRANTY = "Garantiekarte · Herstellergarantie 2 Jahre · Bitte bewahren Sie die Rechnung als Kaufnachweis auf.";
const AD = "Newsletter Oktober · Jetzt bestellen und 10 % sparen · Angebot gültig bis 31.10. · Ihre Rechnung erhalten Sie mit der Lieferung.";

describe("Kein Rechnungsbeleg", () => {
  it("AGB, Garantie, Werbung werden aussortiert – mit Grund", () => {
    for (const [text, why] of [[AGB, "AGB"], [WARRANTY, "Garantie"], [AD, "Werbung"]] as const) {
      const d = detectDocType(text, "beleg.pdf");
      expect(d.type).toBe("keinbeleg");
      expect(d.notInvoice).toContain(why);
    }
    expect(NOT_BOOKED).toContain("keinbeleg");
  });

  it("echte Rechnung bleibt Rechnung, auch mit AGB-Hinweis im Kopf", () => {
    expect(detectDocType(INVOICE).type).toBe("rechnung");
    expect(invoiceSignals(INVOICE)).toBe(3);
    expect(notInvoiceReason(`AGB siehe Rückseite · ${INVOICE}`)).toBeNull();
    expect(detectDocType(`AGB siehe Rückseite · ${INVOICE}`).type).toBe("rechnung");
  });
});

describe("Rechnungsnummer plausibel", () => {
  it("Wörter wie „jederzeit“ oder „Fragen“ sind keine Nummer", () => {
    expect(plausibleInvoiceNumber("jederzeit")).toBe(false);
    expect(plausibleInvoiceNumber("Fragen")).toBe(false);
    expect(plausibleInvoiceNumber("01.10.2026")).toBe(false);
    expect(plausibleInvoiceNumber("RE-2026-0815")).toBe(true);
    expect(plausibleInvoiceNumber("4711")).toBe(true);
  });
  it("die Erkennung nimmt den ersten plausiblen Treffer", () => {
    expect(extractInvoiceFacts("Fragen zur Rechnungsnummer: jederzeit gerne. Rechnungsnummer: 2026-4711 · Gesamtbetrag 10,00 €").invoiceNumber).toBe("2026-4711");
    expect(extractInvoiceFacts(AGB).invoiceNumber).toBeNull();
  });
});
