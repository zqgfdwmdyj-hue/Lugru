import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { B2bZeile } from "./logic";

// B2B-Werte je Land und Zeitraum speichern (gleicher Zeitraum wird ersetzt). Ohne Bezug zur Schnittstelle.

export async function speichereB2bPeriode(tenantId: string, land: string, von: string, bis: string, zeilen: B2bZeile[], quelle: "api" | "upload"): Promise<number> {
  const P = schema.amazonB2bPerioden;
  const now = new Date();
  const uniq = [...new Map(zeilen.map((z) => [z.asin, z])).values()];
  await db.transaction(async (tx) => {
    await tx.delete(P).where(and(eq(P.tenantId, tenantId), eq(P.land, land), eq(P.von, von), eq(P.bis, bis)));
    for (let i = 0; i < uniq.length; i += 500) await tx.insert(P).values(uniq.slice(i, i + 500).map((z) => ({ tenantId, land, von, bis, ...z, quelle, abgerufenAm: now })));
  });
  // Älter als 13 Monate: weg.
  const grenze = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  await db.delete(P).where(and(eq(P.tenantId, tenantId), lt(P.bis, grenze)));
  return uniq.length;
}
