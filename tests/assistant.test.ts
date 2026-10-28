import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleMcpMessage, type McpDeps } from "@/lib/assistant/mcp";
import { basicAuth, parseScope, pkceChallenge, redirectAllowed, scopeText, verifyPkce, withParams, authServerMetadata, protectedResourceMetadata } from "@/lib/assistant/oauth-logic";
import { accountRights, toolAllowed } from "@/lib/assistant/permissions";
import { inputSchema } from "@/lib/assistant/schema";
import { safeNext } from "@/lib/auth/next-path";
import type { Session } from "@/lib/auth/session";
import type { ToolDef } from "@/lib/assistant/types";

// KI-Assistent (Claude-Konnektor + Fragefeld): Anmeldung, Rechte, MCP – erfundene Personen und Daten.

const session = (o: Partial<Session> = {}): Session => ({
  userId: "u1",
  tenantId: "t1",
  role: "owner",
  areas: null,
  brandIds: null,
  readOnly: false,
  privateAccess: true,
  privateScope: "voll",
  privatePin: false,
  privateUnlockedUntil: null,
  sessionId: "s1",
  email: "erika@example.org",
  name: "Erika Test",
  tenantName: "Testfirma",
  ...o,
});

describe("OAuth (PKCE, Rücksprung, Scope)", () => {
  it("PKCE S256 nach RFC 7636 (Beispiel aus dem Standard)", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce("falsch-falsch-falsch-falsch-falsch-falsch-falsch", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyPkce(null, "x")).toBe(false);
    expect(verifyPkce("zu-kurz", pkceChallenge("zu-kurz"))).toBe(false);
  });
  it("nur Claude (https) und lokale Programme als Rücksprung", () => {
    expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(redirectAllowed("http://localhost:33418/callback")).toBe(true);
    expect(redirectAllowed("http://127.0.0.1:5000/cb")).toBe(true);
    expect(redirectAllowed("http://claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(redirectAllowed("https://claude.ai.evil.example/cb")).toBe(false);
    expect(redirectAllowed("https://evil.example/cb?x=claude.ai")).toBe(false);
    expect(redirectAllowed("https://user:pw@claude.ai/cb")).toBe(false);
    expect(redirectAllowed("javascript:alert(1)")).toBe(false);
  });
  it("Scope: bekannte Werte, sonst lesen + ändern; Klartext", () => {
    expect(parseScope("lesen privat foo")).toEqual(["lesen", "privat"]);
    expect(parseScope("")).toEqual(["lesen", "aendern"]);
    expect(scopeText("lesen aendern privat")).toBe("lesen und ändern, mit Privatbereich");
    expect(scopeText("lesen")).toBe("nur lesen, ohne Privatbereich");
  });
  it("Basic-Anmeldung des Programms, Antwort-Adresse mit Parametern", () => {
    expect(basicAuth(`Basic ${Buffer.from("ss_abc:geheim").toString("base64")}`)).toEqual({ id: "ss_abc", secret: "geheim" });
    expect(basicAuth("Bearer x")).toBeNull();
    expect(withParams("https://claude.ai/cb?a=1", { code: "c", state: "s t", error: null })).toBe("https://claude.ai/cb?a=1&code=c&state=s+t");
  });
  it("Metadaten zeigen auf die eigenen Endpunkte", () => {
    const as = authServerMetadata("https://seller.example");
    expect(as.token_endpoint).toBe("https://seller.example/api/mcp/oauth/token");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(protectedResourceMetadata("https://seller.example")).toMatchObject({ resource: "https://seller.example/api/mcp", authorization_servers: ["https://seller.example"] });
  });
  it("nach dem Login nur zurück zur Freigabe-Seite", () => {
    expect(safeNext("/oauth/authorize?client_id=x&state=y")).toBe("/oauth/authorize?client_id=x&state=y");
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("https://evil.example/oauth/authorize")).toBeNull();
    expect(safeNext("/auftraege")).toBeNull();
  });
});

