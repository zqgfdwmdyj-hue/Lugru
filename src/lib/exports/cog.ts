import "server-only";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CogRow } from "./accountone";

export async function loadCogRows(tenantId: string): Promise<CogRow[]> {
  const L = schema.lots;
  const rows = await db
    .select({ asin: schema.products.asin, sku: L.sku, cost: L.unitCostNet })
    .from(L)
    .innerJoin(schema.products, eq(schema.products.id, L.productId))
    .where(and(eq(L.tenantId, tenantId), isNotNull(L.unitCostNet)))
    .orderBy(asc(L.createdAt), asc(L.sku));
  return rows.map((r) => ({ asin: r.asin, sku: r.sku, unitCostNet: Number(r.cost) }));
}

export async function cogSummary(tenantId: string) {
  const L = schema.lots;
  const [withCost] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), isNotNull(L.unitCostNet)));
  const [withoutCost] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), isNull(L.unitCostNet)));
  const [inherited] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.unitCostSource, "inherited")));
  return { withCost: withCost.n, withoutCost: withoutCost.n, inherited: inherited.n };
}
