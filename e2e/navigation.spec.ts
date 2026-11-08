// Menü-Umbau 06.11. (seller-system-menue-umbau, Abschnitt 9): 11 Gruppen mit Untergruppen, Akkordeon, fester Kopf mit
// Favoriten und Zähler-Chips, eingeklappter Modus mit Flyout, Zustand gemerkt, Strg+K mit Gruppe › Untergruppe,
// Einstellungen als Reiter, Rollen wie vorher; alte Adressen gültig; am Handy Schublade + Tab-Leiste.
import { NAV, navOrt, NEBENSEITEN } from "../src/lib/nav";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

const REIHENFOLGE = ["heute", "einkauf", "amazon", "marktplaetze", "lager", "finanzen", "b2b", "marken", "team", "privat", "einstellungen"];
const VOLLBILD = new Set(["/rechnungsstation"]); // Kamera-Station läuft absichtlich ohne Seitenleiste (mit Zurück-Link)

test.describe("Navigation links", () => {
  test("Abnahme 1–3: jede Seite unter ihrem Pfad erreichbar, genau ein Eintrag oder Reiter, ihre Gruppe und Untergruppe offen, Eintrag markiert", async ({ page }) => {
    test.setTimeout(600_000);
    await anmelden(page, "inhaber");
    await page.context().clearCookies({ name: "nav-open" });
    const seiten = NAV.flatMap((s) => s.items.map((it) => ({ href: it.href, gruppe: s.key, unter: it.unter ?? null, label: it.label })));
    const neben = NEBENSEITEN.filter((n) => !n.href.includes("#")).map((n) => n.href);
    const leiste = page.getByTestId("seitenleiste");
    for (const s of seiten) {
      const r = await page.goto(s.href);
      expect(r?.status(), s.href).toBe(200);
      if (VOLLBILD.has(s.href)) {
        await expect(page.getByRole("link", { name: /Seller-System/ })).toBeVisible();
        continue;
      }
      // Genau eine Gruppe offen – die der Seite –, Untergruppe offen, Eintrag markiert
      await expect(leiste.locator(".nav-group.open"), s.href).toHaveCount(1);
      await expect(leiste.locator(".nav-group.open")).toHaveAttribute("data-section", s.gruppe);
      if (s.unter) await expect(leiste.locator(`[data-section="${s.gruppe}"] .nav-unter[data-unter="${s.unter}"] > .nav-unter-head`), s.href).toHaveAttribute("aria-expanded", "true");
      await expect(leiste.locator(`[data-section="${s.gruppe}"] .nav-items .nav-link.active > span`).first(), s.href).toHaveText(s.label);
    }
    // Seiten ohne eigenen Eintrag: erreichbar, als Reiter bzw. unter ihrer Hauptseite markiert
    for (const href of neben) {
      const r = await page.goto(href);
      expect(r?.status(), href).toBe(200);
    }
    await page.goto("/anbindungen");
    await expect(leiste.locator(".nav-group.open")).toHaveAttribute("data-section", "einstellungen");
    await expect(page.getByTestId("sub-tabs").locator(".area-tab.active")).toHaveText("Anbindungen");
    await page.goto("/ebay?ansicht=artikel");
    await expect(leiste.locator('[data-section="marktplaetze"] .nav-link.active > span')).toHaveText("eBay");
  });

  test("Abnahme 4–6: Akkordeon, Untergruppen gemerkt, ≤ 8 Zeilen je Block, alles zu passt in 715 px, fester Kopf, Strg+K mit Gruppe", async ({ page }) => {
    test.setTimeout(240_000);
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const prefsVorher = (await sql<{ prefs: Record<string, unknown> }>("select prefs from memberships where tenant_id = $1 and user_id = $2", [T, INH]))[0].prefs;
    await sql("update memberships set prefs = prefs - 'favorites' where tenant_id = $1 and user_id = $2", [T, INH]);
    try {
      await page.setViewportSize({ width: 1280, height: 715 });
      await anmelden(page, "inhaber");
      await page.context().clearCookies({ name: "nav-open" });
      await page.goto("/cashflow");
      const leiste = page.getByTestId("seitenleiste");
      expect(await leiste.locator(".nav-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")))).toEqual(REIHENFOLGE);
      await expect(leiste.locator(".nav-group.open")).toHaveAttribute("data-section", "finanzen");

      // Akkordeon: eine andere Gruppe öffnen schließt die erste
      await leiste.locator('[data-section="einkauf"] .nav-head').click();
      await expect(leiste.locator(".nav-group.open")).toHaveCount(1);
      await expect(leiste.locator('[data-section="einkauf"] .nav-head')).toHaveAttribute("aria-expanded", "true");
      await expect(leiste.locator('[data-section="finanzen"] .nav-head')).toHaveAttribute("aria-expanded", "false");
      // Abnahme 5: offene Gruppe zeigt höchstens 8 Einträge, solange keine Untergruppe offen ist
      await expect(leiste.locator('[data-section="einkauf"] .nav-link:visible')).toHaveCount(8);
      await expect(leiste.locator('[data-section="einkauf"] .nav-unter-head')).toHaveText(/Lieferanten/);
      // Untergruppe öffnen → gemerkt; auf einer Seite ohne Gruppe öffnet sich die gemerkte Gruppe
      await leiste.locator('[data-section="einkauf"] .nav-unter-head').click();
      await expect(leiste.locator('[data-section="einkauf"] .nav-link:visible')).toHaveCount(13);
      await page.goto("/suche?q=test");
      await expect(page.getByTestId("seitenleiste").locator(".nav-group.open")).toHaveAttribute("data-section", "einkauf");
      await expect(page.getByTestId("seitenleiste").locator('[data-section="einkauf"] .nav-unter-head')).toHaveAttribute("aria-expanded", "true");
      // Seitenwechsel per Klick: Gruppe und Untergruppe des Ziels gehen auf, die andere zu
      await page.goto("/gewinn");
      await page.getByTestId("seitenleiste").locator('[data-section="amazon"] .nav-head').click();
      await page.getByTestId("seitenleiste").locator('[data-section="amazon"] [data-unter="angebote"] .nav-unter-head').click();
      await page.getByTestId("seitenleiste").getByRole("link", { name: "Repricer (BQool)" }).click();
      await page.waitForURL(/\/repricer/);
      await expect(page.getByTestId("seitenleiste").locator(".nav-group.open")).toHaveAttribute("data-section", "amazon");

      // Abnahme 4: alle Gruppen zu → ohne Scrollen sichtbar (11 Gruppenköpfe + fester Kopf) bei 715 px
      await page.goto("/b2b");
      await page.getByTestId("seitenleiste").locator('[data-section="b2b"] .nav-head').click();
      await expect(page.getByTestId("seitenleiste").locator(".nav-group.open")).toHaveCount(0);
      const passt = await page.locator(".nav-drawer").evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
      expect(passt.s, `Leiste ${passt.s} px hoch, sichtbar ${passt.c} px`).toBeLessThanOrEqual(passt.c + 1);
      await expect(page.getByTestId("nav-gruppen").locator(".nav-head")).toHaveCount(11);

      // Fester Kopf: Zähler-Chips bleiben oben, wenn die Gruppen scrollen
      await expect(page.getByTestId("nav-chip")).toHaveText([/Aufgaben/, /Amazon-ToDos/, /Posteingang/, /Belege/, /Ansprüche/]);
      // kompakt: ein bis zwei Zeilen
      expect(await page.getByTestId("nav-chip").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size)).toBeLessThanOrEqual(2);
      await page.getByTestId("seitenleiste").locator('[data-section="lager"] .nav-head').click();
      for (const u of ["lager", "versand", "retouren"]) await page.getByTestId("seitenleiste").locator(`[data-section="lager"] [data-unter="${u}"] .nav-unter-head`).click();
      const oben = await page.getByTestId("nav-counters").evaluate((e) => e.getBoundingClientRect().top);
      await page.locator(".nav-drawer").evaluate((e) => e.scrollTo(0, e.scrollHeight));
      expect(await page.locator(".nav-drawer").evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
      expect(Math.abs((await page.getByTestId("nav-counters").evaluate((e) => e.getBoundingClientRect().top)) - oben)).toBeLessThan(2);

      // Abnahme 6: Strg+K findet jede Seite und zeigt ihre neue Gruppe › Untergruppe
      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("befehls-suche")).toBeVisible();
      for (const s of NAV) {
        for (const it of s.items) {
          await page.getByTestId("bs-eingabe").fill(it.label);
          await expect(page.getByTestId("bs-treffer").filter({ hasText: it.label }).filter({ hasText: navOrt(s, it) }).first(), it.label).toBeVisible();
        }
      }
      for (const n of NEBENSEITEN) {
        await page.getByTestId("bs-eingabe").fill(n.label);
        await expect(page.getByTestId("bs-treffer").filter({ hasText: n.label }).filter({ hasText: n.wo }).first(), n.label).toBeVisible();
      }
      await page.getByTestId("bs-eingabe").fill("Angebote & Lager Repricer");
      await expect(page.getByTestId("bs-treffer").first()).toContainText("Amazon › Angebote & Lager");
      await page.getByTestId("bs-eingabe").press("Enter");
      await page.waitForURL(/\/repricer/);
      await expect(page.getByTestId("bs-knopf")).toContainText("Seite, ASIN, Aufgabe");
    } finally {
      await sql("update memberships set prefs = $3::jsonb where tenant_id = $1 and user_id = $2", [T, INH, JSON.stringify(prefsVorher ?? {})]);
    }
  });

  test("Favoriten (max. 8, per Ziehen sortiert), Zuletzt besucht, eingeklappter Modus mit Flyout, Einstellungen als Reiter, Prüfliste mit Leiste", async ({ page }) => {
    test.setTimeout(180_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const prefsVorher = (await sql<{ prefs: Record<string, unknown> }>("select prefs from memberships where tenant_id = $1 and user_id = $2", [T, INH]))[0].prefs;
    await sql("update memberships set prefs = (prefs - 'favorites') || jsonb_build_object('meldungenSeenAt', now()::text) where tenant_id = $1 and user_id = $2", [T, INH]);
    try {
      await anmelden(page, "inhaber");
      await page.context().clearCookies({ name: "nav-schmal" });
      await page.goto("/cashflow");
      // Favorit setzen → oben im festen Kopf, bleibt nach Neuladen
      await Promise.all([aktion(page), page.getByTestId("fav-toggle").click()]);
      await expect(page.getByTestId("nav-favorites")).toContainText("Liquidität");
      // Höchstens 8: mit 8 Favoriten ist der Stern auf einer anderen Seite gesperrt
      const acht = ["/gewinn", "/cashflow", "/hebel", "/kapital", "/verlust", "/buchhaltung", "/import", "/export"];
      await sql("update memberships set prefs = jsonb_set(prefs, '{favorites}', $3::jsonb) where tenant_id = $1 and user_id = $2", [T, INH, JSON.stringify(acht.map((href) => ({ href, label: `Fav ${href.slice(1)}` })))]);
      await page.goto("/b2b");
      await expect(page.getByTestId("nav-fav")).toHaveCount(8);
      await expect(page.getByTestId("fav-toggle")).toBeDisabled();
      // Ziehen: ersten Favoriten auf den dritten → Reihenfolge gespeichert
      await page.getByTestId("nav-fav").nth(0).dragTo(page.getByTestId("nav-fav").nth(2));
      await expect.poll(async () => (await sql<{ f: string }>("select prefs->'favorites'->2->>'href' as f from memberships where tenant_id = $1 and user_id = $2", [T, INH]))[0].f).toBe("/gewinn");
      await page.reload();
      await expect(page.getByTestId("nav-fav").nth(2)).toContainText("Fav gewinn");
      // Tastatur: Alt+↑ schiebt nach oben
      await page.getByTestId("nav-fav").nth(2).focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(async () => (await sql<{ f: string }>("select prefs->'favorites'->1->>'href' as f from memberships where tenant_id = $1 and user_id = $2", [T, INH]))[0].f).toBe("/gewinn");

      // Zuletzt besucht (nur in diesem Browser)
      await page.goto("/kapital");
      await expect(page.getByTestId("nav-zuletzt")).toBeVisible(); // Seite fertig (Besuch gemerkt), bevor es weitergeht
      await page.goto("/hebel");
      await page.getByTestId("nav-zuletzt").locator("summary").click();
      await expect(page.getByTestId("nav-zuletzt")).toContainText("Kapital-Ampel");

      // Eingeklappter Modus: nur Symbole (~56 px), Zeigen öffnet ein Flyout mit Einträgen und Untergruppen
      await page.getByTestId("nav-einklappen").click();
      await expect(page.getByTestId("seitenleiste")).toHaveClass(/schmal/);
      await page.reload();
      await expect.poll(() => page.getByTestId("seitenleiste").evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(64);
      await page.getByTestId("seitenleiste").locator('[data-section="amazon"] .nav-head').hover();
      const fly = page.getByTestId("nav-flyout");
      await expect(fly).toBeVisible();
      await expect(fly).toContainText("Angebote & Lager");
      // liegt über dem Inhalt (nicht von Karten verdeckt)
      expect(await fly.evaluate((e) => { const r = e.getBoundingClientRect(); return [0.25, 0.5, 0.75].every((f) => { const el = document.elementFromPoint(r.left + r.width * 0.6, r.top + r.height * f); return Boolean(el && e.contains(el)); }); })).toBe(true);
      await fly.getByRole("link", { name: "SAS-Programm" }).click();
      await page.waitForURL(/\/sas/);
      await expect(page.getByTestId("nav-flyout")).toHaveCount(0);
      // Tippen (Klick) öffnet das Flyout ebenfalls
      await page.getByTestId("seitenleiste").locator('[data-section="finanzen"] .nav-head').click();
      await expect(page.getByTestId("nav-flyout")).toContainText("Rechnungen");
      await page.keyboard.press("Escape");
      await page.getByTestId("nav-einklappen").click();
      await expect.poll(() => page.getByTestId("seitenleiste").evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(200);

      // Einstellungen: ein Menüeintrag, Unterseiten als Reiter, Abschnitte über die Sprungleiste
      await page.goto("/einstellungen");
      await expect(page.getByTestId("sub-tabs").locator(".area-tab")).toHaveText(["Allgemein", "Anbindungen", "KI-Assistent", "Hintergrund & Importe", "Geräte: Handy & Tesla", "Apple Watch", "Benachrichtigungen", "Shop-Profile", "Abholung", "Drucker", "Testumgebung"]);
      // Reiter „Hintergrund & Importe“: Abrufe, Amazon-Berichte, ArbitrageOne, BQool-Uploads – unter Anbindungen nur noch der Hinweis
      await page.getByTestId("sub-tabs").getByRole("link", { name: "Hintergrund & Importe" }).click();
      await page.waitForURL(/\/einstellungen\/hintergrund/);
      await expect(page.getByTestId("sub-tabs").locator(".area-tab.active")).toHaveText("Hintergrund & Importe");
      await expect(page.getByTestId("hintergrund-sprung").locator("a").first()).toHaveText("Hintergrund-Abrufe");
      await expect(page.getByTestId("hintergrund-abrufe").getByRole("button", { name: "Jetzt alles abrufen" })).toBeVisible();
      await page.getByTestId("sub-tabs").getByRole("link", { name: "Anbindungen" }).click();
      await page.waitForURL(/\/anbindungen/);
      await expect(page.getByTestId("hinweis-hintergrund").getByRole("link", { name: "Hintergrund & Importe" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Jetzt alles abrufen" })).toHaveCount(0);
      await page.goto("/einstellungen");
      await expect(page.getByTestId("einstellungen-sprungleiste").locator("a")).toHaveText(["Allgemein", "Ansprüche & Retouren", "B2B", "Preise", "Versand & Prep", "Postfächer & Rechnungen", "Shops", "Benutzer"]);
      await page.getByTestId("einstellungen-sprungleiste").getByRole("link", { name: "Benutzer" }).click();
      await expect(page).toHaveURL(/#benutzer$/);
      await page.getByTestId("sub-tabs").getByRole("link", { name: "Testumgebung" }).click();
      await page.waitForURL(/\/einstellungen\/testumgebung/);
      await expect(page.getByTestId("seitenleiste").locator('[data-section="einstellungen"] .nav-link.active')).toHaveCount(1);

      // Prüfliste der Rechnungsstation jetzt mit Seitenleiste
      await page.goto("/rechnungsstation/pruefen");
      await expect(page.getByTestId("seitenleiste")).toBeVisible();
      await expect(page.getByTestId("seitenleiste").locator('[data-section="finanzen"] [data-unter="rechnungen"] .nav-link.active > span')).toHaveText("Rechnungsstation: Prüfliste");

      // Privatbereich: dieselbe Leiste, Privat-Block offen, geschäftliche Gruppen zu, kein Favoriten-Kopf
      await page.goto("/privat");
      await expect(page.getByTestId("seitenleiste").locator('[data-section="privat"] .nav-head')).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("seitenleiste").locator('[data-section="einkauf"] .nav-head')).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("nav-favorites")).toHaveCount(0);
      await expect(page.getByTestId("back-to-business")).toBeVisible();
      expect(m).toBeTruthy();
    } finally {
      await sql("update memberships set prefs = $3::jsonb where tenant_id = $1 and user_id = $2", [T, INH, JSON.stringify(prefsVorher ?? {})]);
    }
  });

  test("Abnahme 7: Rollen wie vorher – VA ohne Privat, Geld und Einstellungen; Büro ohne Privat/Einstellungen", async ({ page }) => {
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: BUERO, areas }] = await sql<{ id: string; areas: string[] }>("select u.id, m.areas from users u join memberships m on m.user_id = u.id where u.email = 'buero'");
    await anmelden(page, "buero");
    await page.goto("/");
    const leiste = page.getByTestId("seitenleiste");
    await expect(leiste.locator('[data-section="privat"]')).toHaveCount(0);
    await expect(leiste.locator('[data-section="einstellungen"]')).toHaveCount(0);
    await sql("update memberships set areas = '[\"start\",\"amazon\",\"service\"]'::jsonb where tenant_id = $1 and user_id = $2", [T, BUERO]);
    try {
      await page.goto("/");
      for (const k of ["privat", "einstellungen", "b2b", "marken"]) await expect(leiste.locator(`[data-section="${k}"]`), k).toHaveCount(0);
      for (const h of ["/gewinn", "/cashflow", "/kapital", "/buchhaltung", "/einstellungen", "/anbindungen"]) await expect(leiste.locator(`a[href="${h}"]`), h).toHaveCount(0);
      // Finanzen nur mit der Rechnungsstation (Untergruppe Rechnungen), Amazon mit beiden Untergruppen
      await expect(leiste.locator('[data-section="finanzen"] .nav-link')).toHaveCount(2);
      await expect(leiste.locator('[data-section="amazon"] .nav-unter')).toHaveCount(2);
      await expect(page.getByTestId("nav-chip")).toHaveText([/Aufgaben/, /Ansprüche/]);
    } finally {
      await sql("update memberships set areas = $3::jsonb where tenant_id = $1 and user_id = $2", [T, BUERO, JSON.stringify(areas)]);
    }
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
    await expect(page.locator('.nav-drawer [data-section="einkauf"] .nav-head')).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('.nav-drawer [data-section="einkauf"]')).toContainText("Deal-Eingang");
  });
});
