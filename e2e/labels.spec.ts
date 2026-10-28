// Labels vom Lieferschein bis zur Versandmeldung – vollständig, aber ohne Folgen: Internetmarke und DHL laufen gegen
// die Testdienste (simulierter Kauf, Test-PDF), die Versandmeldung an Amazon wird nur simuliert.
import { aktion, anmelden, expect, sql, test, testdienste } from "./helfer";

test.describe("Aufträge – Lieferschein & Labels", () => {
  test("Offene Aufträge → Versandart je Bestellung → Labels kaufen (simuliert) → alle als versendet melden (simuliert)", async ({ page }) => {
    await anmelden(page, "inhaber");
    const vorher = (await testdienste.log()).length;
    await page.goto("/auftraege/lieferschein");
    await page.selectOption('[data-testid="slip-channel"]', "alle");
    await page.uncheck('[data-testid="slip-refresh"]');
    await Promise.all([aktion(page), page.click('[data-testid="slip-load-open"]')]);
    const zeile = (nr: string) => page.locator('[data-testid="slip-row"]', { hasText: nr });
    await expect(zeile("TEST-AMZ-1001")).toBeVisible();
    // Vorschlag: Warensendung (passt laut Artikel), DHL (Tasse nie als Warensendung; Kabel ohne Angaben → DHL)
    await expect(zeile("TEST-AMZ-1001")).toHaveAttribute("data-choice", "warensendung");
    await expect(zeile("TEST-AMZ-1002")).toHaveAttribute("data-choice", "dhl");
    await expect(zeile("TEST-AMZ-1003")).toHaveAttribute("data-choice", "dhl");
    await expect(zeile("TEST-EBAY-2001")).toHaveAttribute("data-choice", "warensendung");
    await expect(zeile("TEST-EBAY-2002").locator('[data-testid="slip-shipper"]')).toHaveValue("prep");
    await Promise.all([aktion(page), page.click('[data-testid="slip-create"]')]);
    const ergebnis = page.locator('[data-testid="slip-result"]');
    await expect(ergebnis).toBeVisible({ timeout: 60_000 });
    await expect(ergebnis.locator("h2")).toContainText("5 Label(s) erstellt");
    // Test-PDF kommt (TESTLABEL – KEIN PORTO)
    const href = await page.getAttribute('[data-testid="slip-pdf-all"]', "href");
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("pdf");
    const neu = (await testdienste.log()).slice(vorher);
    expect(neu.some((c) => c.dienst === "Deutsche Post" && c.path === "/im/app/shoppingcart/pdf" && c.simuliert)).toBe(true);
    expect(neu.some((c) => c.dienst === "DHL Paket" && c.path.endsWith("/orders") && c.simuliert)).toBe(true);
    const status = await sql<{ external_id: string; status: string; shipped_by: string | null }>("select external_id, status, shipped_by from orders where external_id like 'TEST-%' and status <> 'shipped' order by external_id");
    expect(status).toEqual([
      { external_id: "TEST-AMZ-1001", status: "label_created", shipped_by: "self" },
      { external_id: "TEST-AMZ-1002", status: "label_created", shipped_by: "self" },
      { external_id: "TEST-AMZ-1003", status: "label_created", shipped_by: "self" },
      { external_id: "TEST-EBAY-2001", status: "label_created", shipped_by: "self" },
      { external_id: "TEST-EBAY-2002", status: "label_created", shipped_by: "prep" },
    ]);
    // Versandmeldung an die Marktplätze – simuliert
    await page.goto("/auftraege?ansicht=label");
    page.once("dialog", (d) => d.accept());
    await Promise.all([aktion(page), page.getByRole("button", { name: "Alle als versendet markieren" }).click()]);
    await expect.poll(async () => (await sql("select 1 from orders where status = 'label_created'")).length, { timeout: 30_000 }).toBe(0);
    const meldungen = (await testdienste.log()).slice(vorher).filter((c) => c.dienst === "Amazon" && c.path.includes("shipmentConfirmation"));
    expect(meldungen.map((c) => c.path).sort()).toEqual(["/amazon/orders/v0/orders/TEST-AMZ-1001/shipmentConfirmation", "/amazon/orders/v0/orders/TEST-AMZ-1002/shipmentConfirmation", "/amazon/orders/v0/orders/TEST-AMZ-1003/shipmentConfirmation"]);
    expect(meldungen.every((c) => c.simuliert)).toBe(true);
    // eBay ist in den Testdaten nicht verbunden → klare Meldung statt stiller Fehler
    const ebay = await sql<{ external_id: string; tracking_upload_error: string }>("select external_id, tracking_upload_error from orders where external_id like 'TEST-EBAY-%' order by external_id");
    expect(ebay.every((o) => o.tracking_upload_error.includes("eBay ist nicht verbunden"))).toBe(true);
    await page.goto("/auftraege?ansicht=fehler");
    await expect(page.locator("main")).toContainText("TEST-EBAY-2001");
  });
});
