// B24: Browser-Automatik-Anmeldung gehärtet – Cookie-Banner und andere Feldnamen werden gefunden, eigene Feldnamen gehen
// vor, Browser-Prüfung (Cloudflare) wird klar gemeldet, und jeder Fehlschlag hat ein Bildschirmfoto mit Titel und
// Adresse unter /import/debug/… (nur Inhaber). Test-Nachbau der Anmeldeseiten, erfundene Zugänge.
import { alsPerson, anmelden, expect, sql, test } from "./helfer";
import { TD } from "./env";

test.describe("B24 – Anmeldung der Browser-Automatik", () => {
  test("Cookie-Banner + andere Feldnamen, eigener Selektor, Captcha, Seite ohne Formular mit Bildschirmfoto", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ config: vorher }] = await sql<{ config: Record<string, string> }>("select config from integrations where tenant_id = $1 and provider = 'bqool_web'", [T]);
    const setzen = (cfg: Record<string, string>) => sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'bqool_web'", [T, JSON.stringify({ ...vorher, ...cfg })]);
    const testen = async () => {
      // Erst weg von der Seite: gleiche Adresse mit „#“ lädt sonst nicht neu und die alte Meldung stünde noch da.
      await page.goto("about:blank");
      await page.goto("/anbindungen?p=bqool_web#bqool_web");
      await page.locator("#bqool_web").getByRole("button", { name: "Verbindung testen" }).click();
      const n = page.locator("#bqool_web .notice");
      await expect(n).toBeVisible({ timeout: 120_000 });
      return n;
    };
    try {
      await anmelden(page, "inhaber");

      // 1) Cookie-Banner verdeckt das Formular, E-Mail-Feld heißt „login_id“ (nur Platzhalter), Knopf „Log in“
      await setzen({ loginUrl: `${TD}/web-bqoolneu/login`, uploadUrl: `${TD}/web-bqoolneu/upload/amazonde` });
      let n = await testen();
      await expect(n).toContainText("Anmeldung ok");
      await expect(n).toContainText("DE: Upload-Seite erreichbar");

      // 2) Felder ohne erkennbare Namen: ohne eigenen Selektor nicht zu finden …
      await setzen({ loginUrl: `${TD}/web-sonder/login`, uploadUrl: `${TD}/web-sonder/upload/amazonde` });
      n = await testen();
      await expect(n).toContainText("Anmeldeformular nicht gefunden");
      await expect(n.getByTestId("debug-link")).toBeVisible();
      // … mit „Feld E-Mail“ aus der Anbindung (wird zuerst probiert) klappt es
      await setzen({ loginUrl: `${TD}/web-sonder/login`, uploadUrl: `${TD}/web-sonder/upload/amazonde`, feldEmail: "input[name=kennung]" });
      n = await testen();
      await expect(n).toContainText("Anmeldung ok");

      // 3) Browser-Prüfung (Cloudflare „Just a moment…“) → klare Meldung, kein Warten auf Felder
      await setzen({ loginUrl: `${TD}/web-captcha/login` });
      const t0 = Date.now();
      n = await testen();
      await expect(n).toContainText("verlangt eine Browser-Prüfung");
      await expect(n).toContainText("Datei-Weg");
      expect(Date.now() - t0).toBeLessThan(60_000);

      // 4) Seite ohne Formular → Meldung mit Bildschirmfoto, Titel und Adresse; Bild nur für Inhaber
      await setzen({ loginUrl: `${TD}/web-leer/login?token=geheim` });
      n = await testen();
      await expect(n).toContainText("Anmeldeformular nicht gefunden");
      await expect(n).toContainText("/web-leer/login");
      await expect(n).not.toContainText("geheim");
      const href = await n.getByTestId("debug-link").getAttribute("href");
      expect(href).toMatch(/^\/import\/debug\/[a-z0-9-]+\.png$/);
      const bild = await page.request.get(href!);
      expect(bild.status()).toBe(200);
      expect(bild.headers()["content-type"]).toBe("image/png");
      expect((await bild.body()).subarray(1, 4).toString()).toBe("PNG");
      const [eintrag] = await sql<{ url: string; fehler: string }>("select url, fehler from automatik_debug where tenant_id = $1 and name = $2", [T, href!.replace(/^\/import\/debug\/|\.png$/g, "")]);
      expect(eintrag.url).toMatch(/\/web-leer\/login$/);
      expect(eintrag.fehler).toContain("Anmeldeformular nicht gefunden");
      // Mitarbeiter (kein Inhaber) bekommt das Bild nicht
      const buero = await alsPerson(browser, "buero");
      const fremd = await buero.request.get(href!, { maxRedirects: 0 });
      expect(fremd.headers()["content-type"] ?? "").not.toBe("image/png");
      await buero.context().close();
    } finally {
      await sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'bqool_web'", [T, JSON.stringify(vorher)]);
    }
  });
});
