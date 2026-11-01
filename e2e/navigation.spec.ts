// Navigation links (Bauauftrag 01.11., Abnahme 5): Seitenleiste mit Gruppen in fester Reihenfolge, einklappbar und
// gemerkt, Favoriten (max. 6) bleiben nach Neuladen, ⌘K/Strg+K-Suche (Seiten + Aufgaben), Glocke, Privat-Block nur mit
// Privat-Zugriff (im Privatbereich offen, geschäftliche Gruppen zu), alte Adressen gültig; am Handy Schublade + Tab-Leiste.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

const REIHENFOLGE = ["heute", "einkauf", "amazon", "marktplaetze", "finanzen", "produkte", "b2b", "marken", "delegation", "wissen", "privat", "einstellungen"];

test.describe("Navigation links", () => {
  test("Gruppen, Einklappen, gemerkter Zustand, ⌘K, Favoriten, Glocke, Privat-Block, alte Adressen", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const prefsVorher = (await sql<{ prefs: Record<string, unknown> }>("select prefs from memberships where tenant_id = $1 and user_id = $2", [T, INH]))[0].prefs;
    await sql("update memberships set prefs = (prefs - 'favorites') || jsonb_build_object('meldungenSeenAt', now()::text) where tenant_id = $1 and user_id = $2", [T, INH]);
    try {
      await anmelden(page, "inhaber");
      await page.context().clearCookies({ name: "nav-open" });
      await page.goto("/cashflow");
      const leiste = page.getByTestId("seitenleiste");
      // Reihenfolge laut Bauauftrag (Inhaber mit Privat-Zugriff sieht alle Gruppen)
      expect(await leiste.locator(".nav-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")))).toEqual(REIHENFOLGE);
      // Aktuelle Seite hervorgehoben, ihre Gruppe offen
      await expect(leiste.locator('[data-section="finanzen"] .nav-link.active > span').first()).toHaveText("Liquidität");
      await expect(leiste.locator('[data-section="finanzen"] .nav-head')).toHaveAttribute("aria-expanded", "true");
      // Gruppe öffnen → bleibt nach Neuladen offen (Cookie)
      await leiste.locator('[data-section="b2b"] .nav-head').click();
      await expect(leiste.locator('[data-section="b2b"] .nav-head')).toHaveAttribute("aria-expanded", "true");
      await page.reload();
      await expect(page.getByTestId("seitenleiste").locator('[data-section="b2b"] .nav-head')).toHaveAttribute("aria-expanded", "true");
      // Einklappen auf Symbole → gemerkt; wieder ausklappen
      await page.getByTestId("nav-einklappen").click();
      await expect(page.getByTestId("seitenleiste")).toHaveClass(/schmal/);
      await page.reload();
      await expect(page.getByTestId("seitenleiste")).toHaveClass(/schmal/);
      expect(await page.getByTestId("seitenleiste").evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(80);
      await page.getByTestId("nav-einklappen").click();
      await expect(page.getByTestId("seitenleiste")).not.toHaveClass(/schmal/);
      expect(await page.getByTestId("seitenleiste").evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(200);

      // Oben nur Suche, Stern, Glocke, Benutzer – keine zweite Menüzeile mit Bereichs-Reitern
      await expect(page.getByTestId("top-bar")).toBeVisible();
      await expect(page.getByTestId("area-tabs")).toHaveCount(0);

      // Favorit setzen → oben in der Leiste, bleibt nach Neuladen
      await Promise.all([aktion(page), page.getByTestId("fav-toggle").click()]);
      await expect(page.getByTestId("nav-favorites")).toContainText("Liquidität");
      await page.reload();
      await expect(page.getByTestId("nav-favorites")).toContainText("Liquidität");
      // Höchstens 6: mit 6 Favoriten ist der Stern auf einer anderen Seite gesperrt
      await sql("update memberships set prefs = jsonb_set(prefs, '{favorites}', $3::jsonb) where tenant_id = $1 and user_id = $2", [T, INH, JSON.stringify(["/gewinn", "/cashflow", "/hebel", "/kapital", "/verlust", "/buchhaltung"].map((href) => ({ href, label: href.slice(1) })))]);
      await page.goto("/b2b");
      await expect(page.getByTestId("nav-favorites").locator(".nav-link")).toHaveCount(6);
      await expect(page.getByTestId("fav-toggle")).toBeDisabled();

      // ⌘K/Strg+K: Seiten sofort, Aufgaben vom Server; Enter öffnet
      await sql("insert into tasks (tenant_id, title, status, priority, link) values ($1, $2, 'open', 'normal', '/kalender')", [T, `Navitest Aufgabe ${m}`]);
      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("befehls-suche")).toBeVisible();
      await page.getByTestId("bs-eingabe").fill("Liquid");
      await expect(page.getByTestId("bs-treffer").first()).toContainText("Liquidität");
      await page.getByTestId("bs-eingabe").fill(`Navitest Aufgabe ${m}`);
      await expect(page.getByTestId("bs-treffer").filter({ hasText: "Aufgabe" }).filter({ hasText: m })).toHaveCount(1);
      await page.getByTestId("bs-eingabe").fill("Bestellvorschl");
      await page.getByTestId("bs-eingabe").press("Enter");
      await page.waitForURL(/\/einkauf\/vorschlaege/);
      await expect(page.getByTestId("befehls-suche")).toHaveCount(0);
      // Knopf öffnet die Suche auch; Esc schließt
      await page.getByTestId("bs-knopf").click();
      await expect(page.getByTestId("befehls-suche")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("befehls-suche")).toHaveCount(0);

      // Glocke: neue Meldung zählt, Öffnen setzt sie auf gesehen
      await sql("insert into meldungen (tenant_id, user_id, titel, text, link) values ($1, $2, $3, 'Testmeldung', '/deal-eingang')", [T, INH, `Navitest Meldung ${m}`]);
      await page.goto("/b2b");
      await expect(page.getByTestId("glocke-zahl")).toBeVisible();
      await page.getByTestId("glocke").locator("summary").click();
      await expect(page.getByTestId("glocke")).toContainText(`Navitest Meldung ${m}`);
      await expect(page.getByTestId("glocke-zahl")).toHaveCount(0);
      await expect.poll(async () => (await sql<{ s: string | null }>("select prefs->>'meldungenSeenAt' as s from memberships where tenant_id = $1 and user_id = $2", [T, INH]))[0].s).not.toBeNull();

      // Alte Adressen gültig und richtig einsortiert
      for (const [pfad, gruppe, punkt] of [["/auftraege", "produkte", "Aufträge & Versand"], ["/deal-eingang/lugru", "einkauf", "Lugru Deals"], ["/calls", "wissen", "Calls (Consultant & Gruppe)"]] as const) {
        const r = await page.goto(pfad);
        expect(r?.status()).toBeLessThan(400);
        await expect(page.getByTestId("seitenleiste").locator(`[data-section="${gruppe}"] .nav-link.active > span`).first()).toHaveText(punkt);
      }

      // Privatbereich: dieselbe Leiste, Privat-Block offen, geschäftliche Gruppen zu
      await page.goto("/privat");
      await expect(page.getByTestId("seitenleiste").locator('[data-section="privat"] .nav-head')).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("seitenleiste").locator('[data-section="einkauf"] .nav-head')).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("back-to-business")).toBeVisible();
    } finally {
      await sql("update memberships set prefs = $3::jsonb where tenant_id = $1 and user_id = $2", [T, INH, JSON.stringify(prefsVorher ?? {})]);
      await sql("delete from tasks where tenant_id = $1 and title = $2", [T, `Navitest Aufgabe ${m}`]);
    }
  });

  test("Privat-Block nur mit Privat-Zugriff", async ({ page }) => {
    await anmelden(page, "buero");
    await page.goto("/");
    await expect(page.getByTestId("seitenleiste").locator('[data-section="privat"]')).toHaveCount(0);
    await expect(page.getByTestId("seitenleiste").locator('[data-section="einstellungen"]')).toHaveCount(0);
  });

  test("Handy: Tab-Leiste unten (Heute · Scan · Deals · Aufgaben · Mehr), „Mehr“ öffnet die Schublade @nur-handy", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/deal-eingang");
    const tabs = page.getByTestId("handy-tabs");
    await expect(tabs).toBeVisible();
    await expect(tabs.locator(".handy-tab")).toHaveText([/Heute/, /Scan/, /Deals/, /Aufgaben/, /Mehr/]);
    await expect(tabs.locator(".handy-tab.active")).toContainText("Deals");
    await tabs.getByTestId("handy-mehr").click();
    await expect(page.locator(".nav-drawer")).toBeInViewport();
    await expect(page.locator(".nav-drawer [data-section=\"einkauf\"]")).toBeVisible();
  });
});
