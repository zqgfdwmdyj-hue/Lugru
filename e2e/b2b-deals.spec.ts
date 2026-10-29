// B2B-Deals: Deal anlegen → Prognose je Land → Rechenhilfe → Freischalten (nur mit Vertriebsfreigabe) → Discord →
// Kunden mit VIES-Prüfung einladen → im Kundenportal reservieren (Mengengrenzen, „fast weg“, ausverkauft) →
// Portal sieht nur eigene Vorgänge. Alle Firmen, Nummern und Adressen sind erfunden.
import type { Browser, Page } from "@playwright/test";
import { TD } from "./env";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

const plus = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + n * 86400_000));
const discord = async (): Promise<{ content: string }[]> => (await fetch(`${TD}/__discord`)).json();

async function dealAnlegen(page: Page, o: { asin: string; lieferant: string; ek: string; preis: string; moq?: string; max?: string; maxJe?: string; min?: string }) {
  await page.goto("/b2b/neu");
  await page.fill('[data-testid="deal-asin"]', o.asin);
  await page.selectOption("#f-supplierId", { label: o.lieferant });
  await page.fill('[data-testid="deal-ek"]', o.ek);
  if (o.moq) await page.fill("#f-moqLieferant", o.moq);
  await page.fill('[data-testid="deal-preis"]', o.preis);
  await page.fill('[data-testid="deal-frist"]', plus(7));
  if (o.max) await page.fill('[data-testid="deal-max"]', o.max);
  if (o.maxJe) await page.fill("#f-maxProKunde", o.maxJe);
  if (o.min) await page.fill("#f-mindestmengeKunde", o.min);
  await page.click('[data-testid="deal-anlegen"]');
  await page.waitForURL(/\/b2b\/[0-9a-f-]{36}/);
  return page.url().split("?")[0].split("/").pop()!;
}

/** Kunden einladen (Link im Seller-System), im eigenen Fenster Passwort setzen → angemeldet im Portal. */
async function kundeImPortal(page: Page, browser: Browser, firma: string, mitVies = false) {
  await page.goto("/b2b/kunden");
  await page.getByRole("link", { name: firma }).click();
  await page.waitForURL(/\/b2b\/kunden\/[0-9a-f-]{36}/);
  if (mitVies) {
    await page.click('[data-testid="ust-pruefen"]');
    await expect(page.locator('[data-testid="ust-status"]')).toContainText("gültig");
    await expect(page.locator('[data-testid="ust-status"]')).toContainText("Kennung WAPITEST");
    await expect(page.locator("main")).toContainText("Reverse Charge");
  }
  await Promise.all([aktion(page), page.click('[data-testid="einladen"]')]);
  const link = (await page.locator('[data-testid="einladung-link"]').textContent())!.trim();
  expect(link).toMatch(/\/portal\/einladung\/[A-Za-z0-9_-]+$/);
  const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
  const p = await ctx.newPage();
  await p.goto(link);
  await p.fill("#pw1", "Kunden-Test-Passwort-1");
  await p.fill("#pw2", "Kunden-Test-Passwort-1");
  await Promise.all([p.waitForURL(/\/portal\?willkommen=1/), p.click('[data-testid="passwort-festlegen"]')]);
  // Link ist verbraucht
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await expect(p2.locator('[data-testid="einladung-ungueltig"]')).toBeVisible();
  await p2.close();
  return p;
}

async function reserviere(p: Page, dealId: string, menge: number) {
  await p.goto(`/portal/deals/${dealId}`);
  await p.fill('[data-testid="reservieren-menge"]', String(menge));
  await p.check('[data-testid="reservieren-bedingungen"]');
  await Promise.all([aktion(p), p.click('[data-testid="reservieren-absenden"]')]);
  return p.locator('[data-testid="reservieren-ergebnis"]');
}

