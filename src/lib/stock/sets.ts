import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SetDef } from "./channel-logic";

// Sets (z. B. „Komplettset“ aus einem eBay-Mehrfachangebot): Verkaufs-SKU ohne eigenes Lager.

export async function loadSets(tenantId: string): Promise<SetDef[]> {
  const rows = await db.select({ sku: schema.stockSets.sku, components: schema.stockSets.components }).from(schema.stockSets).where(eq(schema.stockSets.tenantId, tenantId));
  return rows.map((r) => ({ sku: r.sku, components: r.components ?? [] }));
}

/** Set-Definition anlegen oder ändern. */
export async function saveSet(tenantId: string, sku: string, components: SetDef["components"], title?: string) {
  await db
    .insert(schema.stockSets)
    .values({ tenantId, sku, components, title: title ?? null })
    .onConflictDoUpdate({ target: [schema.stockSets.tenantId, schema.stockSets.sku], set: { components, title: title ?? null, updatedAt: new Date() } });
}

/**
 * Lager einer Wawi-SKU ändern und als Bewegung festhalten. Ist die SKU ein Set (ohne eigenes
 * Lager), wird auf die Bestandteile gebucht. Gibt die berührten SKUs zurück (für den Abgleich).
 */
export async function adjustStock(
  tenantId: string,
  sku: string,
  delta: number,
  reason: string,
  reference: string | null,
  userId: string | null,
): Promise<string[]> {
  const [own] = await db.select({ id: schema.ownStock.id }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, tenantId), eq(schema.ownStock.sku, sku)));
  if (!own) {
    const [set] = await db.select().from(schema.stockSets).where(and(eq(schema.stockSets.tenantId, tenantId), eq(schema.stockSets.sku, sku)));
    if (set?.components?.length) {
      const touched: string[] = [sku];
      for (const c of set.components) touched.push(...(await adjustStock(tenantId, c.sku, delta * c.qty, `${reason} (Set ${sku})`, reference, userId)));
      return touched;
    }
  }
  await db
    .insert(schema.ownStock)
    .values({ tenantId, sku, quantity: delta })
    .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: sql`${schema.ownStock.quantity} + ${delta}`, updatedAt: new Date() } });
  await db.insert(schema.stockMovements).values({ tenantId, sku, delta, reason, reference, userId });
  return [sku];
}
