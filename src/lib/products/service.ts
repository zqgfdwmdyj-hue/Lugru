import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { loadCostPairs, mergeCostPairs, skuCostMap } from "@/lib/money/costs";
import { COST_SOURCE_LABEL, type CostInfo } from "@/lib/money/profit-logic";
import { loadSets } from "@/lib/stock/sets";
import { fbaReport } from "@/lib/stock/fba-report";
import { stockLevels } from "@/lib/stock/channel-sync";
import { ekCheck, groupCandidates, mappingIssues, rankProductGroups, type Candidate, type EkSource, type Issue, type ProductGroup } from "./logic";

// Produkte: Suche über alle Quellen, Detail je Produkt (Stammdaten, Chargen & Einkauf, Bestand,
// Angebote, Ergebnis, Belege) und die Arbeitsliste „Zuordnung prüfen“. Jede Abfrage mit tenant_id.

type Row = Record<string, unknown> & { sku: string };

/** Alle Quellen als Kandidaten (SKU, Produkt, Name, Bild) – optional gefiltert. */
async function candidates(t: string, opts: { q?: string; skus?: string[]; productId?: string } = {}): Promise<Candidate[]> {
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const skuFilter = opts.skus?.length ? sql.join(opts.skus.map((s) => sql`${s}`), sql`, `) : null;
  const pid = opts.productId ?? null;
  const res = await db.execute<Row & { productId: string | null; title: string | null; asin: string | null; ean: string | null; image: string | null; source: Candidate["source"]; active: boolean }>(sql`
    with c as (
      select l.sku, l.product_id as "productId", p.title, p.asin, p.ean, null::text as image, 'produkt' as source, true as active, null::text as alt
        from lots l join products p on p.id = l.product_id where l.tenant_id = ${t}
      union all
      select os.sku, os.product_id, null, null, null, null, 'lager', true, null from own_stock os where os.tenant_id = ${t}
      union all
      select coalesce(nullif(li.stock_sku, ''), li.sku), li.product_id, li.title, null, li.ean,
             coalesce(li.payload->'imageUrls'->>0, li.payload->>'image'), 'angebot', li.status = 'active', li.sku
        from listings li where li.tenant_id = ${t}
      union all
      -- eBay-Tool führt die Kanal-SKU; über das Wawi-Angebot gehört sie zur Lager-SKU.
      select coalesce((select nullif(li.stock_sku, '') from listings li where li.tenant_id = ${t} and li.channel = 'ebay' and li.sku = e.sku limit 1), e.sku),
             null, e.title, null, e.ean, e.image_urls->>0, 'ebay', e.status = 'published', concat_ws(' ', e.sku, e.listing_id)
        from ebay_listings e where e.tenant_id = ${t} and e.sku is not null
      union all
      select a.sku, a.product_id, a.title, a.asin, a.ean, null, 'artikel', true, null from articles a where a.tenant_id = ${t}
      union all
      select ai.sku, null, ai.title, ai.asin, null, null, 'fba', true, ai.fnsku from amazon_inventory ai where ai.tenant_id = ${t}
    )
    select * from c
     where c.sku is not null and c.sku <> ''
       ${q ? sql`and (c.sku ilike ${q} or c.title ilike ${q} or c.asin ilike ${q} or c.ean ilike ${q} or c.alt ilike ${q})` : sql``}
       ${skuFilter ? sql`and c.sku in (${skuFilter})` : sql``}
       ${pid ? sql`and c."productId" = ${pid}` : sql``}
     limit 20000`);
  return res.rows.map((r) => ({ sku: r.sku, productId: r.productId, title: r.title, asin: r.asin, ean: r.ean, image: r.image, source: r.source, active: r.active }));
}

export type ProductListRow = ProductGroup & { own: number; fba: number; offers: number; cost: CostInfo | null; costMissing: number };

/** Globale Suche: Produkte und Varianten aus allen Quellen (auch ohne Charge), exakte SKU zuerst. */
export async function productSearch(t: string, q: string, limit = 20) {
  if (!q.trim()) return { rows: [] as ReturnType<typeof rankProductGroups>, total: 0 };
  const ranked = rankProductGroups(groupCandidates(await candidates(t, { q })), q);
  return { rows: ranked.slice(0, limit), total: ranked.length };
}

