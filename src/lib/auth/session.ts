import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { canAccess, homeFor, type AreaKey } from "./areas";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type Session = {
  userId: string;
  tenantId: string;
  role: "owner" | "staff";
  /** Freigegebene Bereiche (null = alle) und Marken (null = alle). */
  areas: string[] | null;
  brandIds: string[] | null;
  email: string;
  name: string | null;
  tenantName: string;
};

export async function createSession(userId: string, tenantId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(schema.sessions).values({ id: hash(token), userId, tenantId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Über https immer „secure“; lokal über http (z. B. Docker auf dem eigenen PC) geht es sonst in Safari nicht.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hash(token)));
  store.delete(SESSION_COOKIE);
}

/** Aktuelle Sitzung inkl. Mandant und Rolle – einmal pro Anfrage aus der Datenbank. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      tenantId: schema.tenants.id,
      tenantName: schema.tenants.name,
      role: schema.memberships.role,
      areas: schema.memberships.areas,
      brandIds: schema.memberships.brandIds,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.sessions.tenantId))
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.memberships.userId, schema.sessions.userId),
        eq(schema.memberships.tenantId, schema.sessions.tenantId),
      ),
    )
    .where(and(eq(schema.sessions.id, hash(token)), gt(schema.sessions.expiresAt, new Date())));
  return row ?? null;
});

/** Für Seiten und Server Actions: ohne gültige Sitzung geht es zum Login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Für Seiten und Server Actions eines Bereichs: Mitarbeiter ohne Freigabe landen auf ihrer
 * Startseite. Mehrere Bereiche = einer davon genügt.
 */
export async function requireArea(...areas: AreaKey[]): Promise<Session> {
  const session = await requireSession();
  if (!areas.some((a) => canAccess(session, a))) redirect(`${homeFor(session)}?gesperrt=1`);
  return session;
}

/** Nur für Inhaber (Einstellungen, Anbindungen, Benutzer). */
export async function requireOwner(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/");
  return session;
}
