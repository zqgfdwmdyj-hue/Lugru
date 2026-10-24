import "server-only";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";

/** Ergebnis eines Hintergrund-Abrufs merken (Erfolg oder Fehler) – Fehler hier nie weiterwerfen. */
export async function recordJob(tenantId: string, name: string, error: string | null) {
  const J = schema.jobRuns;
  const now = new Date();
  try {
    await db
      .insert(J)
      .values({ tenantId, name, ...(error ? { lastErrorAt: now, lastError: error.slice(0, 500) } : { lastOkAt: now }), updatedAt: now })
      .onConflictDoUpdate({
        target: [J.tenantId, J.name],
        set: error ? { lastErrorAt: now, lastError: error.slice(0, 500), updatedAt: now } : { lastOkAt: now, updatedAt: now, lastError: sql`case when ${J.lastErrorAt} is not null and ${J.lastErrorAt} > ${J.lastOkAt} then ${J.lastError} else null end` },
      });
  } catch {
    // Protokoll ist Zusatz – ein Fehler hier darf den Abruf nicht stören.
  }
}
