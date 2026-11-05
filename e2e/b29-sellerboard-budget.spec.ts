// Nachtrag B29 (05.11.): sellerboard-Aufruflimit 125/Tag – gegen den sellerboard-Nachbau der Testdienste (erfundene
// Werte). Abnahme 2: Zähler in anbindungen_status; künstliches Budget 5 → „übersprungen (Tagesbudget)“ statt Fehler.
// Abnahme 3: Limit-Fehler → ein Eintrag „pausiert bis 01:00 Uhr“; nach der Rücksetzung automatisch nachgeholt
// (Verkauf → Gewinn je Produkt → Rest). Abnahme 1 und 4 zählen echte Tage – Rechnung nach Plan im Unit-Test.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { E2E_ENV, TD } from "./env";
import { aktion, anmelden, expect, mcpVerbinden, sql, test } from "./helfer";

/** Zugangsdaten wie im Seller-System verschlüsseln (Test-Schlüssel aus der Testumgebung). */
function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
const nachbau = (body: unknown) => fetch(`${TD}/__sellerboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ aufrufe: number; werkzeuge: string[] }>);
const nachbauStand = () => fetch(`${TD}/__sellerboard`).then((r) => r.json() as Promise<{ aufrufe: number; werkzeuge: string[] }>);

type Abruf = { abruf: string; status?: string; fehler?: string; letzter_erfolg: string };
type SbAufrufe = { text: string; automatik: number; obergrenze_automatik: number; pausiert_bis?: string; reserve: number };

/** Rücksetzung 00:00 UTC in Berliner Zeit („01:00 Uhr“ im Winter, „02:00 Uhr“ im Sommer). */
const resetUhr = () => {
  const n = new Date();
  const r = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1));
  return `${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(r)} Uhr`;
};

test.describe.serial("B29 – sellerboard-Aufrufbudget", () => {
  let T = "";
  const aufraeumen = async () => {
    await sql("delete from sellerboard_aufrufe where tenant_id = $1", [T]);
    await sql("delete from sellerboard_plan where tenant_id = $1", [T]);
    await sql("delete from job_runs where tenant_id = $1 and name like 'sellerboard:%'", [T]);
    await nachbau({ zuruecksetzen: true });
  };

  test.beforeAll(async () => {
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("delete from integrations where tenant_id = $1 and provider = 'sellerboard'", [T]);
    await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'sellerboard', 'Test', $2::jsonb, $3)", [
      T,
      JSON.stringify({ accountId: "sb-test-1", accountName: "Testkonto (Nachbau)", hasEbay: false, connectedAt: new Date().toISOString() }),
      versiegeln(JSON.stringify({ accessToken: "test-sb-token", refreshToken: "test-sb-refresh", clientId: "test-client", expiresAt: Date.now() + 30 * 86_400_000 })),
    ]);
    await aufraeumen();
  });
  test.afterAll(async () => {
    await aufraeumen();
    await sql("delete from integrations where tenant_id = $1 and provider = 'sellerboard'", [T]);
    for (const t of ["sellerboard_kpis", "sellerboard_months", "sellerboard_sku_months", "sellerboard_sku_tage", "sellerboard_top"]) await sql(`delete from ${t} where tenant_id = $1`, [T]);
  });

  test("Abnahme 2: Zähler in anbindungen_status; Budget 5 → „übersprungen (Tagesbudget)“ statt Fehler", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    await sql("insert into sellerboard_plan (tenant_id, obergrenze) values ($1, 5)", [T]);
    await anmelden(page, "inhaber");
    await page.goto("/anbindungen#sellerboard");
    await expect(page.getByTestId("sb-aufrufe")).toContainText("sellerboard-Aufrufe heute: 0/125 (Automatik 0, Reserve");
    await Promise.all([aktion(page), page.getByTestId("sb-automatik").click()]);
    // Läuft im Hintergrund: fertig, sobald der letzte Tagesabruf seinen Hinweis hat
    await expect.poll(async () => (await sql<{ h: string | null }>("select hinweis as h from job_runs where tenant_id = $1 and name = 'sellerboard: Produkte & EK'", [T]))[0]?.h ?? "", { timeout: 60_000 }).toMatch(/^übersprungen \(Tagesbudget\)/);

    // Zähler = Aufrufe beim Nachbau, nie über dem Budget
    const [{ automatik }] = await sql<{ automatik: number }>("select automatik from sellerboard_aufrufe where tenant_id = $1", [T]);
    const stand = await nachbauStand();
    expect(automatik).toBe(stand.aufrufe);
    expect(automatik).toBeGreaterThan(0);
    expect(automatik).toBeLessThanOrEqual(5);

    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("anbindungen_status", {})) as { abrufe: Abruf[]; sellerboard_aufrufe: SbAufrufe };
    expect(r.sellerboard_aufrufe.text).toMatch(/^sellerboard-Aufrufe heute: \d+\/125 \(Automatik \d+, Reserve \d+\)$/);
    expect(r.sellerboard_aufrufe.automatik).toBe(automatik);
    expect(r.sellerboard_aufrufe.obergrenze_automatik).toBe(5);
    const sb = r.abrufe.filter((a) => a.abruf.startsWith("sellerboard:"));
    // Verkauf (Vorrang) lief, die übrigen sind übersprungen – kein einziger Fehler
    expect(sb.find((a) => a.abruf === "sellerboard: Verkauf (Amazon + eBay)")?.letzter_erfolg).not.toBe("nie");
    for (const name of ["FBA-Bestand", "FBA-Sendungen", "Produkte & EK", "Fixkosten", "Verlust-Stopp"]) expect(sb.find((a) => a.abruf === `sellerboard: ${name}`)?.status, name).toMatch(/^übersprungen \(Tagesbudget\) – wird nach der Rücksetzung um \d\d:00 Uhr nachgeholt$/);
    expect(sb.filter((a) => a.fehler)).toEqual([]);

    // Seite: Status an der Abrufzeile statt roter Fehler
    await page.goto("/anbindungen");
    await expect(page.getByTestId("abruf-zeile").filter({ hasText: "sellerboard: FBA-Bestand" }).getByTestId("abruf-status")).toContainText("übersprungen (Tagesbudget)");
    await expect(page.getByTestId("sb-aufrufe")).toContainText(`Automatik ${automatik}`);
  });

  test("Abnahme 3: Limit-Fehler → ein Eintrag „pausiert bis …“, nach der Rücksetzung nachgeholt (Verkauf → Gewinn je Produkt → Rest)", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    await aufraeumen();
    // usage_quota meldet noch Luft, die Aufrufe scheitern trotzdem mit dem Limit-Text von sellerboard
    await nachbau({ limit: true, quotaVoll: false });
    await anmelden(page, "inhaber");
    await page.goto("/anbindungen#sellerboard");
    await Promise.all([aktion(page), page.getByTestId("sb-automatik").click()]);
    await expect.poll(async () => (await sql<{ p: Date | null }>("select pausiert_bis as p from sellerboard_plan where tenant_id = $1", [T]))[0]?.p ?? null, { timeout: 30_000 }).not.toBeNull();

    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("anbindungen_status", {})) as { abrufe: Abruf[]; sellerboard_aufrufe: SbAufrufe };
    const sb = r.abrufe.filter((a) => a.abruf.startsWith("sellerboard:"));
    // genau ein Eintrag statt vieler Fehlerzeilen
    expect(sb.filter((a) => a.fehler)).toEqual([]);
    const pause = sb.filter((a) => a.status?.startsWith("pausiert bis"));
    expect(pause).toHaveLength(1);
    expect(pause[0].abruf).toBe("sellerboard: Tageslimit");
    expect(pause[0].status).toBe(`pausiert bis ${resetUhr()} – sellerboard-Tageslimit erreicht; danach automatisch nachholen (Verkauf → Gewinn je Produkt → Rest)`);
    expect(r.sellerboard_aufrufe.pausiert_bis).toBeTruthy();
    expect(r.sellerboard_aufrufe.automatik).toBe(0);
    const probleme = JSON.parse(await mcp.call("anbindungen_status", { nur_probleme: true })) as { abrufe: Abruf[] };
    expect(probleme.abrufe.filter((a) => a.abruf.startsWith("sellerboard:")).map((a) => a.abruf)).toEqual(["sellerboard: Tageslimit"]);
    await page.goto("/anbindungen#sellerboard");
    await expect(page.getByTestId("sb-pausiert")).toContainText(`pausiert bis ${resetUhr()}`);
    // Während der Pause: kein weiterer Aufruf
    const vorher = (await nachbauStand()).aufrufe;
    await Promise.all([aktion(page), page.getByTestId("sb-automatik").click()]);
    await page.waitForTimeout(1500);
    expect((await nachbauStand()).aufrufe).toBe(vorher);

    // „Am nächsten Tag“: Rücksetzung vorbei, sellerboard antwortet wieder → alles wird nachgeholt
    await sql("update sellerboard_plan set pausiert_bis = now() - interval '1 minute' where tenant_id = $1", [T]);
    await nachbau({ limit: false });
    await page.goto("/anbindungen#sellerboard");
    await Promise.all([aktion(page), page.getByTestId("sb-automatik").click()]);
    const ok = async (name: string) => (await sql<{ ok: Date | null }>("select last_ok_at as ok from job_runs where tenant_id = $1 and name = $2", [T, `sellerboard: ${name}`]))[0]?.ok ?? null;
    await expect.poll(() => ok("Hebel-Aufgaben").then((x) => (x ? 1 : 0)), { timeout: 90_000 }).toBe(1);
    await expect.poll(() => ok("Keepa Buy Box (Hebel)").then((x) => (x ? 1 : 0)), { timeout: 30_000 }).toBe(1);
    const zeiten = await Promise.all(["Verkauf (Amazon + eBay)", "Gewinn je Produkt und Tag", "FBA-Bestand", "Produkte & EK"].map(ok));
    expect(zeiten.every(Boolean)).toBe(true);
    for (let i = 1; i < zeiten.length; i++) expect(zeiten[i]!.getTime()).toBeGreaterThanOrEqual(zeiten[i - 1]!.getTime());
    // erste Aufrufe in der Nachhol-Reihenfolge: Verkauf (Kennzahlen) vor Gewinn je Produkt (Tabelle) vor Bestand
    const werkzeuge = (await nachbauStand()).werkzeuge;
    expect(werkzeuge.indexOf("dashboard_table")).toBeGreaterThan(werkzeuge.indexOf("dashboard_period"));
    expect(werkzeuge.indexOf("inventory")).toBeGreaterThan(werkzeuge.indexOf("dashboard_table"));
    expect(werkzeuge.indexOf("products")).toBeGreaterThan(werkzeuge.indexOf("inventory"));

    const danach = JSON.parse(await mcp.call("anbindungen_status", {})) as { abrufe: Abruf[]; sellerboard_aufrufe: SbAufrufe };
    expect(danach.abrufe.map((a) => a.abruf)).not.toContain("sellerboard: Tageslimit");
    expect(danach.abrufe.filter((a) => a.abruf.startsWith("sellerboard:") && (a.fehler || a.status))).toEqual([]);
    expect(danach.sellerboard_aufrufe.pausiert_bis).toBeUndefined();
    expect(danach.sellerboard_aufrufe.automatik).toBe((await nachbauStand()).aufrufe);
    expect(danach.sellerboard_aufrufe.automatik).toBeLessThanOrEqual(80);
  });
});