describe("Rechte je Werkzeug", () => {
  const t = (o: Partial<ToolDef>) => ({ area: null, write: false, ...o }) as Pick<ToolDef, "ownerOnly" | "privat" | "write" | "area">;
  const lager = session({ role: "staff", areas: ["paletten"], privateAccess: false });
  it("Bereich: Mitarbeiter nur Paletten → keine Aufträge", () => {
    expect(toolAllowed({ session: lager, canWrite: true, privat: false }, t({ area: "paletten" }))).toBe(true);
    expect(toolAllowed({ session: lager, canWrite: true, privat: false }, t({ area: "wawi" }))).toBe(false);
    expect(toolAllowed({ session: lager, canWrite: true, privat: false }, t({ area: ["start", "kalender"] }))).toBe(false);
    expect(toolAllowed({ session: lager, canWrite: true, privat: false }, t({ area: null }))).toBe(true);
  });
  it("Ändern nur mit Freigabe und nie für Nur-ansehen-Konten", () => {
    expect(toolAllowed({ session: lager, canWrite: false, privat: false }, t({ area: "paletten", write: true }))).toBe(false);
    expect(toolAllowed({ session: { ...lager, readOnly: true }, canWrite: true, privat: false }, t({ area: "paletten", write: true }))).toBe(false);
  });
  it("Privat nur mit Privat-Freigabe der Verbindung und Privat-Zugang", () => {
    const owner = session();
    expect(toolAllowed({ session: owner, canWrite: true, privat: true }, t({ area: "privat", privat: true }))).toBe(true);
    expect(toolAllowed({ session: owner, canWrite: true, privat: false }, t({ area: "privat", privat: true }))).toBe(false);
    expect(toolAllowed({ session: { ...owner, privateAccess: false }, canWrite: true, privat: true }, t({ area: "privat", privat: true }))).toBe(false);
  });
  it("Inhaber-Werkzeuge nicht für Mitarbeiter mit allen Bereichen", () => {
    expect(toolAllowed({ session: session({ role: "staff" }), canWrite: true, privat: false }, t({ area: "amazon", ownerOnly: true }))).toBe(false);
  });
});

describe("Eingabe-Schema für Claude/MCP", () => {
  it("Objekt mit Pflichtfeldern; Felder mit Vorgabe sind optional", () => {
    const js = inputSchema({ input: z.object({ id: z.string(), limit: z.number().default(5), was: z.string().optional().describe("Text") }) });
    expect(js.$schema).toBeUndefined();
    expect(js.type).toBe("object");
    expect(js.required).toEqual(["id"]);
    expect((js.properties as Record<string, { description?: string }>).was.description).toBe("Text");
  });
  it("leere Eingabe → leeres Objekt-Schema", () => {
    expect(inputSchema({ input: z.object({}) })).toMatchObject({ type: "object", properties: {} });
  });
});

describe("MCP (JSON-RPC)", () => {
  const ctx = { session: session(), canWrite: true, privat: false, today: "2026-10-28" };
  const tool = { name: "ueberblick", title: "Tagesüberblick", description: "Was steht an", area: null, write: false, input: z.object({}), run: async () => "" } as ToolDef;
  const deps: McpDeps = { tools: [tool], schemaOf: () => ({ type: "object", properties: {} }), call: async (name) => (name === "ueberblick" ? { text: '{"heute":"2026-10-28"}' } : { text: "unbekannt", isError: true }) };
  it("initialize: Version des Programms, sonst die neueste", async () => {
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx, deps);
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "seller-system" } } });
    expect((r!.result as { instructions: string }).instructions).toContain("Testfirma");
    const r2 = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctx, deps);
    expect((r2!.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
  });
  it("tools/list mit Hinweisen (nur lesen) und tools/call", async () => {
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ctx, deps);
    expect(list!.result).toEqual({ tools: [{ name: "ueberblick", title: "Tagesüberblick", description: "Was steht an", inputSchema: { type: "object", properties: {} }, annotations: { title: "Tagesüberblick", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] });
    const call = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ueberblick", arguments: {} } }, ctx, deps);
    expect(call!.result).toEqual({ content: [{ type: "text", text: '{"heute":"2026-10-28"}' }], isError: false });
    const bad = await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "gibtsnicht" } }, ctx, deps);
    expect((bad!.result as { isError: boolean }).isError).toBe(true);
  });
  it("Benachrichtigungen ohne Antwort, Unbekanntes als Fehler", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx, deps)).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "sampling/createMessage" }, ctx, deps)).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcpMessage([1], ctx, deps)).toMatchObject({ error: { code: -32600 } });
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "ping" }, ctx, deps)).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });
});

