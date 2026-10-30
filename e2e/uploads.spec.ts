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

  test("Amazon-Remissionsaufträge (TXT und CSV) mit mehreren Zeilen je Auftrag + SKU werden übernommen", async ({ page }) => {
    const m = marke();
    const kopf = ["request-date", "order-id", "order-source", "order-type", "service-speed", "order-status", "last-updated-date", "sku", "fnsku", "disposition", "requested-quantity", "cancelled-quantity", "disposed-quantity", "shipped-quantity", "in-process-quantity", "removal-fee", "currency"];
    const z = (o: string, disp: string, fee: string) => ["2026-09-01T10:00:00+00:00", o, "", "Return", "Standard", "Completed", "2026-09-05T08:00:00+00:00", `TEST-REM-${m}`, "X00TEST001", disp, "1", "0", "0", "1", "0", fee, "EUR"];
    const zeilen = [z(`REM1-${m}`, "Sellable", "0.50"), z(`REM1-${m}`, "Sellable", "0.75"), z(`REM1-${m}`, "Unsellable", "0.50"), z(`REM2-${m}`, "Sellable", "0.50")];
    const txt = [kopf, ...zeilen].map((r) => r.join("\t")).join("\r\n");
    const csv = [kopf, ...zeilen].map((r) => r.map((x) => `"${x}"`).join(",")).join("\n");
    await anmelden(page, "inhaber");
    await page.goto("/uploads");
    await page.getByTestId("upload-dateien").setInputFiles([{ name: `remissionen-${m}.txt`, mimeType: "text/plain", buffer: Buffer.from(txt, "utf8") }]);
    await page.getByTestId("upload-los").click();
    const e1 = page.getByTestId("upload-ergebnis");
    await expect(e1).toContainText("Remissionsaufträge (Details): 4 Zeilen gelesen, 3 neu", { timeout: 60_000 });
    const r = await sql("select requested_quantity, removal_fee from amazon_removal_orders where order_id = $1 and disposition = 'Sellable'", [`REM1-${m}`]);
    expect(r).toHaveLength(1);
    expect(Number(r[0].requested_quantity)).toBe(2);
    expect(Number(r[0].removal_fee)).toBe(1.25);
    // Derselbe Bericht als CSV (Download-Variante) → nichts doppelt
    await page.goto("/uploads");
    await page.getByTestId("upload-dateien").setInputFiles([{ name: `remissionen-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") }]);
    await page.getByTestId("upload-los").click();
    await expect(page.getByTestId("upload-ergebnis")).toContainText("4 Zeilen gelesen, 0 neu", { timeout: 60_000 });
  });
});
