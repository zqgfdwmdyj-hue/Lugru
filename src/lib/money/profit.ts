import "server-only";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Gewinn aus Amazon-Abrechnungen (Settlement) und EK je SKU.
// Vereinfachungen (auch in der Oberfläche genannt): Umsatz wird mit dem Standard-MwSt-Satz
// auf netto gerechnet; erstattete Einheiten gelten als wieder im Bestand (kein Wareneinsatz).

export type SkuProfit = {
  sku: string;
  asin: string | null;
  title: string | null;
  units: number;
  refunds: number;
  revenueGross: number;
  revenueNet: number;
  fees: number;
  promotions: number;
  reimbursements: number;
  other: number;
  unitCost: number | null;
  cogs: number | null;
  profit: number | null;
  plannedPrice: number | null;
  avgPrice: number | null;
};

export async function amazonProfit(tenantId: string, from: string, to: string, vatRate: number) {
  const S = schema.amazonSettlementLines;
  const rows = await db
    .select({
      sku: S.sku,
      units: sql<number>`coalesce(sum(${S.quantity}) filter (where ${S.transactionType} = 'Order' and ${S.amountType} = 'ItemPrice' and ${S.amountDescription} = 'Principal'), 0)::int`,
      refunds: sql<number>`count(*) filter (where ${S.transactionType} ilike 'Refund%' and ${S.amountType} = 'ItemPrice' and ${S.amountDescription} = 'Principal')::int`,
      revenue: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} = 'ItemPrice' and ${S.amountDescription} in ('Principal', 'Shipping', 'GiftWrap')), 0)::float`,
      fees: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} = 'ItemFees'), 0)::float`,
      promotions: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} = 'Promotion'), 0)::float`,
      reimb: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.transactionType} ilike '%reimburs%' or ${S.amountDescription} ilike any (array['%reimburs%', 'WAREHOUSE_%', 'COMPENSATED_%', 'FREE_REPLACEMENT_REFUND_ITEMS'])), 0)::float`,
      total: sql<number>`coalesce(sum(${S.amount}), 0)::float`,
    })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), gte(S.postedDate, from), lte(S.postedDate, to), sql`${S.sku} is not null`))
    .groupBy(S.sku);

  const lots = rows.length
    ? await db
        .select({ sku: schema.lots.sku, cost: schema.lots.unitCostNet, target: schema.lots.skuTargetPrice, asin: schema.products.asin, title: schema.products.title })
        .from(schema.lots)
        .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
        .where(eq(schema.lots.tenantId, tenantId))
    : [];
  const bySku = new Map(lots.map((l) => [l.sku, l]));

  const skus: SkuProfit[] = rows.map((r) => {
    const lot = bySku.get(r.sku!);
    const unitCost = lot?.cost ? Number(lot.cost) : null;
    const netUnits = Math.max(0, r.units - r.refunds);
    const revenueNet = r.revenue / (1 + vatRate);
    const other = r.total - r.revenue - r.fees - r.promotions - r.reimb;
    const cogs = unitCost === null ? null : unitCost * netUnits;
    const profit = cogs === null ? null : revenueNet + r.fees + r.promotions / (1 + vatRate) + r.reimb + other - cogs;
    return {
      sku: r.sku!,
      asin: lot?.asin ?? null,
      title: lot?.title ?? null,
      units: r.units,
      refunds: r.refunds,
      revenueGross: r.revenue,
      revenueNet,
      fees: r.fees,
      promotions: r.promotions,
      reimbursements: r.reimb,
      other,
      unitCost,
      cogs,
      profit,
      plannedPrice: lot?.target ? Number(lot.target) : null,
      avgPrice: r.units > 0 ? r.revenue / r.units : null,
    };
  });

  const nonSku = await db
    .select({ description: S.amountDescription, type: S.transactionType, amount: sql<number>`sum(${S.amount})::float` })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), gte(S.postedDate, from), lte(S.postedDate, to), sql`${S.sku} is null`))
    .groupBy(S.amountDescription, S.transactionType)
    .orderBy(sql`sum(${S.amount})`);

  return { skus, nonSku };
}

/** Andere Kanäle: Umsatz aus Aufträgen minus EK (Gebühren der Kanäle sind nicht bekannt). */
export async function otherChannelProfit(tenantId: string, from: string, to: string, vatRate: number) {
  const O = schema.orders;
  const I = schema.orderItems;
  return db
    .select({
      channel: O.channel,
      orders: sql<number>`count(distinct ${O.id})::int`,
      revenue: sql<number>`coalesce(sum(${I.price} * ${I.quantity}), 0)::float`,
      revenueNet: sql<number>`coalesce(sum(${I.price} * ${I.quantity}), 0)::float / ${1 + vatRate}`,
      cogs: sql<number>`coalesce(sum(${schema.lots.unitCostNet} * ${I.quantity}), 0)::float`,
      missingCost: sql<number>`count(*) filter (where ${schema.lots.unitCostNet} is null)::int`,
    })
    .from(O)
    .innerJoin(I, eq(I.orderId, O.id))
    .leftJoin(schema.lots, and(eq(schema.lots.tenantId, tenantId), eq(schema.lots.sku, I.sku)))
    .where(and(eq(O.tenantId, tenantId), ne(O.channel, "amazon"), ne(O.status, "cancelled"), gte(O.orderDate, new Date(`${from}T00:00:00Z`)), lte(O.orderDate, new Date(`${to}T23:59:59Z`))))
    .groupBy(O.channel);
}
