import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { todayIso } from "@/lib/dates";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { buildSku, netFromGross, statusAfterReceipt, suggest, supplierCode } from "./calc";

// Einkauf: Lieferantenbestellungen anlegen, Lieferung verfolgen, Wareneingang buchen.
// Beim Wareneingang entsteht je Position eine Charge (SKU nach Schema C) und der Bestand im
// eigenen Lager steigt – genau wie ein Einkauf über Arbitrage One, nur ohne Umweg.

const PO = schema.purchaseOrders;
const POI = schema.purchaseOrderItems;
const OPEN_STATUSES = ["draft", "ordered", "shipped", "partial"] as const;

export async function nextPoNumber(tx: Tx, tenantId: string, year = new Date().getFullYear()): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:po-number`}))`);
  const prefix = `EK-${year}-`;
  const [r] = await tx
    .select({ max: sql<string | null>`max(${PO.number})` })
    .from(PO)
    .where(and(eq(PO.tenantId, tenantId), sql`${PO.number} like ${`${prefix}%`}`));
  const n = r?.max ? Number(r.max.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/** Lieferant über sein Kürzel finden oder anlegen (Kürzel = erster Teil der SKU). */
export async function ensureSupplier(tx: Tx, tenantId: string, codeOrName: string): Promise<string> {
  const code = supplierCode(codeOrName);
  if (!code) throw new Error("Bitte einen Lieferanten bzw. ein Shop-Kürzel angeben.");
  const [s] = await tx
    .insert(schema.suppliers)
    .values({ tenantId, code, name: codeOrName.trim() === code ? null : codeOrName.trim() })
    .onConflictDoUpdate({ target: [schema.suppliers.tenantId, schema.suppliers.code], set: { code: sql`excluded.code` } })
    .returning({ id: schema.suppliers.id });
  return s.id;
}

export async function createPurchaseOrder(tenantId: string, userId: string, input: { supplier: string; supplierOrderNo?: string; orderDate?: string; expectedDate?: string; notes?: string }) {
  return db.transaction(async (tx) => {
    const supplierId = await ensureSupplier(tx, tenantId, input.supplier);
    const number = await nextPoNumber(tx, tenantId);
    const [po] = await tx
      .insert(PO)
      .values({ tenantId, number, supplierId, supplierOrderNo: input.supplierOrderNo || null, orderDate: input.orderDate || todayIso(), expectedDate: input.expectedDate || null, notes: input.notes || null, createdBy: userId })
      .returning({ id: PO.id });
    return po.id;
  });
}

export type ItemInput = { asin: string; quantity: number; unitCostGross: number; vatRate?: number; targetPrice?: number | null; title?: string | null; ean?: string | null };

export async function addItem(tenantId: string, poId: string, item: ItemInput) {
  const asin = item.asin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("Bitte eine gültige ASIN (10 Zeichen) angeben.");
  if (!(item.quantity > 0)) throw new Error("Die Menge muss größer als 0 sein.");
  if (!(item.unitCostGross >= 0)) throw new Error("Bitte den Einkaufspreis angeben.");
  const [po] = await db.select().from(PO).where(and(eq(PO.id, poId), eq(PO.tenantId, tenantId)));
  if (!po) throw new Error("Bestellung nicht gefunden.");
  if (po.status === "received" || po.status === "cancelled") throw new Error("Die Bestellung ist abgeschlossen.");
  const [product] = await db.select().from(schema.products).where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.asin, asin)));
  await db.insert(POI).values({
    tenantId,
    poId,
    productId: product?.id ?? null,
    asin,
    title: item.title || product?.title || null,
    ean: item.ean || product?.ean || null,
    quantity: Math.round(item.quantity),
    unitCostGross: String(item.unitCostGross),
    vatRate: String(item.vatRate ?? 19),
    targetPrice: item.targetPrice == null ? null : String(item.targetPrice),
  });
  await touch(poId);
}

async function touch(poId: string) {
  await db.update(PO).set({ updatedAt: new Date() }).where(eq(PO.id, poId));
}

