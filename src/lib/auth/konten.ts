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

/**
 * B25.9: Privat „voll“ nur für Inhaber – bestehende Werte bei Mitarbeiter-/VA-Konten auf „kein Zugang“ setzen (die
 * Sperre galt bisher nur bei der Neuwahl). Hinweis an den Inhaber als Aufgabe; nichts wird gelöscht.
 */
export async function privatVollBereinigen(tenantId: string): Promise<number> {
  const M = schema.memberships;
  const rows = await db
    .update(M)
    .set({ privateAccess: false })
    .where(and(eq(M.tenantId, tenantId), eq(M.role, "staff"), eq(M.privateAccess, true), eq(M.privateScope, "voll")))
    .returning({ userId: M.userId });
  if (!rows.length) return 0;
  const namen = await db.select({ email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, rows.map((r) => r.userId)));
  const key = `privat-voll-bereinigt:${todayIso()}`;
  // Mehrere Bereinigungen am selben Tag: Konten in einer Aufgabe sammeln.
  const [alt] = await db.select({ notes: schema.tasks.notes }).from(schema.tasks).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.systemKey, key))).limit(1);
  const frueher = alt?.notes ? alt.notes.split(" – ")[0].split(", ").map((x) => x.trim()).filter(Boolean) : [];
  const alle = [...new Set([...namen.map((n) => n.email), ...frueher])];
  await upsertSystemTask(db, tenantId, key, {
    title: `Privat-Zugang bereinigt: ${alle.length} ${alle.length === 1 ? "Konto" : "Konten"} von „voll“ auf „kein Zugang“`,
    notes: `${alle.join(", ")} – Privat „voll“ ist nur für Inhaber erlaubt. Wer Familienzeiten sehen soll, bekommt unter Einstellungen → Benutzer „nur Familie“.`.slice(0, 480),
    category: "eigene",
    link: "/einstellungen#benutzer",
  });
  return rows.length;
}
