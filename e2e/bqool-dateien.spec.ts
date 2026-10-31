// BQool-Dateien aus dem System (B7 Teil 3): Ist-Stand per Upload, Soll-Regel „Liquidation“ mit Untergrenze, Export
// je Land im Format der angenommenen Datei, SKU ohne EK nur in „EK fehlt“, Werkzeug bqool_export_vorschau.
// Erfundene SKUs.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test, testdienste } from "./helfer";

const ERSTE = "FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)";
const KOPF = "Channel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing";

test.describe("BQool-Dateien", () => {
  test("Ist hochladen → Abgleich → Liquidation setzen → Export DE/FR → Dateien im BQool-Format; ohne EK nicht in der Datei", async ({ page, browser, baseURL }) => {
    const m = marke();
    const mitEk = `TEST-BQ-${m}`;
    const ohneEk = `TEST-BQ-OHNE-${m}`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const heute = new Date().toISOString().slice(0, 10);
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', $4, 10, '5.00')", [T, P, mitEk, heute]);
    for (const sku of [mitEk, ohneEk]) await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 4, $4)", [T, sku, `Testartikel ${sku} (erfunden)`, heute]);
    try {
      await anmelden(page, "inhaber");
      // Ist-Stand DE: BQool-Vorlage (CRLF, keine Tabs in Zeile 1) – SKU mit Regel „mbb“ (Risiko), Repricing aus
      const ist = [ERSTE, KOPF, `Amazon DE\t${mitEk}\t5.95\t\tmbb\t9.99\t29.99\t0.00\t\t\t0`, ""].join("\r\n");
      await page.goto("/uploads");
      await page.getByTestId("upload-dateien").setInputFiles([{ name: `Listings_${m}.txt`, mimeType: "text/plain", buffer: Buffer.from(ist, "utf8") }]);
      await page.getByTestId("upload-los").click();
      await expect(page.getByTestId("upload-ergebnis")).toHaveAttribute("data-art", "bqool_datei", { timeout: 60_000 });
      await expect(page.getByTestId("upload-ergebnis")).toContainText("BQool DE: 1 SKUs als Ist-Stand übernommen (mbb 1)");

      await page.goto("/repricer/bqool");
      await expect(page.getByTestId("bq-abgleich")).toContainText(`DE ${mitEk}: Regel „mbb“`);
      await expect(page.getByTestId("bq-ek-fehlt")).toContainText(ohneEk);
      // Soll: Liquidation mit fester Untergrenze 12,99 in DE und FR
      const f = page.getByTestId("bq-zuweisung-form");
      await f.locator('input[name="sku"]').fill(mitEk);
      await f.locator('select[name="regel"]').selectOption("Liquidation");
      await f.locator('input[name="untergrenze"]').fill("12,99");
      for (const l of ["IT", "ES"]) await f.locator(`input[name="land"][value="${l}"]`).uncheck();
      await Promise.all([aktion(page), f.getByRole("button", { name: "Regel setzen" }).click()]);
      await expect(page.getByRole("status")).toContainText(`${mitEk}: Liquidation in DE, FR gespeichert`);
      await expect(page.locator(`[data-testid="bq-zeile"][data-sku="${mitEk}"]`).first()).toContainText("mbb → Liquidation");

      // Export DE + FR, alles
      const e = page.getByTestId("bq-export-form");
      for (const l of ["IT", "ES"]) await e.locator(`input[name="land"][value="${l}"]`).uncheck();
      await e.locator('input[name="nur_aenderungen"]').uncheck();
      await Promise.all([aktion(page), page.getByTestId("bq-export-los").click()]);
      await expect(page.getByRole("status")).toContainText("Export erzeugt");
      const de = await (await page.request.get(await page.getByTestId("bq-datei-DE").getAttribute("href") as string)).text();
      const zeilen = de.split("\n");
      expect(zeilen[0]).toBe(ERSTE + "\t".repeat(10));
      expect(zeilen[1]).toBe(KOPF);
      // Cost = EK 5,00 × 1,19; Liquidation → Min = Untergrenze; Max = Min × 2 (ohne Buy-Box-Daten); Enable wie in BQool (0)
      expect(zeilen).toContain(`Amazon DE\t${mitEk}\t5.95\t\tLiquidation\t12.99\t25.98\t0.00\t\t\t0`);
      expect(de).not.toContain(ohneEk);
      expect(de).not.toContain("\r");
      const fr = await (await page.request.get(await page.getByTestId("bq-datei-FR").getAttribute("href") as string)).text();
      expect(fr.split("\n")).toContain(`Amazon FR\t${mitEk}\t5.95\t\tLiquidation\t12.99\t25.98\t0.00\t\t\t1`);
      const zip = await page.request.get(await page.getByTestId("bq-zip").getAttribute("href") as string);
      expect(zip.headers()["content-type"]).toBe("application/zip");

      // Übertragen nur mit Bestätigung; dann je Land eine Datei auf den Web-Nachbau
      const vorher = (await testdienste.web()).filter((w) => w.dienst === "bqool").length;
      await Promise.all([aktion(page), page.getByTestId("bq-automatik").getByRole("button").click()]);
      await expect(page.getByRole("status")).toContainText("Bitte bestätigen");
      expect((await testdienste.web()).filter((w) => w.dienst === "bqool").length).toBe(vorher);
      await page.getByTestId("bq-automatik").locator('input[name="bestaetigt"]').check();
      await Promise.all([aktion(page), page.getByTestId("bq-automatik").getByRole("button").click()]);
      await expect(page.getByRole("status")).toContainText("2 Dateien bei BQool hochgeladen", { timeout: 90_000 });
      const hoch = (await testdienste.web()).filter((w) => w.dienst === "bqool").slice(vorher);
      expect(hoch.map((w) => w.name.replace(/_\d{4}-\d{2}-\d{2}/, ""))).toEqual(["BQool_DE.txt", "BQool_FR.txt"]);
      await expect(page.getByTestId("bq-uebertragung")).toContainText("hochgeladen");

      // Claude: Vorschau lesen
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const v = JSON.parse(await c.call("bqool_export_vorschau", { land: "DE" }));
      expect(v.laender[0]).toMatchObject({ land: "DE" });
      // DE: nur SKUs, die BQool in DE führt (Ist) – die SKU ohne EK fehlt dort; über alle Länder steht sie in „EK fehlt“
      expect(v.ek_fehlt.skus).not.toContain(ohneEk);
      expect(JSON.parse(await c.call("bqool_export_vorschau", {})).ek_fehlt.skus).toContain(ohneEk);
      expect(v.abgleich.faelle.join(" ")).toContain(mitEk);
      expect(await c.tools()).toEqual(expect.arrayContaining(["bqool_export_vorschau"]));
    } finally {
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = any($2)", [T, [mitEk, ohneEk]]);
      await sql("delete from lots where tenant_id = $1 and sku = $2", [T, mitEk]);
      await sql("delete from bqool_listings where tenant_id = $1 and sku = $2", [T, mitEk]);
      await sql("delete from bqool_zuweisungen where tenant_id = $1 and sku = $2", [T, mitEk]);
    }
  });
});
