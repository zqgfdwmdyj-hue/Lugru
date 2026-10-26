import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// Verbindung zum sellerboard-Connector (MCP, nur lesend). Anmeldung per OAuth 2.1 mit PKCE; das Seller-System
// registriert sich dabei selbst als Anwendung. Zugangsdaten liegen verschlüsselt in „integrations“.

export const SB_PROVIDER = "sellerboard";
export const mcpUrl = () => (process.env.SELLERBOARD_MCP_URL || "https://mcp.sellerboard.com/mcp").replace(/\/$/, "");

export type SbConfig = {
  accountId?: string;
  accountName?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string | null;
  lastCounts?: Record<string, number>;
  syncing?: string | null;
};
type SbSecrets = { clientId?: string; clientSecret?: string; redirectUri?: string; accessToken?: string; refreshToken?: string; expiresAt?: number };

type Meta = { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string };
let metaCache: { url: string; meta: Meta; at: number } | null = null;

/** Endpunkte laut .well-known (mit Rückfall auf /authorize, /token, /register). */
export async function sbMeta(): Promise<Meta> {
  const origin = new URL(mcpUrl()).origin;
  if (metaCache && metaCache.url === origin && Date.now() - metaCache.at < 3600_000) return metaCache.meta;
  let meta: Meta = { authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` };
  try {
    const r = await fetch(`${origin}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const j = (await r.json()) as Partial<Meta>;
      if (j.authorization_endpoint && j.token_endpoint) meta = { authorization_endpoint: j.authorization_endpoint, token_endpoint: j.token_endpoint, registration_endpoint: j.registration_endpoint ?? meta.registration_endpoint };
    }
  } catch {
    // Rückfall auf die Standardpfade
  }
  metaCache = { url: origin, meta, at: Date.now() };
  return meta;
}

async function readRow(tenantId: string) {
  const I = schema.integrations;
  const [row] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.provider, SB_PROVIDER)));
  return row ?? null;
}

export async function readConn(tenantId: string): Promise<{ config: SbConfig; secrets: SbSecrets } | null> {
  const row = await readRow(tenantId);
  if (!row) return null;
  let secrets: SbSecrets = {};
  try {
    secrets = row.secretEncrypted ? (JSON.parse(decryptSecret(row.secretEncrypted)) as SbSecrets) : {};
  } catch {
    secrets = {};
  }
  return { config: row.config as SbConfig, secrets };
}

/** Teilweise aktualisieren – nie stillschweigend Zugangsdaten verwerfen. */
export async function writeConn(tenantId: string, patch: { config?: Partial<SbConfig>; secrets?: Partial<SbSecrets> }) {
  const cur = (await readConn(tenantId)) ?? { config: {}, secrets: {} };
  const config = { ...cur.config, ...(patch.config ?? {}) };
  const secrets = { ...cur.secrets, ...(patch.secrets ?? {}) };
  const sealed = encryptSecret(JSON.stringify(secrets));
  const row = await readRow(tenantId);
  const I = schema.integrations;
  if (row) await db.update(I).set({ config, secretEncrypted: sealed, updatedAt: new Date() }).where(eq(I.id, row.id));
  else await db.insert(I).values({ tenantId, provider: SB_PROVIDER, label: "sellerboard", config, secretEncrypted: sealed });
}

export async function deleteConn(tenantId: string) {
  const I = schema.integrations;
  await db.delete(I).where(and(eq(I.tenantId, tenantId), eq(I.provider, SB_PROVIDER)));
}

/** Verbunden = es gibt ein Refresh-Token. */
export async function sbConnected(tenantId: string): Promise<boolean> {
  const c = await readConn(tenantId);
  return Boolean(c?.secrets.refreshToken || c?.secrets.accessToken);
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Anwendung registrieren (einmal je Weiterleitungsadresse) und Anmelde-Adresse mit PKCE bauen. */
export async function startAuth(tenantId: string, redirectUri: string, state: string): Promise<{ url: string; verifier: string }> {
  const meta = await sbMeta();
  const cur = await readConn(tenantId);
  let clientId = cur?.secrets.redirectUri === redirectUri ? cur?.secrets.clientId : undefined;
  if (!clientId) {
    if (!meta.registration_endpoint) throw new Error("sellerboard bietet keine Registrierung an.");
    const r = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_name: "Seller-System", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: "read" }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error_description?: string; error?: string };
    if (!r.ok || !j.client_id) throw new Error(`sellerboard-Registrierung fehlgeschlagen: ${j.error_description ?? j.error ?? `HTTP ${r.status}`}`);
    clientId = j.client_id;
    await writeConn(tenantId, { secrets: { clientId, clientSecret: j.client_secret, redirectUri } });
  }
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "read");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", mcpUrl());
  return { url: u.toString(), verifier };
}

async function tokenRequest(body: Record<string, string>) {
  const meta = await sbMeta();
  const r = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`sellerboard-Anmeldung: ${j.error_description ?? j.error ?? `HTTP ${r.status}`}`);
  return j;
}

/** Code gegen Zugang tauschen und verschlüsselt speichern. */
export async function finishAuth(tenantId: string, code: string, verifier: string) {
  const cur = await readConn(tenantId);
  if (!cur?.secrets.clientId || !cur.secrets.redirectUri) throw new Error("Anmeldung nicht gestartet – bitte erneut „Mit sellerboard verbinden“.");
  const j = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: cur.secrets.redirectUri,
    client_id: cur.secrets.clientId,
    code_verifier: verifier,
    resource: mcpUrl(),
    ...(cur.secrets.clientSecret ? { client_secret: cur.secrets.clientSecret } : {}),
  });
  await writeConn(tenantId, {
    secrets: { accessToken: j.access_token, refreshToken: j.refresh_token ?? cur.secrets.refreshToken, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 },
    config: { connectedAt: new Date().toISOString(), lastSyncError: null },
  });
}

/** Gültiges Zugangs-Token (bei Bedarf erneuert). */
export async function accessToken(tenantId: string, forceRefresh = false): Promise<string> {
  const cur = await readConn(tenantId);
  if (!cur?.secrets.accessToken && !cur?.secrets.refreshToken) throw new Error("sellerboard ist nicht verbunden.");
  const s = cur.secrets;
  if (!forceRefresh && s.accessToken && (s.expiresAt ?? 0) > Date.now() + 60_000) return s.accessToken;
  if (!s.refreshToken || !s.clientId) throw new Error("sellerboard-Anmeldung abgelaufen – bitte unter Anbindungen neu verbinden.");
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: s.clientId, resource: mcpUrl(), ...(s.clientSecret ? { client_secret: s.clientSecret } : {}) });
  await writeConn(tenantId, { secrets: { accessToken: j.access_token, refreshToken: j.refresh_token ?? s.refreshToken, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 } });
  return j.access_token!;
}
