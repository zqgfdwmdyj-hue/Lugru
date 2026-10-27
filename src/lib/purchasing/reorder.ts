import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { correctedProfit } from "@/lib/hebel/rules";
import { skuCostMap } from "@/lib/money/costs";
import { buildReorderRows, type ReorderRow } from "./reorder-logic";

// Nachbestellen laut sellerboard – angereichert mit dem gültigen EK, Retouren-Zuordnung, Bezugsquelle und Marge.

export type SbReorder = { rows: ReorderRow[]; syncedAt: Date | null };

export async function sellerboardReorder(tenantId: string): Promise<SbReorder> {
  const t = tenantId;
  const SBI = schema.sellerboardInventory;
  const inv = await db
    .select()
    .from(SBI)
    .where(and(eq(SBI.tenantId, t), gt(SBI.qtyToReorder, 0), sql`upper(coalesce(${SBI.timeToReorder}, '')) in ('YES', 'SOON')`));
  if (!inv.length) return { rows: [], syncedAt: null };
  const asins = [...new Set(inv.map((r) => r.asin).filter((a): a is string => Boolean(a)))];
  const L = schema.lots;
  const P = schema.products;
  const S = schema.sellerboardSkuStats;
  const [costs, returnLots, buyLots, offers, stats] = await Promise.all([
    skuCostMap(t),
    db
      .select({ sku: L.sku, parentSku: sql<string | null>`(select p2.sku from lots p2 where p2.id = ${L.parentLotId})` })
      .from(L)
      .where(and(eq(L.tenantId, t), eq(L.kind, "return"))),
    asins.length
      ? db
          .select({ sku: L.sku, asin: P.asin, supplier: sql<string | null>`coalesce(${schema.suppliers.name}, ${schema.suppliers.code})`, date: L.purchaseDate })
          .from(L)
          .innerJoin(P, eq(P.id, L.productId))
          .leftJoin(schema.suppliers, eq(schema.suppliers.id, L.supplierId))
          .where(and(eq(L.tenantId, t), eq(L.kind, "purchase"), inArray(P.asin, asins)))
          .orderBy(sql`${L.purchaseDate} desc nulls last`)
      : Promise.resolve([]),
    asins.length
      ? db
          .select({ asin: schema.supplierOffers.asin, price: schema.supplierOffers.price, stock: schema.supplierOffers.stock, feed: sql<string>`coalesce(${schema.suppliers.code}, ${schema.supplierFeeds.name})` })
          .from(schema.supplierOffers)
          .innerJoin(schema.supplierFeeds, eq(schema.supplierFeeds.id, schema.supplierOffers.feedId))
          .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplierFeeds.supplierId))
          .where(and(eq(schema.supplierOffers.tenantId, t), inArray(schema.supplierOffers.asin, asins)))
      : Promise.resolve([]),
    db.select({ sku: S.sku, sales: S.sales, netProfit: S.netProfit, units: S.units, costMissing: S.costMissing, productCosts: S.productCosts }).from(S).where(and(eq(S.tenantId, t), eq(S.channel, "amazon"))),
  ]);
  const purchasable = new Map<string, { sku: string; supplier: string | null }[]>();
  for (const l of buyLots) if (l.asin) purchasable.set(l.asin, [...(purchasable.get(l.asin) ?? []), { sku: l.sku, supplier: l.supplier }]);
  const feeds = new Map<string, { supplier: string; price: number }>();
  for (const o of offers) {
    if (!o.asin || o.price == null || (o.stock !== null && o.stock <= 0)) continue;
    const cur = feeds.get(o.asin);
    if (!cur || o.price < cur.price) feeds.set(o.asin, { supplier: o.feed, price: o.price });
  }
  const margin = new Map<string, number | null>();
  for (const s of stats) {
    const own = costs.get(s.sku);
    const p = correctedProfit({ netProfit: s.netProfit, units: s.units, costMissing: s.costMissing, productCosts: s.productCosts }, own && own.source !== "sellerboard" ? own.cost : null);
    margin.set(s.sku, p !== null && s.sales && s.sales > 0 ? Math.round((p / s.sales) * 1000) / 10 : null);
  }
  const rows = buildReorderRows(
    inv.map((r) => ({
      id: r.id,
      sku: r.sku,
      asin: r.asin,
      name: r.name,
      fbaStock: r.fbaStock,
      reserved: r.reserved,
      inbound: r.inbound,
      salesVelocity: r.salesVelocity === null ? null : Number(r.salesVelocity),
      daysLeft: r.daysLeft,
      timeToReorder: r.timeToReorder,
      daysToReorder: r.daysToReorder,
      qtyToReorder: r.qtyToReorder,
      sbCost: r.cost,
    })),
    { today: todayIso(), costs, returnLots: new Map(returnLots.map((r) => [r.sku, r.parentSku])), purchasable, feeds, margin },
  );
  const syncedAt = inv.reduce<Date | null>((m, r) => (!m || r.syncedAt > m ? r.syncedAt : m), null);
  return { rows, syncedAt };
}
