// Übungsdaten getrennt: Übungs-Deals (nur auf dem Papier) zählen in Listen und Kennzahlen nicht mit – nur über den
// sichtbaren Schalter „Übungs-Deals einblenden“ oder den Filter „Übung“.
import { anmelden, expect, keinWaagrechtesScrollen, test } from "./helfer";

test.describe("Marken – Uhren-Deals", () => {
  test("Übungs-Deal zählt nicht unter „Verworfen“ und nicht in den Kennzahlen; Schalter blendet ihn ein @handy", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/marken/uhren/deals?f=verworfen");
    const liste = page.locator('[data-testid="deal-list"]');
    await expect(liste).toContainText("Abgelehnt Echt");
    await expect(liste).not.toContainText("Lernmodell");
    await expect(page.locator('[data-testid="deal-filter-verworfen"]')).toContainText("Verworfen · 1");
    await expect(page.locator('[data-testid="deal-filter-uebung"]')).toContainText("Übung · 1");
    const schalter = page.locator('[data-testid="deal-uebung-toggle"]');
    await expect(schalter).toContainText("Übungs-Deals einblenden (1)");
    await schalter.click();
    await expect(page).toHaveURL(/uebung=1/);
    await expect(liste).toContainText("Lernmodell");
    await expect(page.locator('[data-testid="deal-filter-verworfen"]')).toContainText("Verworfen · 2");
    await expect(page.locator('[data-testid="deal-uebung-hint"]')).toBeVisible();
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    expect(await keinWaagrechtesScrollen(page)).toBe(true);
    await schalter.click();
    await expect(liste).not.toContainText("Lernmodell");
    // Übersicht: Kennzahlen nur aus echten Deals (Testdaten: 1 echter verkauft, 1 echter gekauft)
    await page.goto("/marken/uhren");
    await expect(page.locator('[data-testid="flip-kpi-sold"]')).toContainText("1");
    await expect(page.locator('[data-testid="flip-kpi-capital"]')).toContainText("1 Uhr");
    await expect(page.locator('[data-testid="flip-kpi-note"]')).toContainText("Übungs-Deals zählen nicht mit");
  });
});