/** Produktliste: Suche über SKU, Name, ASIN, EAN – gebündelt je Produkt, mit Bestand und Angeboten. */
export async function productList(t: string, opts: { q?: string; view: "bestand" | "alle" }): Promise<ProductListRow[]> {
  let cands = await candidates(t, { q: opts.q });
  // Treffer auf ein Produkt: alle SKUs dieses Produkts dazunehmen (sonst fehlen Chargen ohne Treffer).
  const pids = [...new Set(cands.map((c) => c.productId).filter((p): p is string => Boolean(p)))];
  if (opts.q && pids.length && pids.length <= 200) {
    const more = await Promise.all(pids.map((p) => candidates(t, { productId: p })));
    cands = [...cands, ...more.flat()];
  }
  const groups = groupCandidates(cands);
  const allSkus = [...new Set(groups.flatMap((g) => g.skus))];
  const [own, fba, offers, costs] = await Promise.all([
    allSkus.length ? db.select({ sku: schema.ownStock.sku, q: schema.ownStock.quantity }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, t), inArray(schema.ownStock.sku, allSkus))) : [],
    allSkus.length
      ? db
          .select({ sku: schema.amazonInventory.sku, q: sql<number>`(${schema.amazonInventory.fulfillable} + ${schema.amazonInventory.reserved} + ${schema.amazonInventory.inboundWorking} + ${schema.amazonInventory.inboundShipped} + ${schema.amazonInventory.inboundReceiving})::int` })
          .from(schema.amazonInventory)
          .where(and(eq(schema.amazonInventory.tenantId, t), inArray(schema.amazonInventory.sku, allSkus)))
      : [],
    allSkus.length
      ? db.execute<{ sku: string; n: number }>(sql`select coalesce(nullif(stock_sku, ''), sku) as sku, count(*) filter (where status = 'active')::int as n from listings where tenant_id = ${t} group by 1`)
      : { rows: [] },
    skuCostMap(t),
  ]);
  const ownBy = new Map(own.map((r) => [r.sku, Number(r.q)]));
  const fbaBy = new Map(fba.map((r) => [r.sku, Number(r.q)]));
  const offersBy = new Map(offers.rows.map((r) => [r.sku, Number(r.n)]));
  const rows = groups.map((g) => {
    const withCost = g.skus.map((s) => costs.get(s)).filter((c): c is CostInfo => Boolean(c));
    const stocked = g.skus.filter((s) => (ownBy.get(s) ?? 0) > 0 || (fbaBy.get(s) ?? 0) > 0);
    return {
      ...g,
      own: g.skus.reduce((n, s) => n + (ownBy.get(s) ?? 0), 0),
      fba: g.skus.reduce((n, s) => n + (fbaBy.get(s) ?? 0), 0),
      offers: g.skus.reduce((n, s) => n + (offersBy.get(s) ?? 0), 0),
      cost: withCost[withCost.length - 1] ?? null,
      costMissing: stocked.filter((s) => !costs.has(s)).length,
    };
  });
  const filtered = opts.view === "bestand" && !opts.q ? rows.filter((r) => r.own !== 0 || r.fba > 0) : rows;
  return filtered.sort((a, b) => (a.title ?? a.skus[0]).localeCompare(b.title ?? b.skus[0], "de"));
}

// ---- Detail ------------------------------------------------------------------------------------

export type ProductDetail = Awaited<ReturnType<typeof productDetail>>;

