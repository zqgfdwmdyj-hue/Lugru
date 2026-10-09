"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { CHANNELS, LISTING_STATUSES } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { publishListing } from "@/lib/listings/publish";
import { parseAmount } from "@/lib/numbers";
import { confirmManualStock, syncChannelStock } from "@/lib/stock/channel-sync";
import { adoptEbayAttempts, ensureEbayStock, UNKNOWN_SKU, type EnsureResult } from "@/lib/stock/ebay-link";

const uuid = z.string().uuid();

export async function saveListing(fd: FormData) {
  const session = await requireArea("wawi");
  const channel = z.enum(CHANNELS).parse(fd.get("channel"));
  const sku = String(fd.get("sku") ?? "").trim();
  if (!sku) return;
  const [lot] = await db
    .select({ productId: schema.lots.productId, title: schema.products.title, ean: schema.products.ean, asin: schema.products.asin })
    .from(schema.lots)
    .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
    .where(and(eq(schema.lots.tenantId, session.tenantId), eq(schema.lots.sku, sku)));
  const title = String(fd.get("title") ?? "").trim() || lot?.title || sku;
  const stockSku = String(fd.get("stockSku") ?? "").trim() || null;
  const maxRaw = parseAmount(fd.get("maxQuantity"));
  const maxQuantity = maxRaw === null || maxRaw === undefined ? null : Math.max(0, Math.round(maxRaw));
  const stockSync = fd.get("stockSync") === "on";
  const statusRaw = String(fd.get("status") ?? "");
  const status = (LISTING_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as (typeof LISTING_STATUSES)[number]) : undefined;
  await db
    .insert(schema.listings)
    .values({
      tenantId: session.tenantId,
      channel,
      sku,
      productId: lot?.productId ?? null,
      title: title.slice(0, 80),
      description: String(fd.get("description") ?? "").trim() || null,
      ean: String(fd.get("ean") ?? "").trim() || lot?.ean || null,
      condition: String(fd.get("condition") ?? "NEW"),
      price: parseAmount(fd.get("price")),
      quantity: Math.max(0, Math.round(parseAmount(fd.get("quantity")) ?? 1)),
      stockSku: stockSku === sku ? null : stockSku,
      maxQuantity,
      stockSync,
      ...(status ? { status } : {}),
      payload: {
        categoryId: String(fd.get("categoryId") ?? "").trim() || undefined,
        imageUrls: String(fd.get("imageUrls") ?? "").split(/\s+/).filter((u) => /^https:\/\//.test(u)),
      },
    })
    .onConflictDoUpdate({
      target: [schema.listings.tenantId, schema.listings.channel, schema.listings.sku],
      set: {
        // Gespeicherte Kanal-Daten (offerId, Produkttyp) behalten – nur Formularfelder überschreiben.
        payload: sql`${schema.listings.payload} || excluded.payload`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        ean: sql`excluded.ean`,
        condition: sql`excluded.condition`,
        price: sql`excluded.price`,
        quantity: sql`excluded.quantity`,
        stockSku: sql`excluded.stock_sku`,
        maxQuantity: sql`excluded.max_quantity`,
        stockSync: sql`excluded.stock_sync`,
        ...(status ? { status: sql`excluded.status` } : {}),
        lastError: null,
        updatedAt: new Date(),
      },
    });
  await syncChannelStock(session.tenantId, { skus: [stockSku || sku] });
  revalidatePath("/listings");
}

export async function publishAction(fd: FormData) {
  const session = await requireArea("wawi");
  const [l] = await db.select().from(schema.listings).where(and(eq(schema.listings.id, uuid.parse(fd.get("id"))), eq(schema.listings.tenantId, session.tenantId)));
  if (l) await publishListing(session.tenantId, l);
  revalidatePath("/listings");
}

export async function deleteListing(fd: FormData) {
  const session = await requireArea("wawi");
  await db.delete(schema.listings).where(and(eq(schema.listings.id, uuid.parse(fd.get("id"))), eq(schema.listings.tenantId, session.tenantId)));
  revalidatePath("/listings");
}

/** Entwürfe für alle SKUs im eigenen Lager, die auf dem Kanal noch fehlen. */
export async function draftsFromOwnStock(fd: FormData) {
  const session = await requireArea("wawi");
  const channel = z.enum(CHANNELS).parse(fd.get("channel"));
  await db.execute(sql`
    insert into listings (tenant_id, channel, sku, product_id, title, ean, price, quantity)
    select os.tenant_id, ${channel}, os.sku, l.product_id, left(coalesce(p.title, os.sku), 80), p.ean, l.sku_target_price, os.quantity
      from own_stock os
      left join lots l on l.tenant_id = os.tenant_id and l.sku = os.sku
      left join products p on p.id = l.product_id
     where os.tenant_id = ${session.tenantId} and os.quantity > 0
    on conflict (tenant_id, channel, sku) do nothing`);
  revalidatePath("/listings");
}

const back = (msg: string, kanal?: string | null) => redirect(`/listings?${new URLSearchParams({ ...(kanal ? { kanal } : {}), meldung: msg })}`);

/** Jetzt abgleichen: alle aktiven Angebote auf den verfügbaren Wawi-Bestand. */
export async function syncNowAction(fd: FormData) {
  const session = await requireArea("wawi");
  const r = await syncChannelStock(session.tenantId);
  const parts = [`${r.checked} aktive Angebote geprüft`, `${r.pushed} Mengen übertragen`];
  if (r.manual) parts.push(`${r.manual} bitte von Hand im Kanal setzen (Aufgabe angelegt)`);
  if (r.failed) parts.push(`${r.failed} Fehler – siehe Zeile`);
  if (r.oversold.length) parts.push(`ÜBERVERKAUF: ${r.oversold.join(", ")}`);
  back(parts.join(" · "), String(fd.get("kanal") ?? "") || null);
}

function ensureText(r: EnsureResult) {
  const unknown = r.failed.filter((f) => UNKNOWN_SKU.test(f.error));
  return [
    ...r.done.map((d) => (d.booked === null ? `${d.sku}: mit Wawi-SKU ${d.stockSku} verknüpft` : `${d.sku}: ${(d.ebay ?? 0) + (d.reserved ?? 0)} Stück gebucht (${d.ebay} auf eBay${d.reserved ? ` + ${d.reserved} verkauft, nicht versandt` : ""})`)),
    ...(unknown.length > 1 ? [`Nicht übers eBay-Tool eingestellt – Bestand bitte in der Zeile eintragen: ${unknown.map((f) => f.sku).join(", ")}`] : unknown.map((f) => `${f.sku}: ${f.error}`)),
    ...r.failed.filter((f) => !UNKNOWN_SKU.test(f.error)).map((f) => `${f.sku}: ${f.error}`),
  ].join(" · ");
}

/** Bisher im eBay-Tool veröffentlichte Angebote in die Wawi holen – Bestand aus der aktuellen eBay-Menge. */
export async function adoptEbayAction() {
  const session = await requireArea("wawi");
  const r = await adoptEbayAttempts(session.tenantId);
  const e = await ensureEbayStock(session.tenantId);
  const parts = [r.adopted ? `${r.adopted} eBay-Angebote übernommen` : "Alle eBay-Angebote aus dem Tool sind schon in der Wawi"];
  if (r.booked || e.done.length) parts.push(`Wawi-Bestand für ${r.booked + e.done.length} angelegt, Abgleich an`);
  if (e.done.length || e.failed.length) parts.push(ensureText(e));
  back(parts.join(" · "), "ebay");
}

/** Je Zeile: Wawi-Bestand eines laufenden eBay-Angebots aus der eBay-Menge anlegen. */
export async function ebayStockAction(fd: FormData) {
  const session = await requireArea("wawi");
  const r = await ensureEbayStock(session.tenantId, [uuid.parse(fd.get("id"))]);
  back(ensureText(r) || "Für dieses Angebot gibt es schon Wawi-Bestand.", String(fd.get("kanal") ?? "") || null);
}

/** Je Zeile: Wawi-Bestand eines Angebots ohne eigenen Lagereintrag von Hand setzen und abgleichen. */
export async function setListingStockAction(fd: FormData) {
  const session = await requireArea("wawi");
  const L = schema.listings;
  const [l] = await db.select().from(L).where(and(eq(L.id, uuid.parse(fd.get("id"))), eq(L.tenantId, session.tenantId)));
  const qty = Math.round(parseAmount(fd.get("quantity")) ?? NaN);
  if (!l || !Number.isFinite(qty) || qty < 0) back("Bitte eine Menge (0 oder mehr) eintragen.", String(fd.get("kanal") ?? "") || null);
  const sku = l!.stockSku?.trim() || l!.sku;
  const S = schema.ownStock;
  const [cur] = await db.select().from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.sku, sku)));
  await db.insert(S).values({ tenantId: session.tenantId, sku, quantity: qty }).onConflictDoUpdate({ target: [S.tenantId, S.sku], set: { quantity: qty, updatedAt: new Date() } });
  const delta = qty - (cur?.quantity ?? 0);
  if (delta) await db.insert(schema.stockMovements).values({ tenantId: session.tenantId, sku, delta, reason: "Anfangsbestand (Listings)", reference: `${l!.channel} ${l!.sku}`, userId: session.userId });
  await db.update(L).set({ stockSync: true, lastError: null, updatedAt: new Date() }).where(eq(L.id, l!.id));
  await syncChannelStock(session.tenantId, { skus: [sku] });
  back(`${sku}: Wawi-Bestand ${qty} eingetragen – Abgleich an.`, String(fd.get("kanal") ?? "") || null);
}

