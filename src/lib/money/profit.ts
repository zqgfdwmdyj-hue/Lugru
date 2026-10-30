import "server-only";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { abrechnungNetto, istGeldbewegung, type CostInfo, type OrderLine } from "./profit-logic";

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
  /** Gebühren + Aktionen (netto) + Erstattungen + Sonstiges – alles außer Umsatz, USt. und EK. */
  costsExCogs: number;
  /** USt. eigens ausgewiesen → „Principal“ ist schon netto. */
  vatSeparate: boolean;
  unitCost: number | null;
  cogs: number | null;
  profit: number | null;
  plannedPrice: number | null;
  avgPrice: number | null;
};

export async function amazonProfit(tenantId: string, from: string, to: string, vatRate: number, costs?: Map<string, CostInfo>) {
  const S = schema.amazonSettlementLines;
  const rows = await db
    .select({
      sku: S.sku,
      units: sql<number>`coalesce(sum(${S.quantity}) filter (where ${S.transactionType} = 'Order' and ${S.amountType} = 'ItemPrice' and ${S.amountDescription} = 'Principal'), 0)::int`,
      refunds: sql<number>`count(*) filter (where ${S.transactionType} ilike 'Refund%' and ${S.amountType} = 'ItemPrice' and ${S.amountDescription} = 'Principal')::int`,
      revenue: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} = 'ItemPrice' and ${S.amountDescription} in ('Principal', 'Shipping', 'GiftWrap')), 0)::float`,
      // USt. eigens ausgewiesen (Umsatzsteuer-Berechnungsservice) bzw. von Amazon einbehalten – kein Ertrag/Aufwand.
      tax: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountDescription} ilike '%tax%' and coalesce(${S.amountType}, '') not ilike '%withheld%' and ${S.amountDescription} not ilike '%facilitator%' and coalesce(${S.amountType}, '') <> 'ItemFees'), 0)::float`,
      taxLines: sql<number>`count(*) filter (where ${S.amountDescription} ilike '%tax%' and coalesce(${S.amountType}, '') not ilike '%withheld%' and ${S.amountDescription} not ilike '%facilitator%' and coalesce(${S.amountType}, '') <> 'ItemFees')::int`,
      withheld: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} ilike '%withheld%' or ${S.amountDescription} ilike '%facilitator%'), 0)::float`,
      fees: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} = 'ItemFees'), 0)::float`,
      promotions: sql<number>`coalesce(sum(${S.amount}) filter (where ${S.amountType} = 'Promotion' and coalesce(${S.amountDescription}, '') not ilike '%tax%'), 0)::float`,
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
    // EK aus der gemeinsamen Quelle (Charge → von Hand → eBay-Tool), sonst wie bisher aus der Charge.
    const unitCost = costs ? (costs.get(r.sku!)?.cost ?? null) : lot?.cost ? Number(lot.cost) : null;
    const netUnits = Math.max(0, r.units - r.refunds);
    const { revenueNet, other, costsExCogs } = abrechnungNetto({ revenue: r.revenue, collectedTax: r.tax, taxLines: r.taxLines, withheldTax: r.withheld, fees: r.fees, promotions: r.promotions, reimb: r.reimb, total: r.total }, vatRate);
    const cogs = unitCost === null ? null : unitCost * netUnits;
    const profit = cogs === null ? null : revenueNet + costsExCogs - cogs;
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
      costsExCogs,
      vatSeparate: r.taxLines > 0,
      unitCost,
      cogs,
      profit,
      plannedPrice: lot?.target ? Number(lot.target) : null,
      avgPrice: r.units > 0 ? r.revenue / r.units : null,
    };
  });

  const ohneSku = await db
    .select({ description: S.amountDescription, type: S.transactionType, amount: sql<number>`sum(${S.amount})::float` })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), gte(S.postedDate, from), lte(S.postedDate, to), sql`${S.sku} is null`))
    .groupBy(S.amountDescription, S.transactionType)
    .orderBy(sql`sum(${S.amount})`);
  // Rücklagen, Kartenabbuchungen u. Ä. verschieben nur Geld – getrennt zeigen, nicht im Ergebnis.
  const nonSku = ohneSku.filter((x) => !istGeldbewegung(x.description, x.type));
  const transfers = ohneSku.filter((x) => istGeldbewegung(x.description, x.type));

  return { skus, nonSku, transfers };
}

/** Andere Kanäle: Auftragspositionen im Zeitraum (ohne stornierte) – Auswertung in profit-logic.ts. */
export async function orderLines(tenantId: string, from: string, to: string): Promise<OrderLine[]> {
  const O = schema.orders;
  const I = schema.orderItems;
  const rows = await db
    .select({ orderId: O.id, externalId: O.externalId, channel: O.channel, orderDate: O.orderDate, fees: O.fees, sku: I.sku, title: I.title, qty: I.quantity, price: I.price })
    .from(O)
    .innerJoin(I, eq(I.orderId, O.id))
    .where(and(eq(O.tenantId, tenantId), ne(O.channel, "amazon"), ne(O.status, "cancelled"), gte(O.orderDate, new Date(`${from}T00:00:00Z`)), lte(O.orderDate, new Date(`${to}T23:59:59Z`))));
  return rows.map((r) => ({ orderId: r.orderId, externalId: r.externalId, channel: r.channel, orderDate: r.orderDate.toISOString().slice(0, 10), sku: r.sku, title: r.title, qty: r.qty, price: r.price, orderFees: r.fees }));
}

/** Datenstand: letzte Amazon-Abrechnung und letzter Auftrag je Kanal. */
export async function dataStand(tenantId: string) {
  const S = schema.amazonSettlementLines;
  const [[settle], orders] = await Promise.all([
    db.select({ last: sql<string | null>`max(${S.postedDate})::text` }).from(S).where(eq(S.tenantId, tenantId)),
    db
      .select({ channel: schema.orders.channel, last: sql<Date | null>`max(${schema.orders.updatedAt})` })
      .from(schema.orders)
      .where(eq(schema.orders.tenantId, tenantId))
      .groupBy(schema.orders.channel),
  ]);
  return { settlement: settle?.last ?? null, orders: new Map<string, Date | null>(orders.map((o) => [o.channel, o.last ? new Date(o.last) : null])) };
}
