// B20.8 Bestellvorschläge mit erfundenen Artikeln: Kaufquote 0 % laut Statistik unter einer anderen SKU derselben ASIN
// (wie auf der Hebel-Seite) und ein Posten über 10.000 € stehen unter „prüfen“, nicht in der Summe; die Startseite
// nennt „+ x zu prüfen (y €)“.
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

test.describe("Bestellvorschläge (B20.8)", () => {
  test("Kaufquote 0 % über die ASIN, Posten > 10.000 € → prüfen; Startseite nennt die Prüffälle", async ({ page, browser, baseURL }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const msi = `B20-MON-${m}`;
    const bro = `B20-DRU-${m}`;
    const asinMon = `B0T${String(m).replace(/\D/g, "").slice(-7).padStart(7, "0")}`;
    await sql(
      "insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, cost, qty_to_reorder, time_to_reorder, sales_velocity, synced_at) values ($1, $2, $3, $4, 'Testmonitor 27 Zoll (erfunden)', 0, 400, 72, 'YES', 1, now()), ($1, $5, $6, 'B0TB20DRU1', 'Testdrucker Laser (erfunden)', 0, 377, 80, 'YES', 1, now())",
      [T, `SB-${msi}`, msi, asinMon, `SB-${bro}`, bro],
    );
    // Statistik nur unter einer anderen SKU derselben ASIN: 400 Besuche, Kaufquote 0 %
    await sql("insert into sellerboard_sku_stats (tenant_id, channel, sku, asin, name, units, sessions, conversion, from_day, to_day, synced_at) values ($1, 'amazon', $2, $3, 'Testmonitor 27 Zoll (erfunden)', 0, 400, 0, current_date - 30, current_date - 1, now())", [T, `${msi}-ALT`, asinMon]);

    await anmelden(page, "inhaber");
    await page.goto("/einkauf/vorschlaege?weg=sellerboard&rot=1");
    const pruefen = page.getByTestId("reorder-pruefen");
    await expect(pruefen.getByTestId("reorder-pruefen-zeile").filter({ hasText: msi })).toContainText("Kaufquote 0 % (400 Besuche in 30 Tagen)");
    await expect(pruefen.getByTestId("reorder-pruefen-zeile").filter({ hasText: bro })).toContainText("Posten über 10.000 € (30.160 €)");

    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("bestellvorschlaege", { suche: m, rote_zeigen: true })) as { zu_pruefen?: { anzahl: number; artikel: { sku: string; grund: string }[] }; vorschlaege?: { sku: string }[] };
    const skus = (r.zu_pruefen?.artikel ?? []).map((a) => a.sku);
    expect(skus).toEqual(expect.arrayContaining([msi, bro]));

    // Startseite: „+ x zu prüfen (y €)“ mit Link auf den Prüfblock
    await page.goto("/");
    const zeile = page.getByTestId("reorder-teaser-pruefen");
    await expect(zeile).toContainText(/\+ \d+ zu prüfen \([\d.]+\s€\)/);
    await expect(zeile.locator("a")).toHaveAttribute("href", /\/einkauf\/vorschlaege\?weg=sellerboard#pruefen/);
  });
});
