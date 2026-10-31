// Formulare behalten Eingaben: nach einem Fehler bleibt alles stehen, nach dem Speichern zeigen Auswahlfelder den
// gespeicherten Wert (früher sprangen sie zurück, ein zweites Speichern schrieb den alten Wert zurück).
import { writeFileSync, mkdirSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { aktion, anmelden, expect, keinWaagrechtesScrollen, marke, test } from "./helfer";

const DIR = "test-results/dateien";
mkdirSync(DIR, { recursive: true });
const datei = (name: string, inhalt: string | Uint8Array) => {
  writeFileSync(`${DIR}/${name}`, inhalt);
  return `${DIR}/${name}`;
};
const anzahlDateien = (page: import("@playwright/test").Page, sel: string) => page.locator(sel).evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);

test.describe("Marken – Uhren-Deals", () => {
  test("Pflichtfeld-Fehler → Eingaben bleiben → speichern → neu laden → Status ändern → nochmals speichern → Status bleibt @handy", async ({ page }) => {
    await anmelden(page, "inhaber");
    const name = `Regression ${marke()}`;
    await page.goto("/marken/uhren/deals#neu");
    const neu = page.locator('[data-testid="deal-new"]');
    await neu.locator('[data-testid="f-practice"]').uncheck();
    await neu.locator('[data-testid="f-maker"]').fill("Testmarke");
    await neu.locator('[data-testid="f-model"]').fill(name);
    await Promise.all([page.waitForURL(/\/deals\/[0-9a-f-]{36}\?neu=1/), neu.locator("button[type=submit]").click()]);
    const f = page.locator('[data-testid="deal-edit"]');
    const speichern = async (erwartet: RegExp) => {
      await Promise.all([aktion(page), f.locator("button[type=submit]").click()]);
      await expect(f.locator('[data-testid="flip-notice"]')).toHaveText(erwartet);
    };
    // 1) Pflichtfeld fehlt
    await f.locator('[data-testid="f-status"]').selectOption("gekauft");
    await f.locator('[data-testid="f-taxMode"]').selectOption("differenz");
    await f.locator('[data-testid="f-askPrice"]').fill("3.000");
    await speichern(/Ankaufspreis/);
    // 2) Eingaben bleiben
    await expect(f.locator('[data-testid="f-status"]')).toHaveValue("gekauft");
    await expect(f.locator('[data-testid="f-taxMode"]')).toHaveValue("differenz");
    expect((await f.locator('[data-testid="f-askPrice"]').inputValue()).replace(/\D/g, "")).toBe("3000");
    // 3) speichern
    await f.locator('[data-testid="f-buyPrice"]').fill("2.800");
    await f.locator('[data-testid="f-buyDate"]').fill("2026-10-01");
    await speichern(/Gespeichert/);
    await expect(f.locator('[data-testid="f-status"]')).toHaveValue("gekauft");
    // 4) neu laden
    await page.reload();
    await expect(f.locator('[data-testid="f-status"]')).toHaveValue("gekauft");
    // 5) Status ändern, speichern, ohne Änderung nochmals speichern
    await f.locator('[data-testid="f-status"]').selectOption("inserat");
    await f.locator('[data-testid="f-targetSell"]').fill("3.600");
    await speichern(/Gespeichert/);
    await expect(f.locator('[data-testid="f-status"]')).toHaveValue("inserat");
    await speichern(/Gespeichert/);
    // 6) Status bleibt – auch nach dem Neuladen
    await expect(f.locator('[data-testid="f-status"]')).toHaveValue("inserat");
    await page.reload();
    await expect(f.locator('[data-testid="f-status"]')).toHaveValue("inserat");
    expect(await keinWaagrechtesScrollen(page)).toBe(true);
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForURL(/\/marken\/uhren\/deals$/), page.click('[data-testid="deal-delete"]')]);
  });
});