export async function removeItem(tenantId: string, itemId: string) {
  const [it] = await db.select().from(POI).where(and(eq(POI.id, itemId), eq(POI.tenantId, tenantId)));
  if (!it) return;
  if (it.received > 0) throw new Error("Position ist schon (teilweise) eingegangen und kann nicht mehr gelöscht werden.");
  await db.delete(POI).where(eq(POI.id, it.id));
  await touch(it.poId);
}

export type PoPatch = Partial<{ status: string; supplierOrderNo: string | null; expectedDate: string | null; orderDate: string | null; carrier: string | null; trackingNumber: string | null; shippingCostGross: number | null; notes: string | null; invoiceId: string | null }>;

export async function updatePurchaseOrder(tenantId: string, poId: string, patch: PoPatch) {
  const [po] = await db.select().from(PO).where(and(eq(PO.id, poId), eq(PO.tenantId, tenantId)));
  if (!po) throw new Error("Bestellung nicht gefunden.");
  const set: Partial<typeof PO.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["supplierOrderNo", "expectedDate", "orderDate", "carrier", "trackingNumber", "notes", "invoiceId"] as const) {
    if (k in patch) set[k] = patch[k] || null;
  }
  if ("shippingCostGross" in patch) set.shippingCostGross = patch.shippingCostGross ?? null;
  if (patch.status) {
    if (!["draft", "ordered", "shipped", "cancelled"].includes(patch.status)) throw new Error("Unbekannter Status.");
    if (po.status === "received") throw new Error("Die Bestellung ist schon eingegangen.");
    if (patch.status === "cancelled" && ["partial"].includes(po.status)) throw new Error("Teilweise eingegangene Bestellungen lassen sich nicht stornieren – Rest per Wareneingang abschließen.");
    set.status = patch.status as typeof PO.$inferInsert.status;
  }
  await db.update(PO).set(set).where(eq(PO.id, poId));
  if (set.supplierOrderNo && !po.invoiceId && !("invoiceId" in patch)) await linkInvoiceByOrderNo(tenantId, poId);
  await refreshPoTask(tenantId, poId);
}

/** Eingangsrechnung mit derselben Shop-Bestellnummer automatisch zuordnen. */
export async function linkInvoiceByOrderNo(tenantId: string, poId: string) {
  const [po] = await db.select().from(PO).where(and(eq(PO.id, poId), eq(PO.tenantId, tenantId)));
  if (!po?.supplierOrderNo || po.invoiceId) return null;
  const I = schema.invoices;
  const [inv] = await db
    .select({ id: I.id })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), sql`regexp_replace(lower(${I.orderNumber}), '[^a-z0-9]', '', 'g') = regexp_replace(lower(${po.supplierOrderNo}), '[^a-z0-9]', '', 'g')`))
    .limit(1);
  if (!inv) return null;
  await db.update(PO).set({ invoiceId: inv.id }).where(eq(PO.id, po.id));
  // Schon angelegte Chargen mit der Rechnung verknüpfen.
  const lotIds = (await db.select({ lotId: POI.lotId }).from(POI).where(eq(POI.poId, po.id))).map((r) => r.lotId).filter((x): x is string => Boolean(x));
  if (lotIds.length) await db.insert(schema.invoiceLots).values(lotIds.map((lotId) => ({ tenantId, invoiceId: inv.id, lotId, matchedBy: "auto" as const }))).onConflictDoNothing();
  return inv.id;
}

/** Offene Bestellungen erscheinen als Aufgabe am erwarteten Liefertag – und damit im Kalender. */
export async function refreshPoTask(tenantId: string, poId: string) {
  const [po] = await db.select().from(PO).where(and(eq(PO.id, poId), eq(PO.tenantId, tenantId)));
  if (!po) return;
  const key = `po:${po.id}`;
  if (!["ordered", "shipped", "partial"].includes(po.status) || !po.expectedDate) {
    await resolveSystemTask(db, tenantId, key);
    return;
  }
  const [sup] = po.supplierId ? await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, po.supplierId)) : [];
  await upsertSystemTask(db, tenantId, key, {
    title: `Lieferung ${po.number} von ${sup?.name || sup?.code || "Lieferant"} erwartet – Wareneingang buchen`,
    notes: po.trackingNumber ? `Sendung: ${po.carrier ?? ""} ${po.trackingNumber}`.trim() : null,
    category: "einkauf",
    link: `/einkauf/${po.id}`,
    dueDate: po.expectedDate,
  });
}

