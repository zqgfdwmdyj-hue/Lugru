import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { correctedProfit } from "@/lib/hebel/rules";
import { skuCostMap } from "@/lib/money/costs";
import { buildReorderRows, kapitalbedarf, type Kaufquote, type ReorderRow } from "./reorder-logic";

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

/** ASINs, die schon im Einkauf angelegt oder bestellt und noch nicht ganz eingegangen sind. */
export async function angelegteAsins(tenantId: string): Promise<Set<string>> {
  const PO = schema.purchaseOrders;
  const POI = schema.purchaseOrderItems;
  const rows = await db
    .selectDistinct({ asin: POI.asin })
    .from(POI)
    .innerJoin(PO, eq(PO.id, POI.poId))
    .where(and(eq(PO.tenantId, tenantId), inArray(PO.status, ["draft", "ordered", "shipped", "partial"]), sql`${POI.asin} is not null`));
  return new Set(rows.map((r) => r.asin!));
}

/**
 * B15.5: Bestellvorschläge mit der gemeinsamen Kapitalbedarf-Rechnung (überall gleich). `rotZeigen` blendet Artikel
 * mit roter Kapital-Ampel wieder ein (nur Anzeige auf Wunsch).
 */
/** B19.8: Kaufquote je SKU (sellerboard, Amazon, letzte 30 Tage) – für „prüfen“ statt Summe. */
export async function kaufquotenJeSku(tenantId: string): Promise<Map<string, Kaufquote>> {
  const S = schema.sellerboardSkuStats;
  const rows = await db.select({ sku: S.sku, conversion: S.conversion, sessions: S.sessions }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.channel, "amazon")));
  return new Map(rows.map((r) => [r.sku, { conversion: r.conversion === null ? null : Number(r.conversion), sessions: r.sessions }]));
}

export async function bestellvorschlaegeGemeinsam(tenantId: string, heute = todayIso(), o: { rotZeigen?: boolean } = {}) {
  const { ampelJeSku } = await import("@/lib/money/kapital-service");
  const sb = await sellerboardReorder(tenantId);
  const [ampel, angelegt] = sb.rows.length ? await Promise.all([ampelJeSku(tenantId, heute).catch(() => new Map<string, "gruen" | "gelb" | "rot">()), angelegteAsins(tenantId)]) : [new Map<string, "gruen" | "gelb" | "rot">(), new Set<string>()];
  const kaufquoten = sb.rows.length ? await kaufquotenJeSku(tenantId) : new Map();
  const k = kapitalbedarf(sb.rows, { weg: o.rotZeigen ? undefined : (r) => ampel.get(r.sku) === "rot", angelegteAsins: angelegt, kaufquoten });
  return { ...k, alle: sb.rows, syncedAt: sb.syncedAt, ampel, roteGesamt: sb.rows.filter((r) => ampel.get(r.sku) === "rot").length };
}
