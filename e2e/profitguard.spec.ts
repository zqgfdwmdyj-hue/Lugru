// Repricing über ProfitGuard (ProfitPath) – Ablösung von BQool: erfundener ProfitGuard-Export über die zentralen Uploads
// → Abgleich Seller-System ↔ ProfitGuard mit Auffälligkeiten (Min unter Soll-Min, nicht im Repricing) → Soll-Strategie
// „Liquidation“ mit festem Min → Importdatei nur mit Häkchen „Freigabe geprüft“ → Download im Format des Exports →
// zurück eingelesen: keine Auffälligkeit mehr. Werkzeuge „repricer“ und „profitguard_export_vorschau“.
// Alle SKUs, ASINs und Preise erfunden.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const KOPF = ["SKU", "ASIN", "Product Name", "Marketplace", "Your Price", "Min Price", "Max Price", "Strategy", "Repricing Status", "Buy Box Price", "Tags"];
type Vorschau = { laender: { land: string; groesste_aenderungen: { sku: string; strategie_ist?: string; strategie_soll: string; min_ist: number | null; min_soll: number; max_soll: number; art: string }[] }[]; ek_fehlt: { skus: string[] }; datei: { freigabe_noetig: boolean; strategiewechsel: number } };

test.describe("ProfitGuard – Export einlesen, Abgleich, Importdatei", () => {
  test("Upload eines ProfitGuard-Exports → Abgleich-Auffälligkeiten → Liquidation setzen → Importdatei mit Freigabe → Download im Export-Format → Rücklauf ohne Auffälligkeit", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const A = `TEST-PG-A-${m}`; // Min in ProfitGuard viel zu niedrig
    const B = `TEST-PG-B-${m}`; // in ProfitGuard pausiert, aber Bestand
    const OHNE = `TEST-PG-OHNE-${m}`; // ohne EK → nicht in der Datei
    const asin = (x: string) => `B0PG${m}${x}`.slice(0, 10).padEnd(10, "X");
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    for (const sku of [A, B]) await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date - 10, 10, '5.00')", [T, P, sku]);
    for (const [sku, n] of [[A, 4], [B, 3], [OHNE, 2]] as const) await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, $4, current_date)", [T, sku, `Testartikel ${sku} (erfunden)`, n]);
    const zeile = (sku: string, x: string, preis: string, min: string, max: string, strategie: string, status: string, bb: string) => [sku, asin(x), `Testartikel ${sku} (erfunden)`, "Amazon.de", preis, min, max, strategie, status, bb, `tag-${x}`].join(",");
    const exportDatei = [KOPF.join(","), zeile(A, "A", "24.99", "1.00", "49.99", "Standard", "Active", "22.00"), zeile(B, "B", "30.00", "40.00", "60.00", "Standard", "Paused", "29.00"), zeile(OHNE, "O", "19.99", "10.00", "20.00", "Standard", "Active", "18.00"), ""].join("\r\n");
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");

      // ---- Upload über die zentralen Uploads: Art „ProfitGuard-Export“ erkannt, Marktplatz aus der Spalte -------------
      await page.goto("/uploads");
      await page.getByTestId("upload-dateien").setInputFiles([{ name: `ProfitGuard_Export_${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(exportDatei, "utf8") }]);
      await page.getByTestId("upload-los").click();
      const erg = page.getByTestId("upload-ergebnis");
      await expect(erg).toHaveAttribute("data-art", "profitguard", { timeout: 60_000 });
      await expect(erg).toContainText("3 SKUs aus ProfitGuard eingelesen (DE 3)");

      // ---- Repricer: Stand, Auffälligkeiten je SKU, Filter --------------------------------------------------------------
      await page.goto(`/repricer?q=TEST-PG-&ab=alle#abgleich`);
      await expect(page.getByTestId("profitguard-fehlt")).toHaveCount(0);
      await expect(page.getByTestId("profitguard-stand")).toContainText("DE:");
      await expect(page.getByTestId("kpi-pg-auffaellig")).not.toContainText("noch kein Export eingelesen");
      const zA = page.locator(`[data-testid="abgleich-zeile"][data-sku="${A}"][data-land="DE"]`);
      const zB = page.locator(`[data-testid="abgleich-zeile"][data-sku="${B}"][data-land="DE"]`);
      await expect(zA).toContainText("ProfitGuard-Min unter dem Soll-Min");
      await expect(zA.getByTestId("abgleich-ist")).toContainText("Standard");
      await expect(zB.getByTestId("abgleich-ist")).toContainText("nicht im Repricing");
      await expect(zB).toContainText("SKU mit Bestand nicht im ProfitGuard-Repricing");
      // Ohne EK kein Soll → nicht im Abgleich
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${OHNE}"]`)).toHaveCount(0);
      // Filter „Auffälligkeit = nicht im Repricing“
      await page.goto(`/repricer?q=TEST-PG-&hinweis=nicht_im_repricing#abgleich`);
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${B}"][data-land="DE"]`)).toHaveCount(1);
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${A}"][data-land="DE"]`)).toHaveCount(0);

      // Claude „repricer“: Soll neben Ist, Auffälligkeiten als Text
      const r = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" }));
      expect(r.zeilen).toHaveLength(1);
      expect(r.zeilen[0]).toMatchObject({ land: "DE", sku: A, soll: { strategie: "Standard" }, ist_profitguard: { im_repricing: true, strategie: "Standard", min: 1, max: 49.99, preis: 24.99 } });
      expect(r.zeilen[0].pruefen).toContain("ProfitGuard-Min unter dem Soll-Min des Seller-Systems (Marge je Altersstufe)");
      expect(r.zeilen[0].soll.min).toBeGreaterThan(1);
      expect(r.link).toBe(`${baseURL}/repricer#abgleich`);
      expect(r.datenstand.stand).toMatch(/^ProfitGuard-Export: /);

      // ---- ProfitGuard-Datei: EK fehlt, gelerntes Format, Soll-Strategie Liquidation mit festem Min -------------------
      await page.goto("/repricer/profitguard");
      await expect(page.getByTestId("pg-ek-fehlt")).toContainText(OHNE);
      await expect(page.getByTestId("pg-format")).toContainText(`gelernt aus dem letzten ProfitGuard-Export (${KOPF.length} Spalten, Trennzeichen „,“, Dezimal „.“)`);
      const f = page.getByTestId("pg-zuweisung-form");
      await f.locator('input[name="sku"]').fill(A);
      await f.locator('select[name="regel"]').selectOption("Liquidation");
      await f.locator('input[name="untergrenze"]').fill("19,99");
      for (const l of ["FR", "IT", "ES"]) await f.locator(`input[name="land"][value="${l}"]`).uncheck();
      await Promise.all([aktion(page), f.getByRole("button", { name: "speichern" }).click()]);
      await expect(page.getByRole("status")).toContainText(`${A}: Liquidation in DE gespeichert.`);
      await expect(page.locator(`[data-testid="pg-zuweisung"][data-sku="${A}"][data-land="DE"]`)).toContainText("Liquidation");
      const tabDe = page.locator('[data-testid="pg-tabelle"][data-land="DE"]');
      await expect(tabDe.locator(`[data-testid="pg-zeile"][data-sku="${A}"]`)).toContainText("Standard → Liquidation");
      await expect(tabDe.locator(`[data-testid="pg-zeile"][data-sku="${A}"]`)).toContainText("1,00 → 19,99");

      const v = JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100 })) as Vorschau;
      const sA = v.laender[0].groesste_aenderungen.find((z) => z.sku === A)!;
      expect(sA).toMatchObject({ strategie_ist: "Standard", strategie_soll: "Liquidation", min_ist: 1, min_soll: 19.99, art: "geaendert" });
      const sB = v.laender[0].groesste_aenderungen.find((z) => z.sku === B)!;
      expect(v.datei.freigabe_noetig).toBe(true);
      expect(v.datei.strategiewechsel).toBeGreaterThanOrEqual(1);
      expect(v.ek_fehlt.skus).toContain(OHNE);

      // ---- Importdatei: ohne Häkchen „Freigabe geprüft“ keine Datei, mit Häkchen Datei je Land ------------------------
      const e = page.getByTestId("pg-export-form");
      for (const l of ["FR", "IT", "ES"]) await e.locator(`input[name="land"][value="${l}"]`).uncheck();
      await expect(e.getByTestId("pg-freigabe")).not.toBeChecked();
      await Promise.all([aktion(page), page.getByTestId("pg-export-los").click()]);
      await expect(page.getByRole("status")).toContainText("Freigabe nötig:");
      await expect(page.getByRole("status")).toContainText("„Freigabe geprüft“ anhaken");
      const e2 = page.getByTestId("pg-export-form");
      for (const l of ["FR", "IT", "ES"]) await e2.locator(`input[name="land"][value="${l}"]`).uncheck();
      await e2.getByTestId("pg-freigabe").check();
      await Promise.all([aktion(page), page.getByTestId("pg-export-los").click()]);
      await expect(page.getByRole("status")).toContainText("Datei erzeugt:");
      await expect(page.getByRole("status")).toContainText("in ProfitGuard unter „Export & Import“ importieren");

      // ---- Download: Kopfzeile, Marktplatz-Schreibweise, Werte für „im Repricing“ wie im Export; ohne EK nicht dabei ---
      const href = (await page.getByTestId("pg-datei-DE").getAttribute("href"))!;
      expect(href).toMatch(/^\/repricer\/profitguard\/datei\?export=[0-9a-f-]{36}&land=DE$/);
      const res = await page.request.get(href);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
      expect(res.headers()["content-disposition"]).toMatch(/filename="ProfitGuard_DE_\d{4}-\d{2}-\d{2}_Aenderungen\.csv"/);
      const datei = await res.text();
      const zeilen = datei.split("\r\n").filter(Boolean);
      expect(zeilen[0]).toBe(KOPF.join(","));
      const fmt = (n: number) => n.toFixed(2);
      // Spalte „Buy Box Price“ (Spalte 10) wird nicht verglichen – sie ist in ProfitGuard nur Anzeige.
      const ohneBb = (z: string) => z.split(",").filter((_, i) => i !== 9).join(",");
      expect(zeilen.map(ohneBb)).toContain([A, asin("A"), `Testartikel ${A} (erfunden)`, "Amazon.de", "24.99", "19.99", fmt(sA.max_soll), "Liquidation", "Active", "tag-A"].join(","));
      if (sB) expect(zeilen.map(ohneBb)).toContain([B, asin("B"), `Testartikel ${B} (erfunden)`, "Amazon.de", "30.00", fmt(sB.min_soll), fmt(sB.max_soll), "Standard", "Paused", "tag-B"].join(","));
      expect(datei).not.toContain(OHNE);
      // Alle Länder in einer Datei
      const alle = await page.request.get((await page.getByTestId("pg-datei-alle").getAttribute("href"))!);
      expect(alle.status()).toBe(200);
      expect(await alle.text()).toContain(`${A},`);
      // Fremde/kaputte Export-Kennung
      expect((await page.request.get("/repricer/profitguard/datei?export=kaputt")).status()).toBe(400);

      // Als importiert vermerken (das System lädt selbst nichts hoch)
      await Promise.all([aktion(page), page.getByTestId("pg-importiert-bestaetigen").click()]);
      await expect(page.getByTestId("pg-importiert")).toContainText("in ProfitGuard importiert");

      // ---- Rücklauf: die Datei als neuer ProfitGuard-Export über den Repricer → A ohne Auffälligkeit, Datei „gleich“ ----
      await page.goto("/repricer");
      const up = page.getByTestId("profitguard-upload");
      await up.locator('input[type="file"]').setInputFiles({ name: `ProfitGuard_Export_${m}_neu.csv`, mimeType: "text/csv", buffer: Buffer.from(datei, "utf8") });
      await Promise.all([aktion(page), up.getByRole("button", { name: "ProfitGuard-Export einlesen" }).click()]);
      await expect(page.getByTestId("profitguard-result")).toContainText("SKUs aus ProfitGuard eingelesen (DE");
      const r2 = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" }));
      expect(r2.zeilen[0]).toMatchObject({ soll: { strategie: "Liquidation", min: 19.99 }, ist_profitguard: { strategie: "Liquidation", min: 19.99 } });
      expect(r2.zeilen[0].pruefen).toBeUndefined();
      const v2 = JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100, nur_aenderungen: false })) as Vorschau;
      expect(v2.laender[0].groesste_aenderungen.find((z) => z.sku === A)).toBeUndefined(); // „gleich“ und ohne Warnung
    } finally {
      await sql("delete from profitguard_listings where tenant_id = $1 and sku = any($2)", [T, [A, B, OHNE]]);
      await sql("delete from repricing_zuweisungen where tenant_id = $1 and sku = any($2)", [T, [A, B]]);
      await sql("delete from repricing_liquidationen where tenant_id = $1 and sku = any($2)", [T, [A, B]]);
      await sql("delete from repricing_gebuehren where tenant_id = $1 and sku = any($2)", [T, [A, B, OHNE]]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = any($2)", [T, [A, B, OHNE]]);
      await sql("delete from lots where tenant_id = $1 and sku = any($2)", [T, [A, B]]);
      // Gelerntes Dateiformat verwerfen, damit andere Prüfungen mit der Standard-CSV beginnen
      await sql("update tenants set settings = settings #- '{repricing,profitguard,format}' where id = $1", [T]);
    }
  });
});