/** Alles zu einem Produkt (oder einer einzelnen SKU ohne Produkt). null = nicht gefunden. */
export async function productDetail(t: string, ref: { productId: string } | { sku: string }) {
  const product =
    "productId" in ref
      ? (await db.select().from(schema.products).where(and(eq(schema.products.tenantId, t), eq(schema.products.id, ref.productId))))[0] ?? null
      : null;
  if ("productId" in ref && !product) return null;
  const cands = "productId" in ref ? await candidates(t, { productId: ref.productId }) : await candidates(t, { skus: [ref.sku] });
  if (!cands.length && "sku" in ref) {
    // SKU nur aus Aufträgen bekannt: trotzdem anzeigen (Arbeitsliste verlinkt hierher).
    const [sold] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.orderItems).where(and(eq(schema.orderItems.tenantId, t), eq(schema.orderItems.sku, ref.sku)));
    if (!sold?.n) return null;
  }
  const group = groupCandidates(cands)[0] ?? { key: "", href: "", productId: null, title: null, asin: null, ean: null, image: null, skus: "sku" in ref ? [ref.sku] : [] };
  const skus = group.skus.length ? group.skus : "sku" in ref ? [ref.sku] : [];
  const skuList = skus.length ? skus : ["\u0000"];
  const L = schema.lots;

  const [lots, poItems, ownRows, fbaRows, movements, listings, ebayTool, articles, manualCosts, levels, sets] = await Promise.all([
    db
      .select({ id: L.id, sku: L.sku, kind: L.kind, purchaseDate: L.purchaseDate, estimated: L.purchaseDateEstimated, quantity: L.quantity, unitCostNet: L.unitCostNet, unitCostSource: L.unitCostSource, supplier: schema.suppliers.name, parentLotId: L.parentLotId, returnDate: L.returnDate })
      .from(L)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, L.supplierId))
      .where(and(eq(L.tenantId, t), inArray(L.sku, skuList)))
      .orderBy(desc(L.purchaseDate)),
    db
      .select({ poId: schema.purchaseOrders.id, number: schema.purchaseOrders.number, status: schema.purchaseOrders.status, orderDate: schema.purchaseOrders.orderDate, invoiceId: schema.purchaseOrders.invoiceId, sku: schema.purchaseOrderItems.sku, title: schema.purchaseOrderItems.title, quantity: schema.purchaseOrderItems.quantity, received: schema.purchaseOrderItems.received, unitCostGross: schema.purchaseOrderItems.unitCostGross, vatRate: schema.purchaseOrderItems.vatRate, supplier: schema.suppliers.name })
      .from(schema.purchaseOrderItems)
      .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, schema.purchaseOrderItems.poId))
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
      .where(and(eq(schema.purchaseOrderItems.tenantId, t), product ? sql`(${schema.purchaseOrderItems.sku} in (${sql.join(skuList.map((s) => sql`${s}`), sql`, `)}) or ${schema.purchaseOrderItems.productId} = ${product.id})` : inArray(schema.purchaseOrderItems.sku, skuList)))
      .orderBy(desc(schema.purchaseOrders.orderDate)),
    db.select().from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, t), inArray(schema.ownStock.sku, skuList))),
    db.select().from(schema.amazonInventory).where(and(eq(schema.amazonInventory.tenantId, t), inArray(schema.amazonInventory.sku, skuList))),
    db.select().from(schema.stockMovements).where(and(eq(schema.stockMovements.tenantId, t), inArray(schema.stockMovements.sku, skuList))).orderBy(desc(schema.stockMovements.createdAt)).limit(25),
    db
      .select()
      .from(schema.listings)
      .where(and(eq(schema.listings.tenantId, t), sql`(${schema.listings.sku} in (${sql.join(skuList.map((s) => sql`${s}`), sql`, `)}) or coalesce(nullif(${schema.listings.stockSku}, ''), ${schema.listings.sku}) in (${sql.join(skuList.map((s) => sql`${s}`), sql`, `)}))`)),
    db
      .select({ id: schema.ebayListings.id, sku: schema.ebayListings.sku, title: schema.ebayListings.title, status: schema.ebayListings.status, listingId: schema.ebayListings.listingId, price: schema.ebayListings.price, quantity: schema.ebayListings.quantity, purchasePrice: schema.ebayListings.purchasePrice, imageUrls: schema.ebayListings.imageUrls, ean: schema.ebayListings.ean })
      .from(schema.ebayListings)
      .where(
        and(
          eq(schema.ebayListings.tenantId, t),
          sql`(${schema.ebayListings.sku} in (${sql.join(skuList.map((s) => sql`${s}`), sql`, `)}) or ${schema.ebayListings.sku} in (select l.sku from listings l where l.tenant_id = ${t} and l.channel = 'ebay' and coalesce(nullif(l.stock_sku, ''), l.sku) in (${sql.join(skuList.map((s) => sql`${s}`), sql`, `)})))`,
        ),
      )
      .orderBy(desc(schema.ebayListings.id)),
    db.select({ id: schema.articles.id, sku: schema.articles.sku, title: schema.articles.title, status: schema.articles.status }).from(schema.articles).where(and(eq(schema.articles.tenantId, t), product ? sql`(${schema.articles.sku} in (${sql.join(skuList.map((s) => sql`${s}`), sql`, `)}) or ${schema.articles.productId} = ${product.id})` : inArray(schema.articles.sku, skuList))),
    db.select().from(schema.skuCosts).where(and(eq(schema.skuCosts.tenantId, t), inArray(schema.skuCosts.sku, skuList))),
    stockLevels(t, skus),
    loadSets(t),
  ]);
  const lotIds = lots.map((l) => l.id);
  const poInvoiceIds = [...new Set(poItems.map((p) => p.invoiceId).filter((x): x is string => Boolean(x)))];
  const I = schema.invoices;
  const invoices = lotIds.length || poInvoiceIds.length
    ? await db
        .selectDistinct({ id: I.id, number: I.invoiceNumber, date: I.invoiceDate, supplier: I.vendor, kind: I.kind, status: I.status, total: I.totalGross })
        .from(I)
        .leftJoin(schema.invoiceLots, eq(schema.invoiceLots.invoiceId, I.id))
        .where(and(eq(I.tenantId, t), sql`(${lotIds.length ? sql`${schema.invoiceLots.lotId} in (${sql.join(lotIds.map((s) => sql`${s}`), sql`, `)})` : sql`false`} or ${poInvoiceIds.length ? sql`${I.id} in (${sql.join(poInvoiceIds.map((s) => sql`${s}`), sql`, `)})` : sql`false`})`))
    : [];

  // EK je SKU: alle Quellen mit Herkunft nebeneinander – aus derselben Rechnung wie der gültige Wert
  // (Charge → von Hand → eBay-Tool → Set-Summe → geerbt). Kein gültiger EK ohne sichtbare Quelle.
  const pairs = await loadCostPairs(t);
  const costs = mergeCostPairs(pairs);
  const ek = skus.map((sku) => {
    const sources: EkSource[] = [];
    const add = (source: EkSource["source"], list: typeof pairs.charge) => {
      for (const [k, cost, detail, inherited] of list) {
        if (k.trim() !== sku || cost === null || cost === undefined) continue;
        if (sources.some((x) => x.source === source && x.cost === cost && x.detail === detail)) continue;
        sources.push({ source, label: COST_SOURCE_LABEL[source], cost: Number(cost), ...(detail ? { detail } : {}), ...(inherited ? { inherited: true } : {}) });
      }
    };
    add("charge", pairs.charge);
    add("manuell", pairs.manuell);
    add("ebay", pairs.ebayOwn);
    add("set", pairs.set);
    add("ebay", pairs.ebayInherited);
    return ekCheck(sku, sources, costs.get(sku) ?? null);
  });

  const setDefs = sets.filter((s) => skus.includes(s.sku) || s.components.some((c) => skus.includes(c.sku)));
  return { product, group, skus, lots, poItems, ownRows, fbaRows, movements, listings, ebayTool, articles, invoices, ek, levels, sets: setDefs, cands, fbaReport: await fbaReport(t) };
}

