// Palettenlager – Sendungen: anlegen → verschieben mit Grund → Meldung im System und per Mail (in der Testumgebung
// abgefangen) → Kunden-Link → abgelaufener Link → zurückgezogener Link. Erfundene Daten.
import { createHash } from "node:crypto";
import { aktion, alsPerson, anmelden, expect, keinWaagrechtesScrollen, marke, sql, test } from "./helfer";

const plus = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + n * 86400_000));

test.describe("Palettenlager – Sendungen", () => {
  test("Anlegen, verschieben, Meldung an alle (System + Mail), Kunden-Link, abgelaufen, zurückgezogen", async ({ page, browser, baseURL }) => {
    await anmelden(page, "inhaber");
    const m = marke();
    const titel = `E2E ${m} 3 Paletten Testware`;
    // 1) anlegen
    await page.goto("/paletten/sendungen?neu=1");
    await page.check('[data-testid="ship-dir-ein"]');
    await page.fill('[data-testid="ship-title"]', titel);
    await page.selectOption('[data-testid="ship-carrier"]', "dachser");
    await page.fill('[data-testid="ship-trackno"]', "ABN 4711");
    await page.fill('[data-testid="ship-pallets"]', "3");
    await page.fill("#n-date", plus(1));
    await page.click('[data-testid="ship-create"]');
    await page.waitForURL(/\/paletten\/sendungen\/[0-9a-f-]{36}/);
    const url = page.url().split("?")[0];
    const id = url.split("/").pop()!;
    await expect(page.locator('[data-testid="ship-created"]')).toBeVisible();
    await expect(page.locator('[data-testid="ship-trackno-show"]')).toHaveText("ABN4711");
    // 2) verschieben mit Grund
    await page.fill('[data-testid="ship-shift-date"]', plus(3));
    await page.fill('[data-testid="ship-shift-reason"]', "Fahrzeug defekt");
    await Promise.all([aktion(page), page.click('[data-testid="ship-shift-save"]')]);
    await expect(page.locator('[data-testid="ship-shift"] [data-testid="ship-msg"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-testid="ship-status"]')).toHaveText("verzögert");
    await expect(page.locator('[data-testid="ship-info"]')).toContainText("+2 Tage");
    await expect(page.locator('[data-testid="ship-history"]')).toContainText("Fahrzeug defekt");
    await expect(page.locator('[data-testid="ship-history"]')).toContainText("Meldung an alle");
    // 3) Meldung per Mail – in der Testumgebung abgefangen (Einstellungen → Testumgebung)
    await page.goto("/einstellungen/testumgebung");
    const mail = page.locator('[data-testid="testenv-mail"]', { hasText: titel }).filter({ hasText: "Termin verschoben" }).or(page.locator('[data-testid="testenv-mail"]', { hasText: titel })).first();
    await expect(mail).toBeVisible();
    const alleMails = await page.locator('[data-testid="testenv-mail"]', { hasText: titel }).allTextContents();
    const verschoben = alleMails.find((t) => t.includes("Fahrzeug defekt")) ?? "";
    expect(verschoben, "Mail zur Verschiebung").toContain(`${baseURL}/paletten/sendungen/${id}`);
    expect(verschoben).toMatch(/an [^·]*lager/);
    expect(verschoben).not.toMatch(/an [^·]*inhaber/);
    // 4) Mitarbeiter mit nur Palettenlager sieht den Hinweis
    const lager = await alsPerson(browser, "lager");
    await lager.goto("/paletten");
    await expect(lager.locator('[data-testid="ship-notices"]')).toContainText(titel);
    await expect(lager.locator('[data-testid="ship-notices"]')).toContainText("Fahrzeug defekt");
    // 5) Kunden-Link
    await page.goto(url);
    await Promise.all([aktion(page), page.click('[data-testid="ship-link-create"]')]);
    const link1 = (await page.getAttribute('[data-testid="ship-link-url"]', "href"))!;
    expect(link1).toMatch(new RegExp(`^${baseURL}/sendung/[A-Za-z0-9_-]{20,40}$`));
    const kunde = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await kunde.goto(link1);
    await expect(kunde.locator('[data-testid="public-ship-title"]')).toHaveText(titel);
    await expect(kunde.locator('[data-testid="public-ship-status"]')).toHaveText("verzögert");
    await expect(kunde.locator("main")).toContainText("Fahrzeug defekt");
    await expect(kunde.locator("main")).not.toContainText("Ina");
    expect(await keinWaagrechtesScrollen(kunde)).toBe(true);
    // 6) abgelaufener Link (Ablaufdatum in der Test-Datenbank auf gestern = Zeit vorgespult)
    await Promise.all([aktion(page), page.click('[data-testid="ship-link-create"]')]);
    await expect(page.locator('[data-testid="ship-link-url"]')).toHaveCount(2);
    const links = await page.locator('[data-testid="ship-link-url"]').evaluateAll((a) => a.map((x) => x.getAttribute("href")!));
    const link2 = links.find((h) => h !== link1)!;
    const hash = createHash("sha256").update(link2.split("/").pop()!).digest("hex");
    await sql("update pallet_shipment_links set expires_at = now() - interval '1 day' where token_hash = $1", [hash]);
    await kunde.goto(link2);
    await expect(kunde.locator('[data-testid="public-ship-gone"]')).toBeVisible();
    await expect(kunde.locator("main")).not.toContainText(titel);
    await kunde.goto(link1);
    await expect(kunde.locator('[data-testid="public-ship-title"]')).toHaveText(titel);
    // 7) zurückgezogener Link
    await page.reload();
    page.once("dialog", (d) => d.accept());
    const zeile = page.locator('[data-testid="ship-link"]', { has: page.locator(`a[href="${link1}"]`) });
    await Promise.all([aktion(page), zeile.getByRole("button", { name: "Zurückziehen" }).click()]);
    await kunde.goto(link1);
    await expect(kunde.locator('[data-testid="public-ship-gone"]')).toBeVisible();
    expect((await kunde.request.get(`${baseURL}/api/public/sendung/${link1.split("/").pop()}/00000000-0000-0000-0000-000000000000`)).status()).toBe(404);
    await page.reload();
    await expect(page.locator('[data-testid="ship-link-url"]')).toHaveCount(0);
  });
});
