import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
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
  /** Nur ansehen: Server Actions werden abgewiesen (siehe requireSession), schreibende Anfragen im Proxy. */
  readOnly: boolean;
  /** Zugang zu „Privat“; mit PIN nur offen, solange `privateUnlockedUntil` in der Zukunft liegt. */
  privateAccess: boolean;
  privatePin: boolean;
  privateUnlockedUntil: Date | null;
  sessionId: string;
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
      readOnly: schema.memberships.readOnly,
      privateAccess: schema.memberships.privateAccess,
      privatePinHash: schema.memberships.privatePinHash,
      privateUnlockedUntil: schema.sessions.privateUnlockedUntil,
      sessionId: schema.sessions.id,
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
  if (!row) return null;
  touchLastSeen(row.userId);
  const { privatePinHash, ...rest } = row;
  // Inhaber sind nie „nur ansehen“.
  return { ...rest, privatePin: Boolean(privatePinHash), readOnly: row.role === "staff" && row.readOnly };
});

// „Zuletzt aktiv“ höchstens alle 5 Minuten je Benutzer schreiben – nicht bei jeder Anfrage.
const lastTouch = new Map<string, number>();
function touchLastSeen(userId: string) {
  const now = Date.now();
  if (now - (lastTouch.get(userId) ?? 0) < 5 * 60_000) return;
  lastTouch.set(userId, now);
  void db
    .update(schema.users)
    .set({ lastSeenAt: new Date(now) })
    .where(eq(schema.users.id, userId))
    .catch(() => lastTouch.delete(userId));
}

/** Hinweis in der Adresse, wenn eine Aktion für ein Nur-ansehen-Konto nicht ausgeführt wurde. */
export const READ_ONLY_PARAM = "nurlesen";

/**
 * Nur-ansehen-Konten: jede Server Action wird hier abgewiesen – alle Actions holen die Sitzung über
 * requireSession/requireArea/requireOwner. Zurück auf die Seite, von der der Klick kam.
 */
async function blockReadOnlyAction(session: Session) {
  if (!session.readOnly) return;
  const h = await headers();
  if (!h.get("next-action")) return;
  let target = homeFor(session);
  try {
    const u = new URL(h.get("referer") ?? "");
    u.searchParams.delete("meldung");
    u.searchParams.set(READ_ONLY_PARAM, "1");
    target = `${u.pathname}${u.search}`;
  } catch {
    // ohne Referer zur Startseite
  }
  redirect(target);
}

/** Für Seiten und Server Actions: ohne gültige Sitzung geht es zum Login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  await blockReadOnlyAction(session);
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
