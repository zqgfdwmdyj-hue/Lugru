import "server-only";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/** Ergebnis eines Hintergrund-Abrufs merken (Erfolg oder Fehler) – Fehler hier nie weiterwerfen. */
export async function recordJob(tenantId: string, name: string, error: string | null, durationMs?: number) {
  const J = schema.jobRuns;
  const now = new Date();
  const dur = durationMs === undefined ? null : Math.min(2_000_000_000, Math.round(durationMs));
  try {
    await db
      .insert(J)
      .values({ tenantId, name, ...(error ? { lastErrorAt: now, lastError: error.slice(0, 500) } : { lastOkAt: now }), lastDurationMs: dur, updatedAt: now })
      .onConflictDoUpdate({
        target: [J.tenantId, J.name],
        set: error ? { lastErrorAt: now, lastError: error.slice(0, 500), lastDurationMs: dur, updatedAt: now } : { lastOkAt: now, updatedAt: now, lastDurationMs: dur, lastError: sql`case when ${J.lastErrorAt} is not null and ${J.lastErrorAt} > ${J.lastOkAt} then ${J.lastError} else null end` },
      });
  } catch {
    // Protokoll ist Zusatz – ein Fehler hier darf den Abruf nicht stören.
  }
}

export type JobStand = { text: string; at: Date | null; fehler: string | null };

/**
 * Datenstand aus den Hintergrund-Abrufen: letzter erfolgreicher Abruf der genannten Jobs („sellerboard:*“ = alle
 * mit diesem Anfang) und ob danach ein Fehler kam. Für Kennzahlen („Stand …“) und Claude-Werkzeuge.
 */
export async function jobStand(tenantId: string, jobs: string[]): Promise<JobStand> {
  const J = schema.jobRuns;
  const names = jobs.filter((j) => !j.endsWith("*"));
  const prefixes = jobs.filter((j) => j.endsWith("*")).map((j) => j.slice(0, -1));
  const conds = [...(names.length ? [inArray(J.name, names)] : []), ...prefixes.map((p) => like(J.name, `${p}%`))];
  if (!conds.length) return { text: "aktuell", at: null, fehler: null };
  const rows = await db
    .select({ name: J.name, ok: J.lastOkAt, errAt: J.lastErrorAt, err: J.lastError })
    .from(J)
    .where(and(eq(J.tenantId, tenantId), or(...conds)));
  const at = rows.map((r) => r.ok).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const failing = rows.filter((r) => r.errAt && (!r.ok || r.errAt > r.ok));
  const fehler = failing.length ? failing.map((r) => `${r.name}: ${r.err ?? "Fehler"}`).join("; ").slice(0, 300) : null;
  const text = !rows.length ? "noch kein Abruf" : at ? `zuletzt abgerufen ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(at)}` : "noch kein erfolgreicher Abruf";
  return { text, at, fehler };
}