/**
 * Wareneingang: je Position die gelieferte Menge buchen. Legt die Charge an (oder erhöht sie),
 * bucht den Bestand ins eigene Lager und verknüpft eine zugeordnete Rechnung.
 */
export async function receiveGoods(tenantId: string, userId: string, poId: string, quantities: Record<string, number>, location?: string | null) {
  const result = await db.transaction(async (tx) => {
    const [po] = await tx.select().from(PO).where(and(eq(PO.id, poId), eq(PO.tenantId, tenantId))).for("update");
    if (!po) throw new Error("Bestellung nicht gefunden.");
    if (po.status === "cancelled" || po.status === "draft") throw new Error("Erst bestellen, dann Wareneingang buchen.");
    const [sup] = po.supplierId ? await tx.select().from(schema.suppliers).where(eq(schema.suppliers.id, po.supplierId)) : [];
    const items = await tx.select().from(POI).where(eq(POI.poId, po.id));
    let booked = 0;
    for (const it of items) {
      const qty = Math.floor(quantities[it.id] ?? 0);
      if (qty <= 0) continue;
      const gross = Number(it.unitCostGross);
      const vat = Number(it.vatRate);
      const net = netFromGross(gross, vat);
      const sku = it.sku ?? buildSku(sup?.code ?? "EK", po.orderDate ?? todayIso(), it.asin, gross, it.targetPrice == null ? null : Number(it.targetPrice));

      let productId = it.productId;
      if (!productId) {
        const [p] = await tx
          .insert(schema.products)
          .values({ tenantId, asin: it.asin, title: it.title, ean: it.ean })
          .onConflictDoUpdate({ target: [schema.products.tenantId, schema.products.asin], set: { title: sql`coalesce(${schema.products.title}, excluded.title)`, ean: sql`coalesce(${schema.products.ean}, excluded.ean)` } })
          .returning({ id: schema.products.id });
        productId = p.id;
      }
      const L = schema.lots;
      const [lot] = await tx
        .insert(L)
        .values({
          tenantId,
          productId,
          sku,
          kind: "purchase",
          skuSchema: "C",
          supplierId: po.supplierId,
          purchaseDate: po.orderDate ?? todayIso(),
          quantity: qty,
          unitCostNet: String(net),
          unitCostSource: "manual",
          skuCostNet: String(net),
          skuCostGross: String(gross),
          skuTargetPrice: it.targetPrice,
        })
        .onConflictDoUpdate({ target: [L.tenantId, L.sku], set: { quantity: sql`coalesce(${L.quantity}, 0) + excluded.quantity`, updatedAt: new Date() } })
        .returning({ id: L.id });

      await tx
        .insert(schema.ownStock)
        .values({ tenantId, sku, productId, quantity: qty, location: location || null })
        .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: sql`${schema.ownStock.quantity} + excluded.quantity`, location: sql`coalesce(excluded.location, ${schema.ownStock.location})`, updatedAt: new Date() } });
      await tx.insert(schema.stockMovements).values({ tenantId, sku, delta: qty, reason: "Wareneingang", reference: po.number, userId });
      await tx.update(POI).set({ received: it.received + qty, sku, lotId: lot.id, productId }).where(eq(POI.id, it.id));
      if (po.invoiceId) await tx.insert(schema.invoiceLots).values({ tenantId, invoiceId: po.invoiceId, lotId: lot.id, matchedBy: "auto" }).onConflictDoNothing();
      it.received += qty;
      booked += qty;
    }
    if (booked === 0) throw new Error("Bitte bei mindestens einer Position eine Menge eintragen.");
    const status = statusAfterReceipt(items, po.status) as typeof PO.$inferInsert.status;
    await tx.update(PO).set({ status, receivedAt: status === "received" ? new Date() : po.receivedAt, updatedAt: new Date() }).where(eq(PO.id, po.id));
    return { booked, status };
  });
  await refreshPoTask(tenantId, poId);
  return result;
}

