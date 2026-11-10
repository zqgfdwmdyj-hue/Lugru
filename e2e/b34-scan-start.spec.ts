// Bauauftrag B34.1 Abnahme 0: Scan-Modus als Verknüpfung auf dem Handy-Startbildschirm (Manifest-Kurzbefehl, Anleitung)
// und Probelauf mit drei bekannten EANs – jede liefert in Sekunden eine Ampel. Nur erfundene EANs (200…, Hausnummern).
import { anmelden, expect, marke, sql, test } from "./helfer";

test.describe("B34.1 Abnahme 0", () => {
  const m = marke();
  const eans = [1, 2, 3].map((i) => `20000${m.replace(/[^0-9]/g, "").padEnd(5, "0").slice(0, 5)}${String(i).padStart(3, "0")}`);
  let T = "";
  test.beforeAll(async () => {
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    for (const [i, ean] of eans.entries()) await sql("insert into products (tenant_id, asin, title, ean) values ($1, $2, $3, $4) on conflict do nothing", [T, `B0STRT${m}${i}`.slice(0, 16), `Testartikel Startbildschirm ${m} ${i + 1} (erfunden)`, ean]);
  });
  test.afterAll(async () => {
    await sql("delete from scan_eintraege where code = any($1::text[])", [eans]);
    await sql("delete from products where tenant_id = $1 and ean = any($2::text[])", [T, eans]);
  });

  test("Startbildschirm-Verknüpfung + 3 bekannte EANs liefern eine Ampel", async ({ page }) => {
    test.setTimeout(120_000);
    // Manifest: App auf dem Startbildschirm mit Kurzbefehl „Scan-Modus“
    const man = await (await page.request.get("/manifest.webmanifest")).json();
    expect(man.display).toBe("standalone");
    expect(man.shortcuts).toContainEqual({ name: "Scan-Modus", url: "/scan" });

    await anmelden(page, "inhaber");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/scan");
    const box = page.getByTestId("scan-startbildschirm");
    await box.locator("summary").click();
    await expect(box).toContainText("Zum Home-Bildschirm");
    await expect(box).toContainText("Zum Startbildschirm hinzufügen");
    const probe = box.getByTestId("scan-probe");
    await expect(probe).toHaveCount(3);
    expect((await probe.evaluateAll((l) => l.map((a) => a.getAttribute("data-ean")))).sort()).toEqual([...eans].sort());

    for (const ean of eans) {
      // Tipp auf die Probe-EAN setzt sie im Laden-Modus ein; Regalpreis eintippen, „Prüfen“
      await page.goto(`/scan?modus=laden&code=${ean}`);
      await expect(page.getByLabel("EAN, ASIN oder Link")).toHaveValue(ean);
      await page.getByTestId("scan-preis").fill("9,99");
      const t0 = Date.now();
      await page.getByTestId("scan-pruefen").click();
      await expect(page.getByTestId("scan-ergebnis")).toBeVisible({ timeout: 15_000 });
      expect(Date.now() - t0).toBeLessThan(8000);
      await expect(page.getByTestId("scan-ergebnis")).toHaveAttribute("data-ampel", /gruen|gelb|rot/);
    }
    expect((await sql<{ n: string }>("select count(distinct code)::text n from scan_eintraege where code = any($1::text[])", [eans]))[0].n).toBe("3");
  });
});
