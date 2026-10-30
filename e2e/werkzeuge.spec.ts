// Werkzeug-Vertrag: Jedes lesende Claude-Werkzeug wird einzeln aufgerufen (wie claude.ai es täte) und muss
// (1) eine aussagekräftige Beschreibung haben, (2) ohne Fehler antworten, (3) Quelle und Datenstand mitliefern und
// (4) Links ins Seller-System enthalten, die wirklich eine Seite öffnen (kein 404).
import { createHash, randomBytes } from "node:crypto";
import { alsPerson, expect, sql, test } from "./helfer";
import { PASSWORT } from "./env";

const CB = "http://localhost:4555/callback";
type Prop = { type?: string; enum?: unknown[]; items?: { enum?: unknown[] } };
type Tool = { name: string; description: string; annotations: { readOnlyHint: boolean }; inputSchema: { properties?: Record<string, Prop>; required?: string[] } };

function links(o: unknown, out: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => links(x, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) (k === "link" && typeof v === "string" ? out.push(v) : links(v, out));
  return out;
}

test.describe("Einstellungen – Claude & KI-Assistent (Werkzeuge)", () => {
  test("Jedes lesende Werkzeug: Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const B = baseURL!;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${B}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    // Anmeldung als Inhaberin mit lesen + Privat (wie claude.ai)
    const reg = await (await post("/api/mcp/oauth/register", { redirect_uris: [CB], client_name: "Vertragstest", token_endpoint_auth_method: "none", grant_types: ["authorization_code"] })).json();
    const v = randomBytes(40).toString("base64url");
    const c = createHash("sha256").update(v).digest("base64url");
    const p = await (await browser.newContext()).newPage();
    let landed: string | null = null;
    await p.route("http://localhost:4555/**", (r) => {
      landed = r.request().url();
      return r.fulfill({ status: 200, body: "ok" });
    });
    await p.goto(`${B}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: CB, code_challenge: c, code_challenge_method: "S256", state: "s", scope: "lesen privat", resource: `${B}/api/mcp` })}`);
    await p.fill("#email", "inhaber");
    await p.fill("#password", PASSWORT);
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith("/oauth/authorize")), p.click("button[type=submit]")]);
    await p.uncheck('[data-testid="consent-write"]');
    await p.click('[data-testid="consent-allow"]');
    await expect.poll(() => landed).not.toBeNull();
    const tok = await (await fetch(`${B}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: new URL(landed!).searchParams.get("code")!, redirect_uri: CB, client_id: reg.client_id, code_verifier: v }) })).json();
    let id = 0;
    const rpc = async (method: string, params: unknown) => (await (await post("/api/mcp", { jsonrpc: "2.0", id: ++id, method, params }, { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" })).json()).result;

    const tools = (await rpc("tools/list", {})).tools as Tool[];
    expect(tools.length).toBeGreaterThan(15);
    for (const t of tools) expect(t.description.length, `Beschreibung von ${t.name}`).toBeGreaterThanOrEqual(60);

    // Beispiel-Eingaben aus den Testdaten
    const [ship] = await sql<{ id: string }>("select id from pallet_shipments order by created_at limit 1");
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    const inSieben = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + 7 * 86400_000));
    const [mail] = await sql<{ id: string }>("select id from emails where message_key = '<testanfrage-1@example.invalid>'");
    const beispiel: Record<string, unknown> = { asin: "B0TEST0001", id_oder_nummer: "TEST-AMZ-1001", id: ship.id, von: heute, bis: inSieben, suchbegriff: "Test", q: "Test", text: "Test", frage: "Test" };
    // Werkzeuge, deren „id“ etwas anderes meint als eine Sendung
    const jeWerkzeug: Record<string, Record<string, unknown>> = { mail: { id: mail.id }, deal_pruefen: { code: "B0TEST0001", ek: 9.99 }, buchhaltung_status: { monat: heute.slice(0, 7) } };
    const wert = (k: string, p: Prop = {}) => (k in beispiel ? beispiel[k] : p.enum ? p.enum[0] : p.type === "array" ? (p.items?.enum ? [p.items.enum[0]] : []) : p.type === "number" || p.type === "integer" ? 1 : p.type === "boolean" ? false : "Test");
    const args = (t: Tool) => ({ ...Object.fromEntries((t.inputSchema.required ?? []).map((k) => [k, wert(k, t.inputSchema.properties?.[k])])), ...jeWerkzeug[t.name] });

    const offen: string[] = [];
    const alleLinks = new Set<string>();
    for (const t of tools.filter((x) => x.annotations.readOnlyHint)) {
      const r = (await rpc("tools/call", { name: t.name, arguments: args(t) })) as { isError?: boolean; content: { text: string }[] };
      const text = r.content[0].text;
      if (r.isError) {
        offen.push(`${t.name}: Fehler – ${text.slice(0, 120)}`);
        continue;
      }
      let o: Record<string, unknown> | null = null;
      try {
        o = JSON.parse(text);
      } catch {
        // Text-Antwort (z. B. „keine Werte“): Datenstand als letzte Zeile
        if (!/Datenstand: .+ – .+/.test(text)) offen.push(`${t.name}: Text ohne Datenstand`);
        continue;
      }
      const stand = o!.datenstand as { quelle?: string; stand?: string } | undefined;
      if (!stand?.quelle || !stand.stand) offen.push(`${t.name}: ohne Datenstand`);
      const l = links(o);
      if (!l.length) offen.push(`${t.name}: ohne Link`);
      l.slice(0, 5).forEach((x) => alleLinks.add(x));
    }
    expect(offen, "Werkzeuge mit Lücken").toEqual([]);
    // Alle Links öffnen eine echte Seite (angemeldet als Inhaberin)
    const ip = await alsPerson(browser, "inhaber");
    const kaputt: string[] = [];
    for (const l of alleLinks) {
      expect(l.startsWith(B), `Link ${l} zeigt auf das Seller-System`).toBe(true);
      const res = await ip.request.get(l, { maxRedirects: 0 });
      if (res.status() >= 400) kaputt.push(`${l} → ${res.status()}`);
    }
    expect(kaputt, "Links ohne Seite").toEqual([]);
  });
});