describe("Öffentliche Adresse für Claude (PUBLIC_URL)", async () => {
  const { publicUrl, publicOrigins, claudeReachable } = await import("@/lib/public-url");
  it("PUBLIC_URL wird ohne Pfad/Schrägstrich übernommen, Unsinn ignoriert", () => {
    expect(publicUrl({ PUBLIC_URL: "https://server.tail1234.ts.net:8443/" })).toBe("https://server.tail1234.ts.net:8443");
    expect(publicUrl({ PUBLIC_URL: "  " })).toBeNull();
    expect(publicUrl({ PUBLIC_URL: "ftp://x" })).toBeNull();
    expect(publicUrl({})).toBeNull();
  });
  it("erlaubte Ursprünge für Login/Freigabe hinter dem Proxy", () => {
    expect(publicOrigins({ PUBLIC_URL: "https://server.tail1234.ts.net:8443" })).toEqual(["server.tail1234.ts.net:8443", "server.tail1234.ts.net"]);
    expect(publicOrigins({})).toEqual([]);
  });
  it("Claude braucht https und eine Adresse außerhalb des privaten Netzes", () => {
    expect(claudeReachable("http://100.72.182.44:3020").ok).toBe(false);
    expect(claudeReachable("https://100.72.182.44:3020").reason).toContain("privaten Netz");
    expect(claudeReachable("https://192.168.1.5").ok).toBe(false);
    expect(claudeReachable("https://server.tail1234.ts.net:8443").ok).toBe(true);
    expect(claudeReachable("https://lugruseller.de").ok).toBe(true);
  });
});

describe("Wer darf was – je Konto und Weg (Einstellungen → Claude)", () => {
  const tl = (name: string, o: Partial<ToolDef> = {}) => ({ name, area: null, write: false, ...o }) as Pick<ToolDef, "name" | "area" | "write" | "ownerOnly" | "privat">;
  const tools = [
    tl("ueberblick"),
    tl("sendungen", { area: "paletten" }),
    tl("sendung_status", { area: "paletten", write: true }),
    tl("umsatz", { area: "wawi" }),
    tl("amazon_todos", { area: "wawi", ownerOnly: true }),
    tl("privat_termin", { area: "privat", privat: true, write: true }),
  ];
  it("Inhaber: Fragefeld ohne Privat, Claude mit Privat", () => {
    const r = accountRights(tools, session(), { allowWrite: true });
    expect(r.fragefeld).toEqual({ lesen: ["ueberblick", "sendungen", "umsatz", "amazon_todos"], aendern: ["sendung_status"] });
    expect(r.claude?.aendern).toEqual(["sendung_status", "privat_termin"]);
  });
  it("Lager (nur Paletten): nur Palettenwerkzeuge, kein Claude-Konnektor", () => {
    const r = accountRights(tools, session({ role: "staff", areas: ["paletten"], privateAccess: false }), { allowWrite: true });
    expect(r.fragefeld).toEqual({ lesen: ["ueberblick", "sendungen"], aendern: ["sendung_status"] });
    expect(r.claude).toBeNull();
  });
  it("Nur-ansehen-Konto und Fragefeld ohne Ändern: nichts Änderndes", () => {
    expect(accountRights(tools, session({ role: "staff", areas: ["paletten", "wawi"], readOnly: true }), { allowWrite: true }).fragefeld.aendern).toEqual([]);
    expect(accountRights(tools, session(), { allowWrite: false }).fragefeld.aendern).toEqual([]);
  });
});
