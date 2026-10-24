import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MemberPrefs } from "@/db/schema";
import type { Session } from "./session";

/** Persönliche Einstellungen der angemeldeten Person in dieser Firma. */
export async function getPrefs(session: Pick<Session, "tenantId" | "userId">): Promise<MemberPrefs> {
  const [m] = await db
    .select({ prefs: schema.memberships.prefs })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, session.userId)));
  return m?.prefs ?? {};
}

export async function updatePrefs(session: Pick<Session, "tenantId" | "userId">, fn: (p: MemberPrefs) => MemberPrefs) {
  const next = fn(await getPrefs(session));
  await db
    .update(schema.memberships)
    .set({ prefs: next })
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, session.userId)));
  return next;
}

/** Nur interne Pfade als Favorit (kein offener Weiterleiter). */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^\/(?!\/)[^\s]*$/.test(h) && h.length <= 300 ? h : null;
}
