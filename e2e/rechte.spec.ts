// Rechte: Claude-Konnektor (MCP mit Anmeldung) und Fragefeld mit mehreren Konten. Die Test-KI ruft auf Befehl auch
// Werkzeuge auf, die NICHT angeboten wurden – der Server muss sie abweisen und protokollieren.
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { alsPerson, expect, marke, sql, test, testdienste, type Rolle } from "./helfer";
import { PASSWORT } from "./env";

const CB = "http://localhost:4555/callback";
const pkce = () => {
  const v = randomBytes(40).toString("base64url");
  return { v, c: createHash("sha256").update(v).digest("base64url") };
};

test.describe("Einstellungen – Claude & KI-Assistent (Rechte)", () => {
  test("Claude-Konnektor + Fragefeld: lesen, verweigert, direkter Aufruf ohne Recht, Vorschlag, Ablehnen, Ausführen, Protokoll", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000); // drei Anmeldungen bei Claude + drei Konten im Fragefeld
    const B = baseURL!;
    const j = async (r: Response) => {
      const t = await r.text();
      try {
        return JSON.parse(t);
      } catch {
        return t;
      }
    };
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${B}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    let rpcId = 0;
    const rpcRaw = (token: string, method: string, params: unknown) => post("/api/mcp", { jsonrpc: "2.0", id: ++rpcId, method, params }, { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" });
    const rpc = async (token: string, method: string, params: unknown) => j(await rpcRaw(token, method, params));
    const call = async (token: string, name: string, args: unknown = {}) => (await rpc(token, "tools/call", { name, arguments: args })).result as { isError?: boolean; content: { text: string }[] };
    const m = marke();
    const [ship] = await sql<{ id: string }>("select id from pallet_shipments where title like 'Testanlieferung%' limit 1");
    const notizen = async () => Number((await sql<{ n: string }>("select count(*) n from pallet_shipment_events where shipment_id = $1 and kind = 'notiz'", [ship.id]))[0].n);
    const reg = await j(await post("/api/mcp/oauth/register", { redirect_uris: [CB], client_name: "Rechte-Test", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }));

    async function verbinden(rolle: Rolle, opts: { write?: boolean; privat?: boolean } = {}) {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      const { v, c } = pkce();
      let landed: string | null = null;
      await p.route("http://localhost:4555/**", (r) => {
        landed = r.request().url();
        return r.fulfill({ status: 200, body: "ok" });
      });
      const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: CB, code_challenge: c, code_challenge_method: "S256", state: "s1", scope: "lesen aendern privat", resource: `${B}/api/mcp` });
      await p.goto(`${B}/oauth/authorize?${q}`);
      await p.fill("#email", rolle);
      await p.fill("#password", PASSWORT);
      await Promise.all([p.waitForURL((u) => u.pathname.startsWith("/oauth/authorize")), p.click("button[type=submit]")]);
      await p.waitForSelector('[data-testid="consent-form"]');
      const text = (await p.textContent("main")) ?? "";
      if (opts.write === false) await p.uncheck('[data-testid="consent-write"]');
      if ((await p.locator('[data-testid="consent-private"]').count()) && !opts.privat) await p.uncheck('[data-testid="consent-private"]');
      await p.click('[data-testid="consent-allow"]');
      await expect.poll(() => landed ?? (p.locator('[data-testid="consent-form"] [role="alert"]').count().then((n) => (n ? "fehler" : null))), { timeout: 15_000 }).not.toBeNull();
      const err = landed ? null : await p.locator('[data-testid="consent-form"] [role="alert"]').textContent({ timeout: 5_000 }).catch(() => null);
      let token: { access_token: string; scope: string } | null = null;
      if (landed) token = await j(await fetch(`${B}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: new URL(landed).searchParams.get("code")!, redirect_uri: CB, client_id: reg.client_id, code_verifier: v }) }));
      await ctx.close();
      return { text, err, token };
    }

    // — Claude-Konnektor —
    const l = await verbinden("lager");
    expect(l.text).toContain("kann nur der Inhaber");
    expect(l.err).toContain("nur der Inhaber");
    expect(l.token).toBeNull();
    const r = await verbinden("inhaber", { write: false });
    expect(r.token!.scope).toBe("lesen");
    const liste = (await rpc(r.token!.access_token, "tools/list", {})).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(liste.length).toBeGreaterThan(5);
    expect(liste.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(liste.some((t) => t.name.startsWith("privat_"))).toBe(false);
    const vorher = (await sql("select id from pallet_shipments")).length;
    const d1 = await call(r.token!.access_token, "sendung_anlegen", { richtung: "ein", bezeichnung: `RECHTE ${m}`, spedition: "dachser", paletten: 1, termin: "2026-11-03" });
    expect(d1.isError).toBe(true);
    expect(d1.content[0].text).toContain("nicht freigegeben");
    expect((await sql("select id from pallet_shipments")).length).toBe(vorher);
    expect((await call(r.token!.access_token, "privat_kalender")).content[0].text).toContain("nicht freigegeben");
    expect((await call(r.token!.access_token, "gibt_es_nicht")).content[0].text).toContain("nicht freigegeben");
    const w = await verbinden("inhaber", { write: true });
    expect(w.token!.scope).toBe("lesen aendern");
    const n0 = await notizen();
    const ok = await call(w.token!.access_token, "sendung_notiz", { id: ship.id, text: `Rechte-Test ${m} über Claude` });
    expect(ok.isError).toBeFalsy();
    expect(await notizen()).toBe(n0 + 1);
    expect((await call(w.token!.access_token, "privat_termin", { titel: "x" })).content[0].text).toContain("nicht freigegeben");
    expect((await rpcRaw("ungueltig-123", "tools/list", {})).status).toBe(401);

    // — Fragefeld —
    const antworten = (p: Page) => p.locator('[data-testid="asst-msg-assistant"]').allTextContents();
    async function fragen(p: Page, text: string, opts: { vorschlag?: boolean } = {}) {
      const n = (await antworten(p)).length;
      const feld = (await p.locator('[data-testid="asst-input2"]').isVisible().catch(() => false)) ? '[data-testid="asst-input2"]' : '[data-testid="asst-input"]';
      await p.fill(feld, text);
      await p.keyboard.press("Enter");
      if (opts.vorschlag) return void (await p.waitForSelector('[data-testid="asst-confirm"]'));
      await expect.poll(async () => (await antworten(p)).length).toBeGreaterThan(n);
      await expect(p.locator('[data-testid="asst-status"]')).toHaveCount(0);
      return (await antworten(p)).at(-1)!;
    }
    const lp = await alsPerson(browser, "lager");
    await fragen(lp, `palette ${m}-L1`);
    const offL = (await testdienste.kiZu(`${m}-L1`))!.tools;
    expect(offL).toContain("sendung_notiz");
    expect(offL).not.toContain("umsatz");
    expect(offL).not.toContain("auftraege");
    expect(offL.some((t) => t.startsWith("privat_"))).toBe(false);
    expect(await fragen(lp, `werkzeug:umsatz {} ${m}-L2`)).toContain("nicht freigegeben");
    const n1 = await notizen();
    await fragen(lp, `werkzeug:sendung_notiz {"id":"${ship.id}","text":"Abgelehnt ${m}"}`, { vorschlag: true });
    await expect(lp.locator('[data-testid="asst-confirm"]')).toContainText(`Abgelehnt ${m}`);
    await lp.click('[data-testid="asst-deny"]');
    await expect.poll(async () => (await antworten(lp)).some((t) => t.includes("abgelehnt"))).toBe(true);
    expect(await notizen()).toBe(n1);
    await fragen(lp, `werkzeug:sendung_notiz {"id":"${ship.id}","text":"Bestätigt ${m}"}`, { vorschlag: true });
    await lp.click('[data-testid="asst-approve"]');
    await expect.poll(async () => (await antworten(lp)).some((t) => t.includes("Notiz gespeichert"))).toBe(true);
    expect(await notizen()).toBe(n1 + 1);
    const pp = await alsPerson(browser, "pruefer");
    await fragen(pp, `palette ${m}-P1`);
    const offP = (await testdienste.kiZu(`${m}-P1`))!.tools;
    expect(offP).toContain("sendungen");
    expect(offP.filter((t) => ["sendung_notiz", "sendung_status", "sendung_anlegen", "aufgabe_anlegen", "auftrag_notiz"].includes(t))).toEqual([]);
    const n2 = await notizen();
    expect(await fragen(pp, `werkzeug:sendung_notiz {"id":"${ship.id}","text":"Prüfer ${m}"} ${m}-P2`)).toContain("nicht freigegeben");
    await expect(pp.locator('[data-testid="asst-confirm"]')).toHaveCount(0);
    expect(await notizen()).toBe(n2);
    await page.goto("/login");
    const ap = await alsPerson(browser, "inhaber");
    await fragen(ap, `palette ${m}-A1`);
    const offA = (await testdienste.kiZu(`${m}-A1`))!.tools;
    expect(offA).toContain("umsatz");
    expect(offA.some((t) => t.startsWith("privat_"))).toBe(false);
    expect(await fragen(ap, `werkzeug:privat_kalender {} ${m}-A2`)).toContain("nicht freigegeben");

    // — Übersicht und Protokoll —
    await ap.goto("/einstellungen/claude");
    const rechte = (await ap.textContent('[data-testid="rights"]')) ?? "";
    for (const s of ["nur der Inhaber kann verbinden", "Privatbereich", "Nie.", "abgewiesen", "direkt aufgerufen"]) expect(rechte).toContain(s);
    const zeile = async (k: string) => ((await ap.locator(`[data-testid="rights-row"][data-account="${k}"]`).textContent()) ?? "").replace(/\s+/g, " ");
    expect(await zeile("lager")).toContain("Claude: kann nicht verbinden");
    expect(await zeile("pruefer")).toContain("· 0 ändern");
    const log = (await ap.locator('[data-testid="log-row"]').allTextContents()).map((t) => t.replace(/\s+/g, " "));
    const hat = (...teile: string[]) => log.some((t) => teile.every((x) => t.includes(x)));
    expect(hat("Ina Inhaber", "Claude", "abgewiesen", "Sendung anlegen")).toBe(true);
    expect(hat("Lars Lager", "Fragefeld", "abgewiesen", "Umsatz")).toBe(true);
    expect(hat("Lars Lager", "Fragefeld", "abgelehnt", `Abgelehnt ${m}`)).toBe(true);
    expect(hat("Lars Lager", "Fragefeld", `Bestätigt ${m}`)).toBe(true);
    expect(hat("Paul Prüfer", "Fragefeld", "abgewiesen")).toBe(true);
    expect(hat("Ina Inhaber", "Claude", `Rechte-Test ${m}`)).toBe(true);
    // Trennen → Tokens sofort ungültig
    while ((await ap.locator('[data-testid="grant-revoke"]').count()) > 0) {
      await ap.locator('[data-testid="grant-revoke"]').first().click();
      await ap.waitForTimeout(500);
      await ap.reload();
    }
    for (const t of [r.token!.access_token, w.token!.access_token]) expect((await rpcRaw(t, "tools/list", {})).status).toBe(401);
  });
});
