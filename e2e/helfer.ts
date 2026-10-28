// Gemeinsame Bausteine der Ablaufprüfungen: Anmelden je Rolle, auf Server-Aktionen warten, Datenbank und Testdienste
// abfragen. Konten und Daten kommen aus scripts/testdaten.ts (erfunden).
import { test as base, expect, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { DATABASE_URL, PASSWORT, TD } from "./env";

export type Rolle = "inhaber" | "lager" | "buero" | "pruefer" | "familie";

/** Wie `test`, prüft aber nach jedem Test, dass im Browser kein Skriptfehler auftrat. */
export const test = base.extend<{ fehlerfrei: void }>({
  fehlerfrei: [
    async ({ page }, use) => {
      const fehler: string[] = [];
      page.on("pageerror", (e) => fehler.push(e.message));
      await use();
      expect(fehler, "Skriptfehler im Browser").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function anmelden(page: Page, rolle: Rolle) {
  await page.goto("/login");
  await page.fill("#email", rolle);
  await page.fill("#password", PASSWORT);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

/** Zweite Person in eigenem Browser-Fenster (eigene Anmeldung). */
export async function alsPerson(browser: Browser, rolle: Rolle, opts: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", ...opts });
  const page = await ctx.newPage();
  await anmelden(page, rolle);
  return page;
}

/** Wartet auf die Antwort einer Server-Aktion (Formular absenden). */
export const aktion = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));

/** Direkter Blick in die Test-Datenbank (nur lesen bzw. Zeit „vorspulen“). */
export async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export type TdCall = { at: string; dienst: string; method: string; path: string; status: number; simuliert: boolean };
export type KiCall = { at: string; beta: string | null; thinking: { block_binding?: { prefix_mismatch_behavior?: string } } | null; tools: string[]; prefix: string; staleThinking: number; dropBlock: boolean; text: string; toolResult: string | null; toolError: boolean };
export const testdienste = {
  log: async (): Promise<TdCall[]> => (await fetch(`${TD}/__log`)).json(),
  ki: async (): Promise<KiCall[]> => (await fetch(`${TD}/__ki`)).json(),
  /** Letzte KI-Anfrage, deren Frage `marker` enthält. */
  kiZu: async (marker: string) => (await testdienste.ki()).filter((k) => k.text.includes(marker)).at(-1),
};

export const marke = () => Date.now().toString(36).slice(-5).toUpperCase();
export const keinWaagrechtesScrollen = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/**
 * Claude-Konnektor wie claude.ai: App anmelden, als `rolle` einloggen, Freigabe (lesen, optional ändern/Privat)
 * erteilen, Token holen. `call` ruft ein Werkzeug auf und gibt den Text der Antwort zurück.
 */
export async function mcpVerbinden(browser: Browser, B: string, rolle: Rolle, opts: { write?: boolean; privat?: boolean } = {}) {
  const { createHash, randomBytes } = await import("node:crypto");
  const CB = "http://localhost:4555/callback";
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${B}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const reg = await (await post("/api/mcp/oauth/register", { redirect_uris: [CB], client_name: "Prüfung", token_endpoint_auth_method: "none", grant_types: ["authorization_code"] })).json();
  const v = randomBytes(40).toString("base64url");
  const c = createHash("sha256").update(v).digest("base64url");
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  let landed: string | null = null;
  await p.route("http://localhost:4555/**", (r) => {
    landed = r.request().url();
    return r.fulfill({ status: 200, body: "ok" });
  });
  await p.goto(`${B}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: CB, code_challenge: c, code_challenge_method: "S256", state: "s", scope: "lesen aendern privat", resource: `${B}/api/mcp` })}`);
  await p.fill("#email", rolle);
  await p.fill("#password", PASSWORT);
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith("/oauth/authorize")), p.click("button[type=submit]")]);
  if (!opts.write) await p.uncheck('[data-testid="consent-write"]');
  if ((await p.locator('[data-testid="consent-private"]').count()) && !opts.privat) await p.uncheck('[data-testid="consent-private"]');
  await p.click('[data-testid="consent-allow"]');
  await expect.poll(() => landed).not.toBeNull();
  await ctx.close();
  const tok = (await (await fetch(`${B}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: new URL(landed!).searchParams.get("code")!, redirect_uri: CB, client_id: reg.client_id, code_verifier: v }) })).json()) as { access_token: string; scope: string };
  let id = 0;
  const rpc = async (method: string, params: unknown) => (await (await post("/api/mcp", { jsonrpc: "2.0", id: ++id, method, params }, { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" })).json()).result;
  return {
    scope: tok.scope,
    tools: async () => ((await rpc("tools/list", {})).tools as { name: string }[]).map((t) => t.name),
    call: async (name: string, args: unknown = {}) => ((await rpc("tools/call", { name, arguments: args })) as { content: { text: string }[] }).content[0].text,
  };
}
