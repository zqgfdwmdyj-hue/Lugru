import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { ACCESS_TTL_S, CODE_TTL_S, REFRESH_TTL_DAYS, parseScope, randomToken, redirectAllowed, sha256hex, verifyPkce } from "./oauth-logic";

const C = schema.oauthClients;
const K = schema.oauthCodes;
const G = schema.oauthGrants;

export type OAuthError = { error: string; error_description: string; status?: number };
const err = (error: string, error_description: string, status = 400): OAuthError => ({ error, error_description, status });

// ---- Programm-Registrierung (RFC 7591) ---------------------------------------------------------------

export async function registerClient(body: Record<string, unknown>) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) return err("invalid_redirect_uri", "redirect_uris fehlt.");
  const bad = uris.find((u) => !redirectAllowed(u));
  if (bad) return err("invalid_redirect_uri", `Rücksprung-Adresse nicht erlaubt: ${bad.slice(0, 200)}`);
  // Bremse gegen massenhaftes Registrieren (ohne Anmeldung erreichbar).
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(C).where(gt(C.createdAt, new Date(Date.now() - 3600_000)));
  if (n >= 30) return err("temporarily_unavailable", "Zu viele Registrierungen – bitte später erneut.", 429);
  const method = body.token_endpoint_auth_method === "none" ? "none" : body.token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : body.token_endpoint_auth_method === undefined ? "none" : "client_secret_basic";
  const clientId = `ss_${randomToken(18)}`;
  const secret = method === "none" ? null : randomToken(32);
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null;
  await db.insert(C).values({ clientId, secretHash: secret ? sha256hex(secret) : null, name, redirectUris: uris });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name ?? undefined,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

export async function findClient(clientId: string | null | undefined) {
  if (!clientId || clientId.length > 100) return null;
  const [c] = await db.select().from(C).where(eq(C.clientId, clientId));
  return c ?? null;
}

/** Vertrauliche Programme müssen ihr Geheimnis mitschicken; öffentliche (PKCE) nicht. */
export function clientAuthOk(client: typeof C.$inferSelect, secret: string | null): boolean {
  if (!client.secretHash) return true;
  return Boolean(secret) && sha256hex(secret!) === client.secretHash;
}

// ---- Freigabe → Code -----------------------------------------------------------------------------------

export async function createAuthCode(o: { clientId: string; tenantId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string; resource: string | null }) {
  const code = randomToken(32);
  await db.insert(K).values({ codeHash: sha256hex(code), ...o, expiresAt: new Date(Date.now() + CODE_TTL_S * 1000) });
  return code;
}

async function issue(o: { tenantId: string; userId: string; clientId: string; clientName: string | null; scope: string }, replaceGrantId?: string) {
  const access = randomToken(32);
  const refresh = randomToken(40);
  const values = {
    accessHash: sha256hex(access),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    refreshHash: sha256hex(refresh),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
  };
  if (replaceGrantId) await db.update(G).set(values).where(eq(G.id, replaceGrantId));
  else await db.insert(G).values({ ...o, ...values });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: o.scope };
}

export async function exchangeCode(p: { code: string | null; clientId: string | null; redirectUri: string | null; codeVerifier: string | null; clientSecret: string | null }) {
  if (!p.code || !p.clientId) return err("invalid_request", "code und client_id sind nötig.");
  const client = await findClient(p.clientId);
  if (!client || !clientAuthOk(client, p.clientSecret)) return err("invalid_client", "Programm unbekannt oder Geheimnis falsch.", 401);
  const hash = sha256hex(p.code);
  // Einlösen und als benutzt markieren in einem Schritt – ein Code geht nur einmal.
  const [row] = await db
    .update(K)
    .set({ usedAt: new Date() })
    .where(and(eq(K.codeHash, hash), isNull(K.usedAt), gt(K.expiresAt, new Date())))
    .returning();
  if (!row) return err("invalid_grant", "Code ungültig, abgelaufen oder schon benutzt.");
  if (row.clientId !== client.clientId) return err("invalid_grant", "Code gehört zu einem anderen Programm.");
  if (p.redirectUri && p.redirectUri !== row.redirectUri) return err("invalid_grant", "redirect_uri passt nicht.");
  if (!verifyPkce(p.codeVerifier, row.codeChallenge)) return err("invalid_grant", "PKCE-Prüfung fehlgeschlagen.");
  return issue({ tenantId: row.tenantId, userId: row.userId, clientId: client.clientId, clientName: client.name, scope: row.scope });
}

export async function refreshGrant(p: { refreshToken: string | null; clientId: string | null; clientSecret: string | null }) {
  if (!p.refreshToken) return err("invalid_request", "refresh_token fehlt.");
  const [g] = await db.select().from(G).where(eq(G.refreshHash, sha256hex(p.refreshToken)));
  if (!g || g.revokedAt || g.refreshExpiresAt.getTime() < Date.now()) return err("invalid_grant", "Erneuerung ungültig oder getrennt – bitte in Claude neu verbinden.");
  if (p.clientId && p.clientId !== g.clientId) return err("invalid_grant", "Gehört zu einem anderen Programm.");
  const client = await findClient(g.clientId);
  if (!client || !clientAuthOk(client, p.clientSecret)) return err("invalid_client", "Programm unbekannt oder Geheimnis falsch.", 401);
  return issue({ tenantId: g.tenantId, userId: g.userId, clientId: g.clientId, clientName: g.clientName, scope: g.scope }, g.id);
}

