// B15 Logik/Anzeige (Browser-Test 30.10., seit der BQool-Ablösung mit ProfitGuard-Export): Repricer mit Übersicht je
// Strategie, Filtern und allen Ländern („im Repricing“ aus der Repricing-Spalte, nicht aus dem Amazon-Angebotsstatus);
// SKU-Kürzel stehen nicht in der Lieferantenliste; Paletten ohne Kunde werden gemeldet. Erfundene Daten.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

test.describe("B15 Logik/Anzeige", () => {
  test("Repricer: Übersicht je ProfitGuard-Strategie über alle Länder, Filter Land/im Repricing; „Inactive“ ist nicht „pausiert“", async ({ page }) => {
    const m = marke();
    const regel = `b15regel${m}`.toLowerCase();
    const S1 = `B15-${m}-1`;
    const S2 = `B15-${m}-2`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    for (const sku of [S1, S2]) {
      await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date - 5, 5, '4.00')", [T, P, sku]);
      await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 2, current_date)", [T, sku, `Testartikel ${sku} (erfunden)`]);
    }
    await anmelden(page, "inhaber");
    try {
      await page.goto("/repricer");
      // „Status“ = Amazon-Angebotsstatus, „Repricing Status“ = ProfitGuard (On/Off)
      const csv = [
        "SKU,Marketplace,Status,Strategy Name,Min Price,Max Price,Repricing Status",
        `${S1},DE,Inactive,${regel},9.90,19.90,On`,
        `${S2},FR,Active,${regel},,19.90,Off`,
        "",
      ].join("\n");
      const up = page.getByTestId("profitguard-upload");
      await up.locator('input[type="file"]').setInputFiles({ name: "profitguard-b15.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await Promise.all([aktion(page), up.locator('button[type="submit"]').click()]);
      await expect(page.getByTestId("profitguard-result")).toContainText("2 SKUs aus ProfitGuard eingelesen");

      await page.goto("/repricer");
      const zeile = page.getByTestId("pg-strategien-uebersicht").locator("tr", { hasText: regel });
      // 2 SKUs, 1 im Repricing (trotz „Inactive“ im Angebotsstatus), 1 nicht im Repricing, Länder DE und FR
      await expect(zeile.locator("td").nth(1)).toHaveText("2");
      await expect(zeile.locator("td").nth(2)).toHaveText("1");
      await expect(zeile.locator("td").nth(3)).toHaveText("1");
      await expect(zeile).toContainText("DE 1");
      await expect(zeile).toContainText("FR 1");

      // Filter: alle SKUs, nur FR → nur die pausierte
      await page.goto(`/repricer?ab=alle&land=FR&strategie=${regel}#abgleich`);
      const liste = page.getByTestId("abgleich-tabelle");
      await expect(liste).toContainText(S2);
      await expect(liste).not.toContainText(S1);
      // Filter „im Repricing: ja“ → nur DE
      await page.goto(`/repricer?ab=alle&repricing=ja&strategie=${regel}#abgleich`);
      await expect(page.getByTestId("abgleich-tabelle")).toContainText(S1);
      await expect(page.getByTestId("abgleich-tabelle")).not.toContainText(S2);
      // Über die Strategie-Übersicht: „nicht im Repricing“ verlinkt auf den gefilterten Abgleich
      await page.goto("/repricer");
      await page.getByTestId("pg-strategien-uebersicht").locator("tr", { hasText: regel }).locator("td").nth(3).getByRole("link").click();
      await expect(page).toHaveURL(/repricing=nein/);
      await expect(page.getByTestId("abgleich-tabelle")).toContainText(S2);
      await expect(page.getByTestId("abgleich-tabelle")).not.toContainText(S1);
    } finally {
      await sql("delete from profitguard_listings where tenant_id = $1 and sku = any($2)", [T, [S1, S2]]);
      await sql("delete from repricing_gebuehren where tenant_id = $1 and sku = any($2)", [T, [S1, S2]]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = any($2)", [T, [S1, S2]]);
      await sql("delete from lots where tenant_id = $1 and sku = any($2)", [T, [S1, S2]]);
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
