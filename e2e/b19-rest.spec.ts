// B19.5–B19.8 (Nachtrag 31.10.): Tagesplan „überbucht“ mit Minuten, Assistent-Verlauf (Regel, Tokenzähler),
// Deal-Blatt als Bild, Beobachtungen + Wochenrückblick im Privatbereich, LPN an der Retouren-Station,
// Handy-Anleitung „Deal prüfen“, Werkzeug-Felder (zu_pruefen, nicht_abgerechnet, Fehlertext). Erfundene Daten.
import type { Page } from "@playwright/test";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const HEUTE = berlin(new Date());
/** Ein Dienstag weit weg von anderen Prüfungen (≥ 55 Tage). */
const DIENSTAG = (() => {
  let d = plus(HEUTE, 55);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 2) d = plus(d, 1);
  return d;
})();
const tenant = async () => (await sql<{ id: string }>("select id from tenants order by created_at limit 1"))[0].id;

async function dealAnlegen(page: Page, asin: string) {
  await page.goto("/b2b/neu");
  await page.fill('[data-testid="deal-asin"]', asin);
  await page.selectOption("#f-supplierId", { label: "Test-Großhandel (erfunden) (TESTGH)" });
  await page.fill('[data-testid="deal-ek"]', "4,37");
  await page.fill('[data-testid="deal-preis"]', "9,50");
  await page.fill('[data-testid="deal-frist"]', plus(HEUTE, 7));
  await page.click('[data-testid="deal-anlegen"]');
  await page.waitForURL(/\/b2b\/[0-9a-f-]{36}/);
  return page.url().split("?")[0].split("/").pop()!;
}

