import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";

// Persönliche Schlüssel je Gerät für die Handy-Endpunkte /api/mobil/* (Schnellerfassung, Widget, Fahrt, Scan).
// Gespeichert wird nur die Prüfsumme; Rate-Limit und Protokoll je Aufruf. Widerrufen = sofort ungültig.

const TOK = schema.apiTokens;
const LOG = schema.mobilProtokoll;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function mobilTokenAnlegen(tenantId: string, userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = `mk_${randomBytes(24).toString("base64url")}`;
  const [t] = await db.insert(TOK).values({ tenantId, userId, name: name.trim().slice(0, 80) || "Handy", zweck: "mobil", tokenHash: hash(token), anfang: token.slice(0, 7) }).returning({ id: TOK.id });
  return { id: t.id, token };
}

export async function mobilTokenWiderrufen(tenantId: string, userId: string, id: string) {
  await db.update(TOK).set({ revokedAt: new Date() }).where(and(eq(TOK.tenantId, tenantId), eq(TOK.userId, userId), eq(TOK.id, id), eq(TOK.zweck, "mobil"), isNull(TOK.revokedAt)));
}

export async function mobilTokens(tenantId: string, userId: string) {
  return db
    .select({ id: TOK.id, name: TOK.name, anfang: TOK.anfang, lastUsedAt: TOK.lastUsedAt, revokedAt: TOK.revokedAt, createdAt: TOK.createdAt })
    .from(TOK)
    .where(and(eq(TOK.tenantId, tenantId), eq(TOK.userId, userId), eq(TOK.zweck, "mobil")))
    .orderBy(desc(TOK.createdAt));
}

/** Sitzung der Person hinter dem Schlüssel (ohne Anmeldung) – mit ihren Rechten, nie mehr. */
export async function sitzungFuer(tenantId: string, userId: string, tokenId: string): Promise<Session | null> {
  const M = schema.memberships;
  const [r] = await db
    .select({ role: M.role, areas: M.areas, brandIds: M.brandIds, readOnly: M.readOnly, privateAccess: M.privateAccess, privateScope: M.privateScope, email: schema.users.email, name: schema.users.name, tenantName: schema.tenants.name })
    .from(M)
    .innerJoin(schema.users, eq(schema.users.id, M.userId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, M.tenantId))
    .where(and(eq(M.tenantId, tenantId), eq(M.userId, userId)));
  if (!r) return null;
  return {
    userId,
    tenantId,
    role: r.role,
    areas: r.role === "owner" ? null : (r.areas ?? null),
    brandIds: r.brandIds ?? null,
    readOnly: r.role === "staff" && r.readOnly,
    // Privat nur ohne PIN-Sperre sinnvoll nutzbar; Nur-ansehen-Konten nie.
    privateAccess: r.privateAccess && !(r.role === "staff" && r.readOnly),
    privateScope: r.privateScope,
    privatePin: false,
    privateUnlockedUntil: null,
    sessionId: `mobil:${tokenId}`,
    email: r.email,
    name: r.name,
    tenantName: r.tenantName,
  };
}

export type MobilPruefung = { ok: true; session: Session; tokenId: string } | { ok: false; status: number; fehler: string };

/**
 * Schlüssel aus „Authorization: Bearer mk_…“ prüfen, Rate-Limit (30 Aufrufe in 10 Minuten, 500 am Tag je Schlüssel)
 * und Aufruf protokollieren. Nur-ansehen-Konten dürfen nichts anlegen (`schreibend`).
 */
export async function mobilPruefen(req: Request, endpunkt: string, o: { schreibend?: boolean } = {}): Promise<MobilPruefung> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^mk_[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, status: 401, fehler: "Ungültiger Schlüssel." };
  const [t] = await db.select().from(TOK).where(and(eq(TOK.tokenHash, hash(token)), eq(TOK.zweck, "mobil")));
  if (!t || t.revokedAt) return { ok: false, status: 401, fehler: t ? "Schlüssel widerrufen." : "Ungültiger Schlüssel." };
  const log = (status: number) => db.insert(LOG).values({ tenantId: t.tenantId, tokenId: t.id, userId: t.userId, endpunkt: endpunkt.slice(0, 60), status }).catch(() => null);
  const session = await sitzungFuer(t.tenantId, t.userId, t.id);
  if (!session) {
    await log(403);
    return { ok: false, status: 403, fehler: "Kein Zugang mehr zu dieser Firma." };
  }
  if (o.schreibend && session.readOnly) {
    await log(403);
    return { ok: false, status: 403, fehler: "Nur-ansehen-Konto – Anlegen nicht erlaubt." };
  }
  const [{ kurz, tag }] = (
    await db.execute<{ kurz: number; tag: number }>(sql`select count(*) filter (where created_at > now() - interval '10 minutes')::int as kurz, count(*) filter (where created_at > now() - interval '1 day')::int as tag from mobil_protokoll where token_id = ${t.id}`)
  ).rows;
  if (kurz >= 30 || tag >= 500) {
    await log(429);
    return { ok: false, status: 429, fehler: "Zu viele Aufrufe – bitte später erneut." };
  }
  await log(200);
  await db.update(TOK).set({ lastUsedAt: new Date() }).where(eq(TOK.id, t.id));
  return { ok: true, session, tokenId: t.id };
}

/** Protokoll der letzten Aufrufe (für die Einstellungsseite). */
export async function mobilProtokollListe(tenantId: string, userId: string, limit = 30) {
  return db.select({ endpunkt: LOG.endpunkt, status: LOG.status, createdAt: LOG.createdAt }).from(LOG).where(and(eq(LOG.tenantId, tenantId), eq(LOG.userId, userId))).orderBy(desc(LOG.createdAt)).limit(limit);
}
