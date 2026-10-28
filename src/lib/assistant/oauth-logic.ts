import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// OAuth 2.1 für den Claude-Konnektor (MCP-Autorisierung): reine Hilfsfunktionen ohne Datenbank.
// Ablauf: Claude registriert sich (DCR), schickt dich zur Freigabe-Seite, tauscht den Code mit PKCE gegen
// Zugangs- und Erneuerungs-Token und ruft damit /api/mcp auf.

export const SCOPES = ["lesen", "aendern", "privat"] as const;
export type Scope = (typeof SCOPES)[number];

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_DAYS = 90;
export const CODE_TTL_S = 300;

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256hex = (v: string) => createHash("sha256").update(v).digest("hex");
const b64url = (buf: Buffer) => buf.toString("base64url");

/** PKCE S256: BASE64URL(SHA256(code_verifier)) == code_challenge. */
export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Erlaubte Rücksprung-Adressen: Claude (claude.ai / claude.com, nur https) und lokale Programme
 * (Claude Desktop / Claude Code über http://localhost bzw. 127.0.0.1). Alles andere wird abgelehnt.
 */
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (u.protocol === "https:" && (host === "claude.ai" || host === "claude.com" || host.endsWith(".claude.ai") || host.endsWith(".claude.com"))) return true;
  if (u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]")) return true;
  return false;
}

/** Scope aus der Anfrage → bekannte Werte; ohne Angabe: lesen + ändern (privat nur ausdrücklich auf der Freigabe-Seite). */
export function parseScope(raw: string | null | undefined): Scope[] {
  const want = String(raw ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const known = SCOPES.filter((s) => want.includes(s));
  return known.length ? known : ["lesen", "aendern"];
}

export const scopeText = (scope: string) => {
  const s = new Set(scope.split(" "));
  return [s.has("aendern") ? "lesen und ändern" : "nur lesen", s.has("privat") ? "mit Privatbereich" : "ohne Privatbereich"].join(", ");
};

/** Client-Zugang aus „Authorization: Basic …“ (client_secret_basic). */
export function basicAuth(header: string | null): { id: string; secret: string } | null {
  const m = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const i = raw.indexOf(":");
    if (i < 0) return null;
    return { id: decodeURIComponent(raw.slice(0, i)), secret: decodeURIComponent(raw.slice(i + 1)) };
  } catch {
    return null;
  }
}

/** Antwort-Adresse mit angehängten Parametern (Code bzw. Fehler + state). */
export function withParams(uri: string, params: Record<string, string | undefined | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
}

export function authServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    registration_endpoint: `${base}/api/mcp/oauth/register`,
    revocation_endpoint: `${base}/api/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...SCOPES],
    service_documentation: `${base}/einstellungen#claude`,
  };
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SCOPES],
    resource_name: "Seller-System",
  };
}
