// EK-Import (B7 Teil 2): ArbitrageOne-Liste über Uploads → Vorschau (geändert/neu/unbekannt, Warnung > 20 %) →
// übernehmen → sellerboard-Importdatei (.xls, ASIN | SKU | Cost). Erfundene SKUs und Preise.
import * as XLSX from "xlsx";
import { aktion, anmelden, expect, marke, sql, test, testdienste } from "./helfer";

function xls(rows: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ASIN", "SKU", "Cost"], ...rows]), "Worksheet");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xls" }));
}

test.describe("EK-Import", () => {
  test("Upload → Vorschau → übernehmen → sellerboard-Datei", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const alt = `TEST-EK-${m}`;
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date, 5, '10.00')", [T, P, alt]);
    try {
      await anmelden(page, "inhaber");
      await page.goto("/uploads");
      await page.getByTestId("upload-dateien").setInputFiles([{ name: `ArbitrageOne_Sellerboard_Export_${m}.xls`, mimeType: "application/vnd.ms-excel", buffer: xls([["B0TEST0001", alt, 12.5], ["B0TEST0009", `TEST-EK-NEU-${m}`, 0.01]]) }]);
      await page.getByTestId("upload-los").click();
      const e = page.getByTestId("upload-ergebnis");
      await expect(e).toHaveAttribute("data-art", "ek_liste", { timeout: 60_000 });
      await expect(e).toContainText("Vorschau: 2 SKUs – 1 geändert, 0 neu, 0 unverändert, 1 unbekannt, 2 mit Warnung");
      await e.getByRole("link").first().click();
      await expect(page.getByTestId("ek-vorschau")).toHaveAttribute("data-status", "vorschau");
      await expect(page.locator(`[data-testid="ek-zeile"][data-sku="${alt}"]`)).toContainText("+25 %");
      // Noch nichts übernommen
      expect((await sql<{ c: string }>("select count(*) c from cost_observations o join lots l on l.id = o.lot_id where l.sku = $1", [alt]))[0].c).toBe("0");
      await Promise.all([aktion(page), page.getByTestId("ek-uebernehmen").click()]);
      await expect(page.getByRole("status")).toContainText("Übernommen");
      await expect(page.getByTestId("ek-vorschau")).toHaveAttribute("data-status", "uebernommen");
      const href = await page.getByTestId("ek-sellerboard-datei").getAttribute("href");
      const r = await page.request.get(href!);
      expect(r.headers()["content-type"]).toBe("application/vnd.ms-excel");
      const wb = XLSX.read(await r.body(), { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Worksheet, { header: 1, raw: true });
      expect(rows[0]).toEqual(["ASIN", "SKU", "Cost"]);
      expect(rows.slice(1).map((x) => x[1])).toEqual([alt]); // Platzhalter 0,01 nicht in der Datei
      await page.reload();
      await expect(page.getByTestId("ek-sellerboard")).toContainText("Importdatei heruntergeladen");

      // Browser-Automatik gegen den Web-Nachbau: anmelden, Datei hochladen, Erfolg + Protokoll mit Bildschirmfotos
      const vorher = (await testdienste.web()).filter((w) => w.dienst === "sellerboard").length;
      await Promise.all([aktion(page), page.getByTestId("ek-sellerboard-automatik").click()]);
      await expect(page.getByRole("status")).toContainText("Automatisch zu sellerboard übertragen", { timeout: 90_000 });
      const web = (await testdienste.web()).filter((w) => w.dienst === "sellerboard");
      expect(web.length).toBe(vorher + 1);
      expect(web.at(-1)!.name).toMatch(/^sellerboard_Kosten_.*\.xls$/);
      await expect(page.getByTestId("ek-sellerboard")).toContainText("automatisch übertragen");
      expect(Number((await sql<{ c: string }>("select count(*) c from files where name like 'automatik-automatik-sellerboard-%'"))[0].c)).toBeGreaterThan(0);

      // Zwei-Faktor-Anmeldung → Abbruch, Aufgabe, kein Upload
      await sql("update integrations set config = config || '{\"email\": \"einkauf-2fa@example.invalid\"}'::jsonb where tenant_id = $1 and provider = 'sellerboard_web'", [T]);
      try {
        await Promise.all([aktion(page), page.getByTestId("ek-sellerboard-automatik").click()]);
        await expect(page.getByRole("status")).toContainText("Zwei-Faktor-Anmeldung verlangt", { timeout: 90_000 });
        expect((await testdienste.web()).filter((w) => w.dienst === "sellerboard").length).toBe(vorher + 1);
        expect((await sql("select 1 from tasks where tenant_id = $1 and system_key like 'automatik-sellerboard-%' and title like '%abgebrochen%' and status = 'open'", [T])).length).toBeGreaterThan(0);
      } finally {
        await sql("update integrations set config = config || '{\"email\": \"einkauf@example.invalid\"}'::jsonb where tenant_id = $1 and provider = 'sellerboard_web'", [T]);
      }
    } finally {
      await sql("delete from lots where tenant_id = $1 and sku like $2", [T, `TEST-EK-%${m}`]);
    }
  });
});