test.describe("B2B-Deals", () => {
  test.beforeEach(({ page }) => {
    page.on("dialog", (d) => d.accept());
  });

  test("Freischalten nur mit Vertriebsfreigabe des Lieferanten", async ({ page }) => {
    await anmelden(page, "inhaber");
    const id = await dealAnlegen(page, { asin: `B0SEL${marke()}`, lieferant: "Test-Selektiv GmbH (erfunden) (TESTSEL)", ek: "4,00", preis: "7,00" });
    await expect(page.locator('[data-testid="freischalt-hindernisse"]')).toContainText("Vertriebsfreigabe");
    await expect(page.locator('[data-testid="freischalten"]')).toHaveCount(0);
    // Freigabe eintragen – ohne Nachweis abgelehnt, mit Nachweis gespeichert
    await page.getByRole("link", { name: /Im Lieferanten-Profil klären/ }).click();
    await page.selectOption('[data-testid="p-wiederverkaufErlaubt"]', "ja");
    await page.selectOption('[data-testid="p-marktplatzErlaubt"]', "ja");
    await page.click('[data-testid="profil-speichern"]');
    await expect(page.locator('[data-testid="profil-meldung"]')).toContainText("woher die Freigabe stammt");
    await page.selectOption('[data-testid="p-wiederverkaufErlaubt"]', "ja");
    await page.selectOption('[data-testid="p-marktplatzErlaubt"]', "ja");
    await page.fill('[data-testid="p-vertriebQuelle"]', "Testmail (erfunden)");
    await page.click('[data-testid="profil-speichern"]');
    await expect(page.locator('[data-testid="profil-meldung"]')).toContainText("Gespeichert");
    await page.goto(`/b2b/${id}`);
    await expect(page.locator('[data-testid="freischalten"]')).toBeVisible();
    // zurücksetzen für andere Läufe
    await sql("update lieferanten_profile set wiederverkauf_erlaubt = null, marktplatz_erlaubt = null where supplier_id = (select id from suppliers where code = 'TESTSEL')");
  });

  test("Deal mit 3 Kunden: Prognose, Rechenhilfe, Discord, VIES, Einladung, Reservieren mit Grenzen, Portal isoliert", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await anmelden(page, "inhaber");
    const asin = `B0E2E${marke()}`;
    const id = await dealAnlegen(page, { asin, lieferant: "Test-Großhandel (erfunden) (TESTGH)", ek: "6,37", preis: "11,50", moq: "40", max: "60", maxJe: "30", min: "10" });
    const [{ nr }] = await sql<{ nr: number }>("select nr from deals where id = $1", [id]);
    // Prognose je Land (Keepa-Nachbau DE/FR/IT/ES, Amazon-Nachbau NL) läuft im Hintergrund
    await expect(page.locator('[data-testid="rechner-laender"] tr[data-land="DE"]')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('[data-testid="rechner-laender"] tr[data-land="NL"]')).toBeVisible();
    await expect(page.locator('[data-testid="deal-titel"]')).toContainText(`Testprodukt ${asin}`);
    // Rechenhilfe live: zu niedriger Preis → wir im Minus
    await page.fill('[data-testid="rechner-preis"]', "5");
    await expect(page.locator('[data-testid="rechner-warnungen"]')).toContainText("Unser Verdienst ist negativ");
    await page.fill('[data-testid="rechner-preis"]', "11,50");
    await expect(page.locator('[data-testid="rechner-verdienst"]')).toContainText("5,13 €");
    await Promise.all([page.waitForURL(/meldung=preis/), page.click('[data-testid="preis-speichern"]')]);
    // Freischalten → offen, Discord „neu“
    await Promise.all([page.waitForURL(/meldung=/), page.click('[data-testid="freischalten"]')]);
    await expect(page.locator('[data-testid="deal-status"]')).toHaveText("offen");
    await expect(page.locator('[data-testid="deal-meldung"]')).toContainText("Discord gemeldet");
    await expect.poll(async () => (await discord()).some((x) => x.content.includes("Neuer Deal") && x.content.includes(`Deal #${nr}`))).toBe(true);
    // Deal-Blatt als PDF (ohne EK)
    const pdf = await page.request.get(`/b2b/${id}/blatt`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

    // Kunde 1: Frankreich, USt-IdNr. per VIES gültig → Reverse Charge
    const paris = await kundeImPortal(page, browser, "Testhandel Paris SARL", true);
    await expect(paris.locator('[data-testid="portal-deal"]', { hasText: asin })).toBeVisible();
    await paris.locator('[data-testid="portal-deal"]', { hasText: asin }).click();
    await expect(paris.locator('[data-testid="portal-preis"]')).toHaveText("11,50 €");
    await expect(paris.locator("main")).toContainText("Reverse Charge");
    await expect(paris.locator("main")).not.toContainText("6,37");
    await expect(await reserviere(paris, id, 20)).toContainText("Reserviert: 20 Stück");

    // Kunde 2: über die Grenze je Kunde, dann 30 → 50 von 60 vergeben → „fast weg“
    const nord = await kundeImPortal(page, browser, "Testhändler Nord GmbH");
    await expect(await reserviere(nord, id, 40)).toContainText("Höchstens 30 Stück je Kunde");
    await expect(await reserviere(nord, id, 30)).toContainText("Reserviert: 30 Stück");
    await expect.poll(async () => (await discord()).some((x) => x.content.includes("Fast weg") && x.content.includes(`Deal #${nr}`) && x.content.includes("noch 10"))).toBe(true);

    // Kunde 3: mehr als frei → Hinweis; Rest → ausverkauft, Deal schließt, Discord „geschlossen“
    const sued = await kundeImPortal(page, browser, "Testshop Süd e.K.");
    await expect(await reserviere(sued, id, 20)).toContainText("Nur noch 10 Stück frei");
    await reserviere(sued, id, 10);
    // Ausverkauft → Deal schließt sofort, das Formular verschwindet; die eigene Reservierung bleibt sichtbar.
    await expect(sued.locator('[data-testid="portal-meine"]')).toContainText("10 Stück");
    await expect.poll(async () => (await sql<{ status: string }>("select status from deals where id = $1", [id]))[0].status).toBe("geschlossen");
    await expect.poll(async () => (await discord()).some((x) => x.content.includes("Deal geschlossen") && x.content.includes(`Deal #${nr}`))).toBe(true);

    // Steuer je Reservierung: nur der französische Kunde mit geprüfter USt-IdNr. ohne USt
    const rc = await sql<{ firma: string; reverse_charge: boolean; menge: number }>("select k.firma, r.reverse_charge, r.menge from deal_reservierungen r join b2b_kunden k on k.id = r.kunde_id where r.deal_id = $1 order by k.firma", [id]);
    expect(rc.map((r) => [r.firma, r.reverse_charge, r.menge])).toEqual([
      ["Testhandel Paris SARL", true, 20],
      ["Testhändler Nord GmbH", false, 30],
      ["Testshop Süd e.K.", false, 10],
    ]);

    // Portal isoliert: nur eigene Reservierungen, kein Zugang ins Seller-System
    await paris.goto("/portal/reservierungen");
    await expect(paris.locator('[data-testid="portal-reservierungen"] tbody tr')).toHaveCount(1);
    await expect(paris.locator("main")).not.toContainText("Nord");
    await paris.goto("/b2b");
    await expect(paris).toHaveURL(/\/login/);
    // Deal-Blatt mit EK-freien Daten trotzdem nur für Mitarbeiter: ohne deren Anmeldung → Umleitung zum Login
    const fremd = await paris.request.get(`/b2b/${id}/blatt`, { maxRedirects: 0 });
    expect([302, 303, 307, 401]).toContain(fremd.status());
    expect(fremd.headers()["content-type"] ?? "").not.toContain("application/pdf");

    // Seller-System: drei Reservierungen, Deal geschlossen
    await page.goto(`/b2b/${id}`);
    await expect(page.locator('[data-testid="deal-status"]')).toHaveText("geschlossen");
    await expect(page.locator('[data-testid="reservierungen"] tbody tr')).toHaveCount(3);
    await expect(page.locator('[data-testid="deal-reserviert"]')).toContainText("60");
    await expect(page.locator('[data-testid="deal-reserviert"]')).toContainText("✓ erreicht");
  });

  test("Portal: falsches Passwort, gesperrter Zugang, abgemeldet ohne Cookie", async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto("/portal");
    await expect(p).toHaveURL(/\/portal\/login/);
    await p.fill("#email", "kunde-nord@example.invalid");
    await p.fill("#passwort", "falsch-falsch-falsch");
    await Promise.all([aktion(p), p.click('[data-testid="portal-anmelden"]')]);
    await expect(p.locator('[data-testid="portal-login-fehler"]')).toContainText("stimmt nicht");
    // Mitarbeiter-Anmeldung gilt im Portal nicht
    await anmelden(page, "inhaber");
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/login/);
  });
});
