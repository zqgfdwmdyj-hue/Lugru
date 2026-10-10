import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildReceiptPdf, parseReceiptAi, receiptFileName, receiptMail } from "@/lib/invoices/receipt-logic";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

describe("Belege (Kassenzettel)", () => {
  // JPEG aus dem Browser (Canvas) prüft der Ablauf-Test.
  it("alle Fotos eines Belegs → ein PDF, eine Seite je Foto, A4-breit", async () => {
    const pdf = await buildReceiptPdf([{ bytes: PNG, type: "image/png" }, { bytes: PNG, type: "image/png" }], { title: "Beleg 2026-10-10" });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(595);
    expect(doc.getTitle()).toBe("Beleg 2026-10-10");
  });

  it("KI-Antwort wird geprüft", () => {
    const f = parseReceiptAi('Ergebnis: {"vendor":"Testmarkt GmbH","date":"2026-10-09","total_gross":"23,45","total_net":19.71,"vat":[{"rate":19,"amount":3.74}],"payment":"Karte","category":"Büromaterial"}', new Date("2026-10-10"));
    expect(f).toEqual({ vendor: "Testmarkt GmbH", date: "2026-10-09", totalGross: 23.45, totalNet: 19.71, vat: [{ rate: 19, amount: 3.74 }], payment: "Karte", category: "Büromaterial" });
    // Datum in der Zukunft / Unsinn → weg
    expect(parseReceiptAi('{"vendor":"X","date":"2031-01-01","total_gross":-5}', new Date("2026-10-10"))).toMatchObject({ date: null, totalGross: null });
    expect(parseReceiptAi('{"error":"kein Beleg"}')).toBeNull();
    expect(parseReceiptAi("keine Ahnung")).toBeNull();
  });

  it("Dateiname und Mail für Stotax", () => {
    const f = { vendor: "Testmarkt GmbH Filiale 12", date: "2026-10-09", totalGross: 23.45, totalNet: 19.71, vat: [{ rate: 19, amount: 3.74 }], payment: "Karte", category: "Büromaterial" };
    expect(receiptFileName(f, "2026-10-10")).toBe("Beleg_2026-10-09_Testmarkt-GmbH-Filiale_23,45EUR.pdf");
    expect(receiptFileName({ vendor: null, date: null, totalGross: null }, "2026-10-10")).toBe("Beleg_2026-10-10.pdf");
    const m = receiptMail(f, "2026-10-10", "Verpackung für Versand");
    expect(m.subject.replace(/\u00a0/g, " ")).toBe("Beleg – 09.10.2026 – Testmarkt GmbH Filiale 12 – 23,45 €");
    expect(m.text.replace(/\u00a0/g, " ")).toContain("USt 19 %: 3,74 €");
    expect(m.text).toContain("Notiz: Verpackung für Versand");
  });
});
