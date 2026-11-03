// Push aufs Handy ohne Discord (Bauauftrag Push-Handy, Teil A; Abnahme 4) gegen den Web-Push-Nachbau der Testdienste.
// Das Push-Abo des Browsers wird nachgestellt (Playwright hat keinen echten Push-Dienst); den Abruf des Service Workers
// (= „zugestellt“) übernimmt die Prüfung selbst. Ob es am echten iPhone bei geschlossener App ankommt, prüft Ludwig.
import type { Page } from "@playwright/test";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

type Push = { pfad: string; vapid: boolean };
const pushes = async () => (await (await fetch(`${TD}/__push`)).json()) as Push[];
type Zeile = { id: string; art: string; zustand: string; push_gesendet: number; discord: boolean | null; zugestellt_am: string | null; aktionen: { link: string }[] | null };

/** Nachgestelltes Push-Abo im Browser: getSubscription liefert `alt`, subscribe ein neues Abo mit `neu`. */
const aboNachbau = (alt: string | null, neu: string) => `(() => {
  let abo = ${JSON.stringify(alt)} ? { endpoint: ${JSON.stringify(alt)}, unsubscribe: async () => { abo = null; return true; } } : null;
  const reg = { pushManager: {
    getSubscription: async () => abo,
    subscribe: async () => { abo = { endpoint: ${JSON.stringify(neu)}, unsubscribe: async () => { abo = null; return true; } }; return abo; },
  } };
  Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve(reg), configurable: true });
  Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true });
  Notification.requestPermission = async () => "granted";
})()`;

const berlinUhr = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