/**
 * Amazon-FBM-Angebote verknüpfen: SKUs aus FBM-Bestellungen, für die es eigenes Lager gibt.
 * FBA-SKUs bleiben außen vor – deren Bestand führt Amazon.
 */
export async function linkAmazonFbmAction() {
  const session = await requireArea("wawi");
  const t = session.tenantId;
  const res = await db.execute(sql`
    insert into listings (tenant_id, channel, sku, title, status, stock_sync, quantity, payload)
    select distinct on (i.sku) o.tenant_id, 'amazon', i.sku, left(coalesce(i.title, i.sku), 80), 'active', true, 0, '{"fulfillment":"FBM"}'::jsonb
      from order_items i
      join orders o on o.id = i.order_id
      join own_stock os on os.tenant_id = o.tenant_id and os.sku = i.sku
     where o.tenant_id = ${t} and o.channel = 'amazon' and o.fulfillment = 'FBM' and i.sku is not null
    on conflict (tenant_id, channel, sku) do nothing`);
  await syncChannelStock(t);
  back(`${res.rowCount ?? 0} Amazon-FBM-Angebote verknüpft und abgeglichen.`, "amazon");
}

/** Kanal ohne Schnittstelle (Temu, TikTok …): Menge wurde im Kanal von Hand gesetzt. */
export async function confirmManualAction(fd: FormData) {
  const session = await requireArea("wawi");
  await confirmManualStock(session.tenantId, uuid.parse(fd.get("id")));
  revalidatePath("/listings");
}

export async function toggleSyncAction(fd: FormData) {
  const session = await requireArea("wawi");
  const id = uuid.parse(fd.get("id"));
  const on = fd.get("on") === "1";
  await db.update(schema.listings).set({ stockSync: on, lastError: null, updatedAt: new Date() }).where(and(eq(schema.listings.id, id), eq(schema.listings.tenantId, session.tenantId)));
  // eBay ohne Wawi-Bestand: Bestand aus der eBay-Menge anlegen, statt mit „kein Bestand“ stehen zu bleiben.
  if (on) await ensureEbayStock(session.tenantId, [id]);
  if (on) await syncChannelStock(session.tenantId);
  revalidatePath("/listings");
}