test.describe("Aufträge – Lieferschein & Labels", () => {
  test("Falsche Datei: Fehler, Datei und Haken bleiben; Kanal bei „Offene Aufträge“ bleibt", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/auftraege/lieferschein");
    await page.setInputFiles('[data-testid="slip-file"]', datei("kein-pdf.pdf", "Das ist nur Text, kein PDF."));
    await page.check('[data-testid="slip-direct"]');
    await Promise.all([aktion(page), page.click('[data-testid="slip-read"]')]);
    await expect(page.locator('[data-testid="slip-error"]')).toContainText("kein PDF");
    expect(await anzahlDateien(page, '[data-testid="slip-file"]')).toBe(1);
    await expect(page.locator('[data-testid="slip-direct"]')).toBeChecked();
    await page.selectOption('[data-testid="slip-channel"]', "alle");
    await page.uncheck('[data-testid="slip-refresh"]');
    await Promise.all([aktion(page), page.click('[data-testid="slip-load-open"]')]);
    await expect(page.locator('[data-testid="slip-load-open"]')).toBeEnabled();
    await expect(page.locator('[data-testid="slip-channel"]')).toHaveValue("alle");
    await expect(page.locator('[data-testid="slip-refresh"]')).not.toBeChecked();
  });

  test("Vorschau: alle „bitte prüfen“ → Fehler, Auswahl je Bestellung bleibt", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/auftraege/lieferschein");
    await page.selectOption('[data-testid="slip-channel"]', "alle");
    await page.uncheck('[data-testid="slip-refresh"]');
    await Promise.all([aktion(page), page.click('[data-testid="slip-load-open"]')]);
    const wahl = page.locator('[data-testid="slip-choice"]');
    await expect(wahl.first()).toBeVisible();
    const n = await wahl.count();
    expect(n).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < n; i++) await wahl.nth(i).selectOption("pruefen");
    await Promise.all([aktion(page), page.click('[data-testid="slip-create"]')]);
    await expect(page.locator('[data-testid="slip-error"]')).toContainText("Keine Sendung");
    expect(await wahl.evaluateAll((s) => s.map((x) => (x as HTMLSelectElement).value))).toEqual(Array(n).fill("pruefen"));
  });

  test("Gewichte: unklare Eingabe bleibt stehen, gültige Zeile zeigt gespeicherte Werte, neue Zeile leert sich nach Erfolg", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/auftraege/lieferschein");
    const zeile = (sku: string) => page.locator(`[data-testid="slip-weight"][data-sku="${sku}"]`);
    const gewicht = (sku: string) => zeile(sku).locator('input[aria-label="Gewicht je Stück in kg"]');
    await zeile("TEST-SOCKEN").locator('[data-testid="slip-shipfrom"]').selectOption("prep");
    await gewicht("TEST-TASSE").fill("abc");
    await Promise.all([aktion(page), page.click('[data-testid="slip-save-weights"]')]);
    await expect(page.locator('[data-testid="slip-note"]')).toContainText("Nicht verstanden");
    await expect(page.locator('[data-testid="slip-note"]')).toContainText("1 Artikel gespeichert");
    await expect(gewicht("TEST-TASSE")).toHaveValue("abc");
    await expect(zeile("TEST-SOCKEN").locator('[data-testid="slip-shipfrom"]')).toHaveValue("prep");
    // korrigieren, zurückstellen, neuen Artikel anlegen → Erfolg leert die Zeile „neu“
    await gewicht("TEST-TASSE").fill("0,45");
    await zeile("TEST-SOCKEN").locator('[data-testid="slip-shipfrom"]').selectOption("");
    await page.locator('[data-testid="slip-weight-new"] input[placeholder="SKU"]').fill("TEST-NEU-FORM");
    await page.locator('[data-testid="slip-weight-new"] input[aria-label="Gewicht je Stück"]').fill("250 g");
    await Promise.all([aktion(page), page.click('[data-testid="slip-save-weights"]')]);
    await expect(page.locator('[data-testid="slip-note"]')).not.toContainText("Nicht verstanden");
    await expect(page.locator('[data-testid="slip-weight-new"] input[placeholder="SKU"]')).toHaveValue("");
    await expect(gewicht("TEST-NEU-FORM")).toHaveValue("0,25");
    await expect(gewicht("TEST-TASSE")).toHaveValue("0,45");
    await page.reload();
    await expect(zeile("TEST-SOCKEN").locator('[data-testid="slip-shipfrom"]')).toHaveValue("");
  });
});