test.describe("Push aufs Handy", () => {
  test("Test-Push mit Zustellzeit, Deal-Push mit Warenkorb-Knopf + Protokoll, Arten aus, Ruhezeit → morgens, 3 Fehler = abgelaufen → neu angefordert", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const ep = `${TD}/push/ph-${m}`;
    const kaputt = `${TD}/push/kaputt-${m}`;
    const neuEp = `${TD}/push/neu-${m}`;
    await sql("insert into push_abos (tenant_id, user_id, endpoint, geraet) values ($1, $2, $3, 'Test-iPhone · App')", [T, INH, ep]);
    const prefs = (p: object) => sql(`update tenants set settings = jsonb_set(settings, '{benachrichtigungen,personen,${INH}}', $2::jsonb) where id = $1`, [T, JSON.stringify(p)]);
    const zeilen = async (art: string, seit: Date) => sql<Zeile>("select id, art, zustand, push_gesendet, discord, zugestellt_am, aktionen from meldungen where tenant_id = $1 and user_id = $2 and art = $3 and created_at >= $4 order by created_at desc", [T, INH, art, seit]);
    const abgeholt = async (p: Page) => (await p.request.get(`/api/push/neueste?endpoint=${encodeURIComponent(ep)}`)).json() as Promise<{ id?: string; titel: string; link: string; aktionen?: { aktion: string; titel: string; link: string }[] | null }>;
    try {
      await page.addInitScript(aboNachbau(ep, neuEp));
      await anmelden(page, "inhaber");

      // 1) Prüfseite: Test-Push an genau dieses Gerät, Zustellzeit sichtbar
      await page.goto("/einstellungen/benachrichtigungen");
      await expect(page.getByTestId("push-geraet-zeile").filter({ hasText: "Test-iPhone" })).toHaveAttribute("data-stand", "aktiv");
      await page.getByTestId("push-test").click();
      await expect(page.getByTestId("push-test-stand")).toContainText("warte auf Zustellung", { timeout: 15_000 });
      expect((await pushes()).some((p) => p.pfad === `/push/ph-${m}` && p.vapid)).toBe(true);
      // Andere Geräte bekommen den Test-Push nicht (Abruf ohne Abo-Adresse liefert ihn nicht)
      expect(((await (await page.request.get("/api/push/neueste")).json()) as { titel: string }).titel).not.toContain("Test-Push");
      const test1 = await abgeholt(page); // = Service Worker holt ab
      expect(test1.titel).toContain("Test-Push");
      await expect(page.getByTestId("push-test-stand")).toContainText("Zugestellt um", { timeout: 15_000 });

      // 2) Deal-Push mit Warenkorb-Knopf; Protokoll: Discord ja/nein, App-Push gesendet, zugestellt
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
      const deal = async (wort: string) => JSON.parse(await mcp.call("deal_eingang_pruefen", { text: `Push-Test ${wort} ${m}`, asin: "B0TESTDE01", ek: 2.1, menge: 20, quelle: `PH-Test ${wort} ${m}` })) as { id: string; pruefung: string; ampel: string | null };
      const t0 = new Date(Date.now() - 1000);
      const d1 = await deal("an");
      expect(d1.pruefung).toBe("fertig");
      test.skip(d1.ampel === "rot", "Testdienste liefern Rot – Deal-Push nur für Grün/Gelb");
      // Lugru-Deal aus Amazon.FR (wie „Kaufen mit einem Tap“): verknüpfen, neu prüfen → Push „In den Warenkorb (n)“
      await sql("insert into lugru_deals_historie (tenant_id, quelle, asin, titel, kanal, gepostet_am, shop, quellmarkt, zielmarkt, max_menge, ek_eur, gewinn_eur, eingang_id) values ($1, 'app', 'B0TESTDE01', $2, 'deals', now() + interval '30 minutes', 'Amazon.FR', 'FR', 'DE', 3, 2.10, 3.00, $3)", [T, `Testartikel PH ${m}`, d1.id]);
      await sql("update deal_eingaenge set push_am = null where id = $1", [d1.id]);
      await page.goto(`/deal-eingang/${d1.id}`);
      await Promise.all([aktion(page), page.getByRole("button", { name: "Neu prüfen" }).click()]);
      await expect.poll(async () => (await zeilen("deal", t0))[0]?.aktionen?.[0]?.link ?? "", { timeout: 30_000 }).toMatch(/^\/k\/\d+$/);
      const [z1] = await zeilen("deal", t0);
      expect(z1.zustand).toBe("gesendet");
      expect(z1.push_gesendet).toBeGreaterThanOrEqual(1);
      expect(z1.discord).not.toBeNull(); // Discord parallel (ja/nein), nicht abgeschaltet
      const d1Push = await abgeholt(page);
      expect(d1Push.id).toBe(z1.id);
      const wk = d1Push.aktionen?.find((a) => a.aktion === "warenkorb");
      expect(wk?.titel).toMatch(/^In den Warenkorb/);
      expect((await page.request.get(wk!.link, { maxRedirects: 0 })).headers().location).toContain("amazon.fr/gp/aws/cart/add.html?ASIN.1=B0TESTDE01");
      await page.goto("/einstellungen/benachrichtigungen");
      const zeile = page.locator(`[data-testid="protokoll-zeile"][data-art="deal"]`).first();
      await expect(zeile).toHaveAttribute("data-zustand", "gesendet");
      await expect(zeile.getByTestId("protokoll-zugestellt")).toContainText("✓");
      await expect(zeile.getByTestId("protokoll-discord")).toHaveText(/ja|nein/);

      // 3) Art „Deal“ aus → nur Protokoll, kein Push
      await page.getByTestId("art-deal").uncheck();
      await Promise.all([aktion(page), page.getByTestId("benachrichtigungen-speichern").click()]);
      await expect(page.getByTestId("benachrichtigungen-meldung")).toContainText("Gespeichert");
      const vorher = (await pushes()).filter((p) => p.pfad === `/push/ph-${m}`).length;
      const t1 = new Date(Date.now() - 1000);
      await deal("aus");
      expect((await zeilen("deal", t1))[0]?.zustand).toBe("ausgeschaltet");
      expect((await pushes()).filter((p) => p.pfad === `/push/ph-${m}`).length).toBe(vorher);

      // 4) Ruhezeit jetzt (±1 Std.) → Deal zurückgehalten; „jetzt ausliefern“ = Morgenbericht + Deal nachgereicht
      const jetzt = Date.now();
      await prefs({ aus: [], ruheVon: berlinUhr(new Date(jetzt - 3600_000)), ruheBis: berlinUhr(new Date(jetzt + 3600_000)) });
      const t2 = new Date(Date.now() - 1000);
      await deal("nachts");
      const [z3] = await zeilen("deal", t2);
      expect(z3.zustand).toBe("zurueckgehalten");
      expect((await pushes()).filter((p) => p.pfad === `/push/ph-${m}`).length).toBe(vorher);
      await page.goto("/einstellungen/benachrichtigungen");
      await Promise.all([aktion(page), page.getByTestId("jetzt-ausliefern").click()]);
      await expect(page.getByTestId("benachrichtigungen-meldung")).toContainText("Morgenbericht");
      expect((await sql<{ zustand: string }>("select zustand from meldungen where id = $1", [z3.id]))[0].zustand).toBe("ausgeliefert");
      expect((await zeilen("morgenbericht", t2))[0]?.zustand).toBe("gesendet");
      expect((await abgeholt(page)).id).toBe(z3.id); // die nachgereichte Meldung steht oben (mit ihren Knöpfen)

      // 5) Drei Fehlversuche → Abo „abgelaufen“; beim nächsten Öffnen der App wird neu angefordert
      await sql("insert into push_abos (tenant_id, user_id, endpoint, geraet) values ($1, $2, $3, 'Altes iPhone')", [T, INH, kaputt]);
      for (let i = 0; i < 3; i++) {
        const r = (await (await page.request.post("/api/push/test", { data: { endpoint: kaputt } })).json()) as { ok: boolean };
        expect(r.ok).toBe(false);
      }
      const [ab] = await sql<{ fehler_anzahl: number; abgelaufen_am: string | null }>("select fehler_anzahl, abgelaufen_am from push_abos where endpoint = $1", [kaputt]);
      expect(ab.fehler_anzahl).toBe(3);
      expect(ab.abgelaufen_am).not.toBeNull();
      expect(((await (await page.request.get(`/api/push/abo?endpoint=${encodeURIComponent(kaputt)}`)).json()) as { stand: string }).stand).toBe("abgelaufen");
      const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
      const handy = await ctx.newPage();
      await handy.addInitScript(aboNachbau(kaputt, neuEp));
      await anmelden(handy, "inhaber");
      await expect.poll(async () => (await sql("select 1 from push_abos where endpoint = $1 and user_id = $2 and abgelaufen_am is null", [neuEp, INH])).length, { timeout: 15_000 }).toBe(1);
      await ctx.close();
      // 410 vom Push-Dienst → sofort abgelaufen
      const weg = `${TD}/push/weg-${m}`;
      await sql("insert into push_abos (tenant_id, user_id, endpoint) values ($1, $2, $3)", [T, INH, weg]);
      await page.request.post("/api/push/test", { data: { endpoint: weg } });
      expect((await sql<{ abgelaufen_am: string | null }>("select abgelaufen_am from push_abos where endpoint = $1", [weg]))[0].abgelaufen_am).not.toBeNull();
      await page.goto("/einstellungen/benachrichtigungen");
      await expect(page.getByTestId("push-geraet-zeile").filter({ hasText: "Altes iPhone" })).toHaveAttribute("data-stand", "abgelaufen");
    } finally {
      await prefs({ ruheVon: "00:00", ruheBis: "00:00" });
      await sql("delete from push_abos where user_id = $1 and endpoint like $2", [INH, `%-${m}`]);
    }
  });
});