test.describe("B19.5–B19.8", () => {
  test("Tagesplan: überbucht mit „x Min. zu viel“ (Seite + Werkzeug)", async ({ page, browser, baseURL }) => {
    const m = marke();
    const T = await tenant();
    for (const n of [1, 2, 3]) await sql("insert into tasks (tenant_id, title, due_date, aufwand, priority, category) values ($1, $2, $3, 'L', 'normal', 'eigene')", [T, `B19 L${n} ${m}`, DIENSTAG]);
    await anmelden(page, "inhaber");
    await page.goto(`/kalender/tagesplan?tag=${DIENSTAG}`);
    const tag = page.getByTestId("tagesplan-woche").locator("a").first();
    await expect(tag).toHaveAttribute("data-ampel", "rot");
    await expect(tag.getByTestId("tagesplan-ampel")).toContainText(/überbucht – \d+ Min\. zu viel \(\d+ Min\. frei\)/);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("tagesplan", { datum: DIENSTAG })) as { tage: { tag: string; faellig_min?: number; zu_viel_min?: number }[] };
    const d = r.tage.find((x) => x.tag === DIENSTAG)!;
    expect(d.zu_viel_min).toBeGreaterThan(0);
    expect(d.faellig_min).toBeGreaterThanOrEqual(3 * 240);
  });

  test("Assistent-Verlauf: Regel für Rückgängig, Tokenzähler mit Zwischenspeicher", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/assistent-verlauf");
    await expect(page.getByTestId("verlauf-regel")).toContainText("Aufgabe ändern");
    await page.goto("/einstellungen/claude");
    await expect(page.getByTestId("assistant-usage")).toContainText("inkl. Zwischenspeicher");
  });

  test("Deal-Blatt als Bild (SVG) ohne EK", async ({ page }) => {
    await anmelden(page, "inhaber");
    const id = await dealAnlegen(page, `B0BLT${marke()}`);
    await expect(page.getByTestId("deal-blatt-bild")).toHaveAttribute("href", `/b2b/${id}/blatt?format=svg`);
    const res = await page.request.get(`/b2b/${id}/blatt?format=svg`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("4,37");
  });

  test("Privat: Beobachtungen-Bereich und Wochenrückblick erreichbar", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/privat/rueckblick");
    await expect(page.getByTestId("link-wochenrueckblick")).toBeVisible();
    await expect(page.getByTestId("link-beobachtungen")).toBeVisible();
    await page.goto("/privat/beobachtungen");
    await expect(page.getByTestId("beob-neu")).toBeVisible();
    await page.goto("/privat/rueckblick/woche");
    await expect(page.getByTestId("wochenrueckblick")).toBeVisible();
    await expect(page.getByTestId("wochenrueckblick")).toContainText("Meine Beobachtungen");
  });

  test("Retouren-Station: LPN von Hand; Handy-Anleitung „Deal prüfen“", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/remissionen/station");
    await expect(page.getByTestId("station-lpn-eingabe")).toBeVisible();
    await expect(page.getByTestId("station-lpn-eingabe")).toBeDisabled();
    await page.getByTestId("station-start").click();
    await expect(page.getByTestId("station-lpn-eingabe")).toBeEnabled();
    await page.goto("/einstellungen/handy");
    await expect(page.getByTestId("handy-deal-pruefen")).toHaveAttribute("href", "/deal-eingang/kurzbefehl");
    await page.goto("/schnell");
    await expect(page.getByTestId("schnell-deal-pruefen").getByRole("link")).toHaveAttribute("href", "/deal-eingang/kurzbefehl");
    await page.goto("/deal-eingang/kurzbefehl");
    await expect(page.getByTestId("de-anleitung")).toContainText("Deal prüfen");
  });

  test("Werkzeuge: Paletten ohne Kunde = nicht abgerechnet, Bestellvorschläge und Anbindungen liefern", async ({ browser, baseURL }) => {
    const m = marke();
    const T = await tenant();
    await sql("insert into pallets (tenant_id, code, in_at) values ($1, $2, current_date)", [T, `B19-${m}`]);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const p = JSON.parse(await mcp.call("paletten", {})) as { nicht_abgerechnet?: { anzahl: number; paletten: string[]; link: string } };
    expect(p.nicht_abgerechnet?.anzahl).toBeGreaterThanOrEqual(1);
    expect(p.nicht_abgerechnet?.link).toContain("/paletten?kunde=__ohne");
    const b = JSON.parse(await mcp.call("bestellvorschlaege", {})) as Record<string, unknown>;
    expect(b).toHaveProperty("datenstand");
    const a = JSON.parse(await mcp.call("anbindungen_status", {})) as Record<string, unknown>;
    expect(a).toBeTruthy();
  });

  test("Lugru: selbst gekauft aus Charge (Kaufdatum nach dem Post) erkannt", async ({ page }) => {
    const m = marke();
    const T = await tenant();
    const asin = `B0KF${m}X`;
    const [d] = await sql<{ id: string }>("insert into lugru_deals_historie (tenant_id, quelle, asin, titel, kanal, gepostet_am) values ($1, 'app', $2, $3, 'lugru-b19', now() - interval '2 days') returning id", [T, asin, `Testmarke Kaufabgleich ${m}`]);
    const [p] = await sql<{ id: string }>("insert into products (tenant_id, asin, title) values ($1, $2, 'Testartikel Kaufabgleich (erfunden)') returning id", [T, asin]);
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date - 1, 4, '7.00')", [T, p.id, `TEST-KAUF-${m}`]);
    await anmelden(page, "inhaber");
    await page.goto("/deal-eingang/lugru");
    await expect(page.getByTestId("lg-gekauft-regel")).toContainText("Charge");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("lg-kauf-abgleich").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("eigene Käufe neu erkannt");
    const [r] = await sql<{ gekauft_erkannt: boolean; gekauft_erkannt_ref: string }>("select gekauft_erkannt, gekauft_erkannt_ref from lugru_deals_historie where id = $1", [d.id]);
    expect(r).toMatchObject({ gekauft_erkannt: true, gekauft_erkannt_ref: `Charge TEST-KAUF-${m}` });
    expect(Number(await page.getByTestId("lg-gekauft").innerText())).toBeGreaterThanOrEqual(1);
  });
});