test.describe("Import, Posteingang, Buchhaltung – Uploads", () => {
  test("Import: unbekannte Datei → Fehler, Datei bleibt ausgewählt", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/import");
    await page.setInputFiles("#files", datei("unbekannt.csv", "spalte_a;spalte_b\n1;2\n"));
    await Promise.all([aktion(page), page.click('[data-testid="import-form"] button[type=submit]')]);
    await expect(page.locator(".notice-error").first()).toContainText("Format nicht erkannt");
    expect(await anzahlDateien(page, "#files")).toBe(1);
  });

  test("Posteingang: .eml hochladen → Rückmeldung, Auswahl leer", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/posteingang");
    await page.setInputFiles("#eml", datei("test.eml", "From: test@example.org\r\nTo: info@example.org\r\nSubject: Testmail ohne Bezug\r\n\r\nHallo.\r\n"));
    await Promise.all([aktion(page), page.click('[data-testid="eml-upload"] button[type=submit]')]);
    await expect(page.locator('[data-testid="eml-upload"] .notice')).toContainText("ignoriert");
    expect(await anzahlDateien(page, "#eml")).toBe(0);
  });

  test("Rechnungen: Upload leert nach Erfolg; Sammelbearbeitung behält Auswahl bei Fehlschlag", async ({ page }) => {
    await anmelden(page, "inhaber");
    const doc = await PDFDocument.create();
    const pg = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    ["Testlieferant GmbH", `Rechnung Nr. E2E-${marke()}`, "Datum: 01.10.2026", "1 x Testartikel 10,00 EUR", "Summe brutto 11,90 EUR"].forEach((t, i) => pg.drawText(t, { x: 50, y: 780 - i * 20, size: 12, font }));
    await page.goto("/rechnungen?ansicht=alle");
    await page.setInputFiles("#inv-files", datei("rechnung.pdf", await doc.save()));
    await Promise.all([aktion(page), page.click('[data-testid="inv-upload"] button[type=submit]')]);
    await expect(page.locator('[data-testid="inv-upload"] .notice')).toContainText("1 von 1", { timeout: 60_000 });
    expect(await anzahlDateien(page, "#inv-files")).toBe(0);
    await page.reload();
    const box = page.locator('[data-testid="inv-table"] input[name="ids"]').first();
    await box.check();
    await Promise.all([aktion(page), page.click('[data-testid="inv-bulk-bar"] button[value="kein-duplikat"]')]);
    await expect(page.locator('[data-testid="inv-bulk-result"]')).toContainText("übersprungen");
    await expect(box).toBeChecked();
    await expect(page.locator('[data-testid="inv-bulk-count"]')).toContainText("1 ausgewählt");
    page.once("dialog", (d) => d.dismiss());
    await page.click('[data-testid="inv-bulk-bar"] button[value="ignorieren"]');
    await expect(box).toBeChecked();
    await Promise.all([aktion(page), page.click('[data-testid="inv-bulk-bar"] button[value="pruefen"]')]);
    await expect(page.locator('[data-testid="inv-bulk-result"]')).toContainText("geprüft");
    await expect(box).not.toBeChecked();
  });
});

test.describe("Amazon – FBA-Sendung scannen, Bestand – Inventur", () => {
  test("Scanner: unbekannter Code → Fehler; gültiger Code bucht; Scanfeld leert sich, Karton-Auswahl bleibt", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/inbound");
    await page.getByText("Test-FBA-Sendung 1").first().click();
    await page.waitForURL(/\/inbound\/[0-9a-f-]{36}/);
    const karton = page.locator('[data-testid="inbound-box"]');
    await karton.selectOption({ label: "2" });
    const karton2 = await karton.inputValue();
    await page.fill("#code", "GIBT-ES-NICHT");
    await Promise.all([aktion(page), page.keyboard.press("Enter")]);
    await expect(page.locator(".notice-error")).toContainText("nicht gefunden");
    await expect(page.locator("#code")).toHaveValue("");
    await expect(karton).toHaveValue(karton2);
    await page.fill("#qty", "3");
    await page.fill("#code", "X00TEST0001");
    await Promise.all([aktion(page), page.keyboard.press("Enter")]);
    await expect(page.locator(".notice-ok")).toContainText("+3");
    await expect(page.locator(".notice-ok")).toContainText("3 / 10");
    await expect(page.locator("#code")).toHaveValue("");
    await expect(page.locator("#qty")).toHaveValue("1");
    await expect(karton).toHaveValue(karton2);
  });

  test("Inventur-Scanner: bucht +1 und leert das Feld für den nächsten Scan", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/bestand");
    await page.getByText("Testinventur Regal A").first().click();
    await page.waitForURL(/\/bestand\/inventur\/[0-9a-f-]{36}/);
    await page.fill("#cc", "TEST-TASSE");
    await Promise.all([aktion(page), page.keyboard.press("Enter")]);
    await expect(page.locator(".notice-ok")).toContainText("+1 TEST-TASSE");
    await expect(page.locator("#cc")).toHaveValue("");
  });
});