// ---- Arbeitsliste ------------------------------------------------------------------------------

/** Fehlende oder unklare Zuordnungen über alle Produkte. Nur lesen – nichts wird automatisch zusammengeführt. */
export async function mappingWorklist(t: string): Promise<Issue[]> {
  const since = addDaysIso(todayIso(), -90);
  const [own, fba, lots, listings, ebayTool, sold, sets, manual, eans, cands] = await Promise.all([
    db.select({ sku: schema.ownStock.sku, q: schema.ownStock.quantity }).from(schema.ownStock).where(eq(schema.ownStock.tenantId, t)),
    db
      .select({ sku: schema.amazonInventory.sku, q: sql<number>`(${schema.amazonInventory.fulfillable} + ${schema.amazonInventory.reserved} + ${schema.amazonInventory.inboundWorking} + ${schema.amazonInventory.inboundShipped} + ${schema.amazonInventory.inboundReceiving})::int` })
      .from(schema.amazonInventory)
      .where(eq(schema.amazonInventory.tenantId, t)),
    db.select({ sku: schema.lots.sku, cost: schema.lots.unitCostNet }).from(schema.lots).where(eq(schema.lots.tenantId, t)),
    db.select({ channel: schema.listings.channel, sku: schema.listings.sku, stockSku: schema.listings.stockSku, status: schema.listings.status, title: schema.listings.title }).from(schema.listings).where(eq(schema.listings.tenantId, t)),
    db.select({ sku: schema.ebayListings.sku, title: schema.ebayListings.title, listingId: schema.ebayListings.listingId, status: schema.ebayListings.status, purchasePrice: schema.ebayListings.purchasePrice }).from(schema.ebayListings).where(eq(schema.ebayListings.tenantId, t)).orderBy(desc(schema.ebayListings.id)),
    db
      .select({ sku: schema.orderItems.sku, channel: schema.orders.channel, units: sql<number>`sum(${schema.orderItems.quantity})::int`, title: sql<string | null>`max(${schema.orderItems.title})` })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(and(eq(schema.orders.tenantId, t), isNotNull(schema.orderItems.sku), gte(schema.orders.orderDate, new Date(`${since}T00:00:00Z`)), sql`${schema.orders.status} <> 'cancelled'`))
      .groupBy(schema.orderItems.sku, schema.orders.channel),
    loadSets(t),
    db.select({ sku: schema.skuCosts.sku, cost: schema.skuCosts.unitCostNet }).from(schema.skuCosts).where(eq(schema.skuCosts.tenantId, t)),
    db.execute<{ ean: string; asins: string[] }>(sql`select ean, array_agg(distinct asin order by asin) as asins from products where tenant_id = ${t} and ean is not null and ean <> '' group by ean having count(distinct asin) > 1 limit 200`),
    candidates(t),
  ]);
  const costs = await skuCostMap(t);
  const titles = new Map<string, string>();
  for (const g of groupCandidates(cands)) for (const s of g.skus) if (g.title) titles.set(s, g.title);
  const ekChecks = [...new Set([...lots.map((l) => l.sku), ...manual.map((m) => m.sku), ...ebayTool.map((e) => e.sku).filter((s): s is string => Boolean(s))])].map((sku) => {
    const sources: EkSource[] = [];
    for (const l of lots) if (l.sku === sku && l.cost !== null) sources.push({ source: "charge", label: COST_SOURCE_LABEL.charge, cost: Number(l.cost) });
    for (const m of manual) if (m.sku === sku) sources.push({ source: "manuell", label: COST_SOURCE_LABEL.manuell, cost: Number(m.cost) });
    const e = ebayTool.find((x) => x.sku === sku && x.purchasePrice !== null);
    if (e) sources.push({ source: "ebay", label: COST_SOURCE_LABEL.ebay, cost: Number(e.purchasePrice) });
    return ekCheck(sku, sources, costs.get(sku) ?? null);
  });
  return mappingIssues({
    ownStock: new Map(own.map((r) => [r.sku, Number(r.q)])),
    fbaStock: new Map(fba.map((r) => [r.sku, Number(r.q)])),
    lotSkus: new Set(lots.map((l) => l.sku)),
    setSkus: new Set(sets.map((s) => s.sku)),
    setComponents: new Set(sets.flatMap((s) => s.components.map((c) => c.sku))),
    listings,
    ebayTool: ebayTool.map((e) => ({ sku: e.sku, title: e.title, listingId: e.listingId, status: e.status })),
    sold: sold.filter((s): s is typeof s & { sku: string } => Boolean(s.sku)).map((s) => ({ sku: s.sku, channel: s.channel, units: Number(s.units), title: s.title })),
    costs,
    ekChecks,
    eanAsins: eans.rows,
    titles,
  });
}
