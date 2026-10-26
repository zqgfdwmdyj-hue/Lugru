import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";

/**
 * Stand des FBA-Bestandsberichts: Ohne Bericht ist der Amazon-Bestand unbekannt (nicht 0). Älter als
 * `maxAgeDays` gilt als veraltet. Eine Stelle für Produktliste, Produktseite und Bestand.
 */
export type FbaReport = { snapshot: string | null; ageDays: number | null; missing: boolean; stale: boolean; source: "report" | "sellerboard" | null };

export async function fbaReport(tenantId: string, maxAgeDays = 2): Promise<FbaReport> {
  const [r] = await db
    .select({
      snap: sql<string | null>`max(${schema.amazonInventory.snapshotDate})::text`,
      // Herkunft des neuesten Stands (Bericht oder sellerboard)
      src: sql<string | null>`(array_agg(${schema.amazonInventory.source} order by ${schema.amazonInventory.snapshotDate} desc, ${schema.amazonInventory.updatedAt} desc))[1]`,
    })
    .from(schema.amazonInventory)
    .where(eq(schema.amazonInventory.tenantId, tenantId));
  const snapshot = r?.snap ?? null;
  const ageDays = snapshot ? Math.round((Date.parse(`${todayIso()}T12:00:00Z`) - Date.parse(`${snapshot.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null;
  const source = r?.src === "sellerboard" ? "sellerboard" : r?.src === "report" ? "report" : null;
  return { snapshot, ageDays, missing: snapshot === null, stale: ageDays !== null && ageDays > maxAgeDays, source };
}