// ---- Bestellvorschläge ---------------------------------------------------------------------

export type SuggestionRow = {
  asin: string;
  title: string | null;
  sold30: number;
  sold90: number;
  fba: number;
  inbound: number;
  own: number;
  onOrder: number;
  lastCostNet: number | null;
  lastSupplier: string | null;
  lastDate: string | null;
  bestOffer: { supplier: string; price: number; stock: number | null } | null;
  daily: number;
  daysLeft: number | null;
  need: number;
};

export async function purchaseSuggestions(tenantId: string, opts: { leadDays: number; coverDays: number; all?: boolean }): Promise<SuggestionRow[]> {
  const t = tenantId;
  // Absatz je ASIN: Aufträge (alle Kanäle) und Amazon-Abrechnungen – das Größere zählt,
  // damit FBA-Verkäufe auch ohne Auftragsbericht erfasst sind.
  const rows = await db.execute<{
    asin: string; title: string | null; o30: number; o90: number; s30: number; s90: number; fba: number; inbound: number; own: number; on_order: number;
    last_cost: number | null; last_supplier: string | null; last_date: string | null;
  }>(sql`
    with sku_asin as (
      select l.sku, p.asin, p.title from lots l join products p on p.id = l.product_id where l.tenant_id = ${t}
      union select ai.sku, ai.asin, ai.title from amazon_inventory ai where ai.tenant_id = ${t} and ai.asin is not null
    ),
    ord as (
      select coalesce(i.asin, sa.asin) as asin,
             sum(i.quantity) filter (where o.order_date >= now() - interval '30 days') as q30,
             sum(i.quantity) filter (where o.order_date >= now() - interval '90 days') as q90
        from order_items i join orders o on o.id = i.order_id
        left join sku_asin sa on sa.sku = i.sku
       where o.tenant_id = ${t} and o.status <> 'cancelled' and o.order_date >= now() - interval '90 days'
       group by 1
    ),
    stl as (
      select sa.asin,
             sum(sl.quantity) filter (where sl.posted_date >= current_date - 30) as q30,
             sum(sl.quantity) filter (where sl.posted_date >= current_date - 90) as q90
        from amazon_settlement_lines sl join sku_asin sa on sa.sku = sl.sku
       where sl.tenant_id = ${t} and sl.transaction_type = 'Order' and sl.amount_type = 'ItemPrice' and sl.amount_description = 'Principal' and sl.posted_date >= current_date - 90
       group by 1
    ),
    fba as (
      select asin, sum(fulfillable + reserved) as fba, sum(inbound_working + inbound_shipped + inbound_receiving) as inbound
        from amazon_inventory where tenant_id = ${t} and asin is not null group by 1
    ),
    own as (
      select sa.asin, sum(os.quantity) as own from own_stock os join sku_asin sa on sa.sku = os.sku where os.tenant_id = ${t} group by 1
    ),
    open_po as (
      select poi.asin, sum(greatest(poi.quantity - poi.received, 0)) as q
        from purchase_order_items poi join purchase_orders po on po.id = poi.po_id
       where po.tenant_id = ${t} and po.status in ('ordered', 'shipped', 'partial') group by 1
    ),
    last_buy as (
      select distinct on (p.asin) p.asin, l.unit_cost_net::float as cost, coalesce(s.name, s.code) as supplier, l.purchase_date::text as d
        from lots l join products p on p.id = l.product_id left join suppliers s on s.id = l.supplier_id
       where l.tenant_id = ${t} and l.kind = 'purchase'
       order by p.asin, l.purchase_date desc nulls last
    ),
    asins as (select asin from ord union select asin from stl union select asin from fba union select asin from own union select asin from open_po)
    select a.asin,
           coalesce(p.title, (select title from sku_asin where asin = a.asin and title is not null limit 1)) as title,
           coalesce(ord.q30, 0)::int as o30, coalesce(ord.q90, 0)::int as o90,
           coalesce(stl.q30, 0)::int as s30, coalesce(stl.q90, 0)::int as s90,
           coalesce(fba.fba, 0)::int as fba, coalesce(fba.inbound, 0)::int as inbound, coalesce(own.own, 0)::int as own,
           coalesce(open_po.q, 0)::int as on_order,
           lb.cost as last_cost, lb.supplier as last_supplier, lb.d as last_date
      from asins a
      left join products p on p.tenant_id = ${t} and p.asin = a.asin
      left join ord on ord.asin = a.asin
      left join stl on stl.asin = a.asin
      left join fba on fba.asin = a.asin
      left join own on own.asin = a.asin
      left join open_po on open_po.asin = a.asin
      left join last_buy lb on lb.asin = a.asin
     where a.asin is not null
  `);

  // Günstigstes aktuelles Angebot aus den Lieferanten-Feeds.
  const asins = rows.rows.map((r) => r.asin);
  const offers = asins.length
    ? await db
        .select({ asin: schema.supplierOffers.asin, price: schema.supplierOffers.price, stock: schema.supplierOffers.stock, feed: sql<string>`coalesce(${schema.suppliers.code}, ${schema.supplierFeeds.name})` })
        .from(schema.supplierOffers)
        .innerJoin(schema.supplierFeeds, eq(schema.supplierFeeds.id, schema.supplierOffers.feedId))
        .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplierFeeds.supplierId))
        .where(and(eq(schema.supplierOffers.tenantId, t), inArray(schema.supplierOffers.asin, asins)))
    : [];
  const best = new Map<string, { supplier: string; price: number; stock: number | null }>();
  for (const o of offers) {
    if (!o.asin || o.price == null || (o.stock !== null && o.stock <= 0)) continue;
    const cur = best.get(o.asin);
    if (!cur || o.price < cur.price) best.set(o.asin, { supplier: o.feed, price: o.price, stock: o.stock });
  }

  const out: SuggestionRow[] = rows.rows.map((r) => {
    const sold30 = Math.max(r.o30, r.s30);
    const sold90 = Math.max(r.o90, r.s90);
    const stock = r.fba + r.inbound + r.own;
    const s = suggest({ sold30, sold90, stock, onOrder: r.on_order, leadDays: opts.leadDays, coverDays: opts.coverDays });
    return { asin: r.asin, title: r.title, sold30, sold90, fba: r.fba, inbound: r.inbound, own: r.own, onOrder: r.on_order, lastCostNet: r.last_cost, lastSupplier: r.last_supplier, lastDate: r.last_date, bestOffer: best.get(r.asin) ?? null, ...s };
  });
  return out
    .filter((r) => opts.all || r.need > 0)
    .sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || b.daily - a.daily);
}

