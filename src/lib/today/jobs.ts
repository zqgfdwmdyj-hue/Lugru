import "server-only";
import { sql } from "drizzle-orm";
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