/** Token zurückziehen (RFC 7009) – egal ob Zugangs- oder Erneuerungs-Token; unbekannt ist kein Fehler. */
export async function revokeToken(token: string | null) {
  if (!token) return;
  const h = sha256hex(token);
  await db.update(G).set({ revokedAt: new Date() }).where(and(isNull(G.revokedAt), sql`(${G.accessHash} = ${h} or ${G.refreshHash} = ${h})`));
}

// ---- Zugriff mit Zugangs-Token -------------------------------------------------------------------------

const touched = new Map<string, number>();

/** Zugangs-Token → Verbindung + Sitzung der Person (Rechte immer frisch aus der Mitgliedschaft). */
export async function grantFromAccessToken(token: string | null): Promise<{ grant: typeof G.$inferSelect; session: Session } | null> {
  if (!token || token.length > 200) return null;
  const [g] = await db.select().from(G).where(eq(G.accessHash, sha256hex(token)));
  if (!g || g.revokedAt || g.accessExpiresAt.getTime() < Date.now()) return null;
  const [row] = await db
    .select({
      email: schema.users.email,
      name: schema.users.name,
      tenantName: schema.tenants.name,
      role: schema.memberships.role,
      areas: schema.memberships.areas,
      brandIds: schema.memberships.brandIds,
      readOnly: schema.memberships.readOnly,
      privateAccess: schema.memberships.privateAccess,
      privateScope: schema.memberships.privateScope,
      privatePinHash: schema.memberships.privatePinHash,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(and(eq(schema.memberships.userId, g.userId), eq(schema.memberships.tenantId, g.tenantId)));
  if (!row) return null;
  if (Date.now() - (touched.get(g.id) ?? 0) > 5 * 60_000) {
    touched.set(g.id, Date.now());
    void db.update(G).set({ lastUsedAt: new Date() }).where(eq(G.id, g.id)).catch(() => {});
  }
  const readOnly = row.role === "staff" && row.readOnly;
  const session: Session = {
    userId: g.userId,
    tenantId: g.tenantId,
    role: row.role,
    areas: row.areas ?? null,
    brandIds: row.brandIds ?? null,
    readOnly,
    privateAccess: row.privateAccess && !readOnly,
    privateScope: row.privateScope,
    privatePin: Boolean(row.privatePinHash),
    // Die PIN wurde bei der Freigabe abgefragt; die Verbindung selbst ist der Schlüssel.
    privateUnlockedUntil: null,
    sessionId: `claude:${g.id}`,
    email: row.email,
    name: row.name,
    tenantName: row.tenantName,
  };
  return { grant: g, session };
}

export async function listGrants(tenantId: string) {
  return db
    .select({ id: G.id, clientName: G.clientName, scope: G.scope, createdAt: G.createdAt, lastUsedAt: G.lastUsedAt, userName: schema.users.name, userEmail: schema.users.email })
    .from(G)
    .innerJoin(schema.users, eq(schema.users.id, G.userId))
    .where(and(eq(G.tenantId, tenantId), isNull(G.revokedAt), gt(G.refreshExpiresAt, new Date())))
    .orderBy(desc(G.createdAt));
}

export async function revokeGrant(tenantId: string, id: string) {
  const r = await db.update(G).set({ revokedAt: new Date() }).where(and(eq(G.tenantId, tenantId), eq(G.id, id), isNull(G.revokedAt))).returning({ id: G.id });
  return r.length > 0;
}

// ---- Freigabe-Anfrage prüfen (Seite /oauth/authorize und deren Aktion) -------------------------------

export type AuthRequest = { clientId: string; clientName: string | null; redirectUri: string; state: string | null; codeChallenge: string; scope: string[]; resource: string | null };

/**
 * Prüft die Anfrage von Claude. `fatal` = nicht zurückleiten (unbekanntes Programm / fremde Adresse),
 * `redirectError` = Fehler an Claude zurückgeben, sonst die geprüften Werte.
 */
export async function checkAuthRequest(p: Record<string, string | undefined>): Promise<{ fatal: string } | { redirectError: string; description: string; redirectUri: string; state: string | null } | { ok: AuthRequest }> {
  const client = await findClient(p.client_id);
  if (!client) return { fatal: "Unbekanntes Programm – bitte in Claude die Verbindung neu hinzufügen." };
  const redirectUri = p.redirect_uri || (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !redirectAllowed(redirectUri)) return { fatal: "Die Rücksprung-Adresse passt nicht zum Programm." };
  const state = p.state ?? null;
  if (p.response_type !== "code") return { redirectError: "unsupported_response_type", description: "Nur response_type=code.", redirectUri, state };
  if (!p.code_challenge || (p.code_challenge_method ?? "plain") !== "S256") return { redirectError: "invalid_request", description: "PKCE mit S256 ist Pflicht.", redirectUri, state };
  return { ok: { clientId: client.clientId, clientName: client.name, redirectUri, state, codeChallenge: p.code_challenge, scope: parseScope(p.scope), resource: p.resource ?? null } };
}