/** Vorschläge je Lieferant als Bestellentwürfe anlegen (bestehende Entwürfe werden ergänzt). */
export async function createDraftsFromSuggestions(tenantId: string, userId: string, picks: { asin: string; quantity: number; supplier: string; unitCostGross: number; title?: string | null }[]) {
  const bySupplier = new Map<string, typeof picks>();
  for (const p of picks) {
    if (!(p.quantity > 0)) continue;
    const k = supplierCode(p.supplier) || "EK";
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), p]);
  }
  const ids: string[] = [];
  for (const [code, list] of bySupplier) {
    const [sup] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, tenantId), eq(schema.suppliers.code, code)));
    const [draft] = sup
      ? await db.select({ id: PO.id }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.supplierId, sup.id), eq(PO.status, "draft"))).limit(1)
      : [];
    const poId = draft?.id ?? (await createPurchaseOrder(tenantId, userId, { supplier: list[0].supplier }));
    for (const p of list) await addItem(tenantId, poId, { asin: p.asin, quantity: p.quantity, unitCostGross: p.unitCostGross, title: p.title });
    ids.push(poId);
  }
  return ids;
}

export async function openPoCount(tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(PO).where(and(eq(PO.tenantId, tenantId), inArray(PO.status, [...OPEN_STATUSES]), notInArray(PO.status, ["draft"])));
  return r?.n ?? 0;
}
