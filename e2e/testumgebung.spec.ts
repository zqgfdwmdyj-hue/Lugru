// Testumgebung selbst: Banner überall, Verbindung nach außen gesperrt, Übersicht mit abgefangenen Mails,
// simulierten Aufrufen und gesperrten Verbindungen.
import { anmelden, expect, test } from "./helfer";

test.describe("Einstellungen – Testumgebung", () => {
  test("Banner auf Login und im System; nach außen gesperrt; Übersicht zeigt Mails, Simuliertes, Gesperrtes @handy", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page.locator('[data-testid="test-banner"]')).toContainText("TESTUMGEBUNG");
    expect(await (await request.get("/api/public/testumgebung")).text()).toBe("gesperrt");
    await anmelden(page, "inhaber");
    await expect(page.locator('[data-testid="test-banner"]')).toBeVisible();
    await page.goto("/einstellungen/testumgebung");
    await expect(page.locator('[data-testid="testenv-on"]')).toBeVisible();
    await expect(page.locator('[data-testid="testenv-blocked"]')).toContainText("example.com");
    await expect(page.locator('[data-testid="testenv-sim"]')).toBeVisible();
    await expect(page.locator('[data-testid="testenv-accounts"]')).toContainText("pruefer");
  });
});
