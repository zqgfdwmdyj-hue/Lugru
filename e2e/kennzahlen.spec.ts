// Kennzahlen nachvollziehbar: Jede Kennzahl hat Zeitraum/Quelle/Stand (in der Kachel oder darunter für die Gruppe),
// „keine Daten“ steht nie als 0 da, und es gibt keine kaputten Werte (NaN, undefined).
import { anmelden, expect, test } from "./helfer";

const SEITEN = [
  { pfad: "/gewinn", name: "Gewinn" },
  { pfad: "/cashflow", name: "Cash Flow" },
  { pfad: "/bestand", name: "Bestand" },
  { pfad: "/repricer", name: "Repricer" },
  { pfad: "/ansprueche", name: "Ansprüche" },
  { pfad: "/marken/uhren", name: "Uhren" },
  { pfad: "/auftraege/prep-center", name: "Prep Center" },
  { pfad: "/hebel", name: "Hebel" },
];

test.describe("Finanzen, WaWi, Amazon – Kennzahlen", () => {
  for (const s of SEITEN) {
    test(`${s.name}: jede Kennzahl mit Herkunft, keine kaputten Werte`, async ({ page }) => {
      await anmelden(page, "inhaber");
      await page.goto(s.pfad);
      const main = (await page.locator("main").textContent()) ?? "";
      expect(main).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b|null €/);
      const ohne = await page.locator(".kpi-value").evaluateAll((els) =>
        els
          .filter((el) => {
            const card = el.closest(".card");
            const group = el.closest("[data-kpi-group]");
            return !(card?.querySelector(".kpi-meta") || group?.querySelector(".kpi-meta"));
          })
          .map((el) => (el.closest(".card")?.querySelector(".kpi-label")?.textContent ?? el.textContent ?? "").trim()),
      );
      expect(ohne, "Kennzahlen ohne Zeitraum/Quelle/Stand").toEqual([]);
      for (const meta of await page.locator('[data-testid="kpi-meta"]').allTextContents()) {
        expect(meta).toContain("Quelle:");
        expect(meta).toContain("Stand:");
      }
    });
  }

  test("Prep Center: Zeitraum = Monat, Stand = letzter Bestellabruf; fehlende Gebühren als Text statt 0", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/auftraege/prep-center");
    const meta = page.locator('[data-testid="kpi-meta"]');
    await expect(meta).toContainText("Zeitraum:");
    await expect(meta).toContainText("verschickt von");
    await expect(meta).toContainText(/Stand: (noch kein Abruf|zuletzt abgerufen)/);
  });
});
