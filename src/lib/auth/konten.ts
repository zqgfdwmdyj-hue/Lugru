import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { upsertSystemTask } from "@/lib/tasks/system";
import { todayIso } from "@/lib/dates";
import { NIE_ANGEMELDET_TAGE, nieAngemeldetZuDeaktivieren } from "./rollen";

// B20.1: Konten, die sich nie angemeldet haben und älter als 30 Tage sind, täglich deaktivieren – mit Hinweis als
// Aufgabe für den Inhaber. Nichts wird gelöscht; „Wieder aktivieren“ unter Einstellungen → Benutzer.

export async function nieAngemeldeteDeaktivieren(tenantId: string, jetzt = new Date()): Promise<number> {
  const M = schema.memberships;
  const rows = await db
    .select({ userId: M.userId, role: M.role, createdAt: M.createdAt, deaktiviertAm: M.deaktiviertAm, lastLoginAt: schema.users.lastLoginAt, email: schema.users.email })
    .from(M)
    .innerJoin(schema.users, eq(schema.users.id, M.userId))
    .where(eq(M.tenantId, tenantId));
  const ids = nieAngemeldetZuDeaktivieren(rows, { jetzt });
  if (!ids.length) return 0;
  await db
    .update(M)
    .set({ deaktiviertAm: jetzt, deaktiviertGrund: `automatisch: nie angemeldet, seit über ${NIE_ANGEMELDET_TAGE} Tagen angelegt` })
    .where(and(eq(M.tenantId, tenantId), inArray(M.userId, ids)));
  await db.delete(schema.sessions).where(and(eq(schema.sessions.tenantId, tenantId), inArray(schema.sessions.userId, ids)));
  const namen = rows.filter((r) => ids.includes(r.userId)).map((r) => r.email);
  await upsertSystemTask(db, tenantId, `konten-deaktiviert:${todayIso()}`, {
    title: `${ids.length} ${ids.length === 1 ? "Konto" : "Konten"} automatisch deaktiviert (nie angemeldet)`,
    notes: `${namen.join(", ")} – seit über ${NIE_ANGEMELDET_TAGE} Tagen angelegt und nie angemeldet. Bei Bedarf unter Einstellungen → Benutzer wieder aktivieren oder entfernen.`.slice(0, 480),
    category: "eigene",
    link: "/einstellungen#benutzer",
  });
  return ids.length;
}
