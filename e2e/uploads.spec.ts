// Zentrale Uploads: mehrere Dateien auf einmal – Sparkasse-Kontoauszug als PDF, Amex-CSV, Rechnung (PDF), Unbekanntes –
// werden erkannt und wie im Bereich verarbeitet; Rechte je Art (Assistenz ohne „Geld“ darf keine Kontoauszüge).
import { PDFDocument, StandardFonts } from "pdf-lib";
import { alsPerson, anmelden, expect, marke, sql, test } from "./helfer";

async function pdf(zeilen: [number, number, string][]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [x, y, t] of zeilen) page.drawText(t, { x, y, size: 9, font });
  return Buffer.from(await doc.save());
}

test.describe("Uploads", () => {
  test("Sparkasse-PDF + Amex + Rechnung + Unbekanntes in einem Rutsch; Verlauf; Assistenz ohne Kontoauszüge", async ({ page, browser }) => {
    const m = marke();
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 7);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const jj = d.getUTCFullYear();
    const kontoauszug = await pdf([
      [40, 800, `Kontoauszug ${Number(mm)}/${jj}`],
      [40, 780, "IBAN: DE00 1234 5678 0000 0000 77"],
      [40, 750, `Kontostand am 01.${mm}.${jj}, Auszug Nr. 1`], [480, 750, "2.000,00 +"],
      [40, 700, `03.${mm}.${jj}`], [110, 700, `03.${mm}.${jj}`], [180, 700, "Uberweisung"], [480, 700, "-250,00"],
      [180, 688, `PDF-Lieferant ${m}`], [180, 676, "Rechnung PDF-1"],
      [40, 656, `09.${mm}.${jj}`], [110, 656, `09.${mm}.${jj}`], [180, 656, "Gutschrift"], [480, 656, "100,00"],
      [180, 644, "Testkunde GmbH"],
      [40, 610, `Kontostand am 28.${mm}.${jj} um 20:00 Uhr`], [480, 610, "1.850,00 +"],
    ]);
    const rechnung = await pdf([
      [40, 800, `Test Bürobedarf ${m} GmbH`], [40, 780, "Rechnung Nr. TB-4711"], [40, 760, `Datum 05.${mm}.${jj}`],
      [40, 740, "Netto 100,00 EUR"], [40, 728, "USt 19 % 19,00 EUR"], [40, 716, "Gesamt 119,00 EUR"],
    ]);
    const amex = ["Datum,Beschreibung,Karteninhaber,Konto #,Betrag", `05/${mm}/${jj},TESTABO ${m},INA INHABER,-11001,"9,99"`].join("\n");

    await anmelden(page, "inhaber");
    await page.goto("/uploads");
    await page.getByTestId("upload-dateien").setInputFiles([
      { name: `auszug-${m}.pdf`, mimeType: "application/pdf", buffer: kontoauszug },
      { name: `amex-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(amex, "utf8") },
      { name: `rechnung-${m}.pdf`, mimeType: "application/pdf", buffer: rechnung },
      { name: `unbekannt-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from("foo;bar\n1;2\n", "utf8") },
    ]);
    await page.getByTestId("upload-los").click();
    const ergebnis = page.getByTestId("upload-ergebnis");
    await expect(ergebnis).toHaveCount(4, { timeout: 60_000 });
    await expect(ergebnis.filter({ hasText: `auszug-${m}.pdf` })).toHaveAttribute("data-art", "kontoauszug");
    await expect(ergebnis.filter({ hasText: `auszug-${m}.pdf` })).toContainText("2 neue Buchungen");
    await expect(ergebnis.filter({ hasText: `auszug-${m}.pdf` })).toContainText("Saldo-Kontrolle passt");
    await expect(ergebnis.filter({ hasText: `amex-${m}.csv` })).toHaveAttribute("data-art", "amex");
    await expect(ergebnis.filter({ hasText: `rechnung-${m}.pdf` })).toHaveAttribute("data-art", "beleg");
    await expect(ergebnis.filter({ hasText: `unbekannt-${m}.csv` })).toContainText("Format nicht erkannt");
    // Daten liegen dort, wo sie hingehören
    expect((await sql("select 1 from bank_umsaetze where bereich = 'geschaeft' and buchungstag = $1 and betrag = -250", [`${jj}-${mm}-03`])).length).toBe(1);
    expect((await sql("select 1 from bank_umsaetze where bereich = 'kreditkarte' and buchungstag = $1", [`${jj}-${mm}-05`])).length).toBeGreaterThanOrEqual(1);
    expect((await sql("select 1 from invoices where file_name = $1", [`rechnung-${m}.pdf`])).length).toBe(1);
    // Gleiches PDF noch einmal → nichts doppelt
    await page.goto("/uploads");
    await page.getByTestId("upload-dateien").setInputFiles([{ name: `auszug-${m}.pdf`, mimeType: "application/pdf", buffer: kontoauszug }]);
    await page.getByTestId("upload-los").click();
    await expect(page.getByTestId("upload-ergebnis")).toContainText("0 neue Buchungen, 2 schon vorhanden");
    await page.reload();
    await expect(page.getByTestId("upload-verlauf")).toContainText(`auszug-${m}.pdf`);

    // Assistenz (ohne Bereich „Geld“): Kontoauszug wird erkannt, aber nicht verarbeitet
    const va = await alsPerson(browser, "buero");
    await va.goto("/uploads");
    await va.getByTestId("upload-dateien").setInputFiles([{ name: `va-${m}.pdf`, mimeType: "application/pdf", buffer: kontoauszug }]);
    await va.getByTestId("upload-los").click();
    await expect(va.getByTestId("upload-ergebnis")).toContainText("fehlt dir der Zugriff");
  });
});
