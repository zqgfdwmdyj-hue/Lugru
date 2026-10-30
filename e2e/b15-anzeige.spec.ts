// B15 Logik/Anzeige (Browser-Test 30.10.): Repricer mit Übersicht je Regel, Filtern und allen Ländern (Status aus
// der Repricing-Spalte, nicht aus dem Amazon-Angebotsstatus); SKU-Kürzel stehen nicht in der Lieferantenliste;
// Paletten ohne Kunde werden gemeldet. Erfundene Daten.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

test.describe("B15 Logik/Anzeige", () => {
  test("Repricer: Übersicht je Regel über alle Länder, Filter Land/Status; „Inactive“ ist nicht „pausiert“", async ({ page }) => {
    const m = marke();
    const regel = `b15regel${m}`.toLowerCase();
    await anmelden(page, "inhaber");
    try {
      await page.goto("/repricer");
      const csv = [
        "SKU,Marketplace,Status,Strategy Name,Min Price,Max Price,Repricing Status",
        `B15-${m}-1,DE,Inactive,${regel},9.90,19.90,On`,
        `B15-${m}-2,FR,Active,${regel},,19.90,Off`,
        "",
      ].join("\n");
      const up = page.getByTestId("bqool-upload");
      await up.locator('input[type="file"]').setInputFiles({ name: "bqool-b15.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await Promise.all([aktion(page), up.locator('button[type="submit"]').click()]);
      await expect(page.getByTestId("bqool-result")).toContainText("2 SKUs eingelesen");

      await page.goto("/repricer");
      const zeile = page.getByTestId("bqool-regeln").locator("tr", { hasText: regel });
      // 2 SKUs, 1 aktiv (trotz „Inactive“ im Angebotsstatus), 1 pausiert, Länder DE und FR
      await expect(zeile.locator("td").nth(1)).toHaveText("2");
      await expect(zeile.locator("td").nth(2)).toHaveText("1");
      await expect(zeile.locator("td").nth(3)).toHaveText("1");
      await expect(zeile).toContainText("DE 1");
      await expect(zeile).toContainText("FR 1");

      // Filter: alle SKUs, nur FR → nur die pausierte
      await page.goto(`/repricer?bq=alle&land=FR&regel=${regel}#bqool-liste`);
      const liste = page.getByTestId("bqool-problems");
      await expect(liste).toContainText(`B15-${m}-2`);
      await expect(liste).not.toContainText(`B15-${m}-1`);
      // Filter Status aktiv → nur DE
      await page.goto(`/repricer?bq=alle&status=aktiv&regel=${regel}#bqool-liste`);
      await expect(page.getByTestId("bqool-problems")).toContainText(`B15-${m}-1`);
      await expect(page.getByTestId("bqool-problems")).not.toContainText(`B15-${m}-2`);
    } finally {
      await sql("delete from bqool_listings where sku like $1", [`B15-${m}-%`]);
    }
  });

  test("Lieferanten: SKU-Kürzel getrennt; „Ist ein Lieferant“ nur auf Klick", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const code = `K${m}`.toUpperCase().slice(0, 20);
    await sql("insert into suppliers (tenant_id, code, sku_kuerzel) values ($1, $2, true)", [T, code]);
    try {
      await anmelden(page, "inhaber");
      await page.goto("/b2b/lieferanten");
      await expect(page.getByTestId("sku-kuerzel")).toContainText(code);
      await expect(page.getByTestId("lieferanten-freigaben")).not.toContainText(code);
      const zeile = page.getByTestId("sku-kuerzel").locator("tr", { hasText: code });
      await Promise.all([page.waitForURL(/meldung=/), zeile.getByTestId("kuerzel-als-lieferant").click()]);
      await expect(page.getByTestId("lieferanten-freigaben")).toContainText(code);
      expect((await sql<{ k: boolean }>("select sku_kuerzel k from suppliers where tenant_id = $1 and code = $2", [T, code]))[0].k).toBe(false);
    } finally {
      await sql("delete from suppliers where tenant_id = $1 and code = $2", [T, code]);
    }
  });

  test("Palettenlager: Palette ohne Kunde wird gemeldet und lässt sich filtern", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const code = `P-B15-${m}`.slice(0, 30);
    await sql("insert into pallets (tenant_id, code, customer, in_at) values ($1, $2, null, current_date)", [T, code]);
    try {
      await anmelden(page, "inhaber");
      await page.goto("/paletten");
      await expect(page.getByTestId("pal-ohne-kunde")).toContainText(code);
      await page.getByTestId("pal-ohne-kunde").getByRole("link").click();
      await expect(page.locator("#lager")).toContainText(code);
    } finally {
      await sql("delete from pallets where tenant_id = $1 and code = $2", [T, code]);
    }
  });
});
