import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listAttempts } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import type { ListingAttempt } from "@/lib/ebay/types";
import { syncSoon } from "./channel-sync";

/**
 * Eigene Wawi-SKU zu einer EAN: zuerst ein anderes Kanal-Angebot mit derselben EAN,
 * dann Lager-/Chargen-/Artikelstamm-Einträge – jeweils nur, wenn es dafür ein eigenes
 * Lager gibt (FBA-Ware zählt nicht für eBay/FBM).
 */
export async function matchStockSku(tenantId: string, ean: string): Promise<string | null> {
  const res = await db.execute<{ sku: string }>(sql`
    select sku from (
      select coalesce(nullif(l.stock_sku, ''), l.sku) as sku, 1 as prio from listings l where l.tenant_id = ${tenantId} and l.ean = ${ean}
      union all
      select os.sku, 2 from own_stock os join products p on p.id = os.product_id where os.tenant_id = ${tenantId} and p.ean = ${ean}
      union all
      select lo.sku, 3 from lots lo join products p on p.id = lo.product_id where lo.tenant_id = ${tenantId} and p.ean = ${ean}
      union all
      select a.sku, 4 from articles a where a.tenant_id = ${tenantId} and a.ean = ${ean}
    ) c
    where exists (select 1 from own_stock os where os.tenant_id = ${tenantId} and os.sku = c.sku)
    order by prio
    limit 1`);
  return res.rows[0]?.sku ?? null;
}

export type LinkResult = { stockSku: string; booked: number; note: string };

/**
 * Ein im eBay-Tool veröffentlichtes Angebot in die Wawi übernehmen: Wawi-SKU per EAN
 * finden (sonst die eBay-SKU), Bestand buchen, Kanal-Angebot anlegen und die anderen
 * Kanäle abgleichen.
 *
 * `bookStock`: bei neuen Angeboten die eingestellte Menge als Lagerbestand buchen, wenn die
 * Wawi für die SKU noch keinen Bestand führt. Bei alten Angeboten (Übernahme) nicht – dort
 * kann schon verkauft sein; der Abgleich bleibt aus, bis der Bestand geprüft ist.
 */
export async function linkEbayAttempt(tenantId: string, a: ListingAttempt, opts: { bookStock: boolean }): Promise<LinkResult | null> {
  if (a.status !== "published" || !a.sku || !a.listingId) return null;
  const L = schema.listings;
  const [existing] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), eq(L.sku, a.sku)));
  const stockSku = existing?.stockSku?.trim() || (a.ean ? await matchStockSku(tenantId, a.ean) : null) || a.sku;

  let booked = 0;
  const [stock] = await db.select().from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, tenantId), eq(schema.ownStock.sku, stockSku)));
  if (opts.bookStock && (!stock || stock.quantity <= 0)) {
    booked = a.quantity - (stock?.quantity ?? 0);
    await db
      .insert(schema.ownStock)
      .values({ tenantId, sku: stockSku, quantity: a.quantity })
      .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: a.quantity, updatedAt: new Date() } });
    if (booked) await db.insert(schema.stockMovements).values({ tenantId, sku: stockSku, delta: booked, reason: "Anfangsbestand eBay-Angebot", reference: `eBay ${a.listingId}` });
  }
  const withStock = opts.bookStock || Boolean(stock);

  const values = {
    tenantId,
    channel: "ebay" as const,
    sku: a.sku,
    stockSku: stockSku === a.sku ? null : stockSku,
    title: (a.title ?? a.sku).slice(0, 80),
    ean: a.ean || null,
    condition: a.condition,
    price: a.price,
    quantity: a.quantity,
    status: "active" as const,
    externalId: a.listingId,
    payload: { offerId: a.offerId, attemptId: a.id, categoryId: a.categoryId, imageUrls: a.imageUrls ?? [] },
    pushedQuantity: a.quantity,
    pushedAt: new Date(),
    lastSyncAt: new Date(),
    // Übernommene Altangebote ohne Wawi-Bestand: erst Bestand prüfen, dann Abgleich einschalten.
    stockSync: withStock,
    lastError: withStock ? null : "Übernommen aus dem eBay-Tool – Wawi-Bestand prüfen und eintragen, dann Bestandsabgleich einschalten.",
  };
  await db
    .insert(L)
    .values(values)
    .onConflictDoUpdate({
      target: [L.tenantId, L.channel, L.sku],
      set: { title: values.title, ean: values.ean, price: values.price, status: "active", externalId: values.externalId, payload: values.payload, stockSku: values.stockSku, updatedAt: new Date() },
    });

  if (withStock) syncSoon(tenantId, [stockSku]);
  const note = booked
    ? `In der Wawi: ${booked} Stück als Bestand gebucht (SKU ${stockSku}). Die Menge wird ab jetzt mit Amazon FBM, Temu & Co. abgeglichen.`
    : stock
      ? `In der Wawi verknüpft mit SKU ${stockSku} (Bestand ${stock.quantity}). Die Menge auf eBay folgt ab jetzt dem verfügbaren Wawi-Bestand.`
      : `In der Wawi angelegt (SKU ${stockSku}) – Bestand bitte unter Bestand eintragen.`;
  return { stockSku, booked, note };
}

/** Alle veröffentlichten Angebote des eBay-Tools, die in der Wawi noch fehlen, übernehmen. */
export async function adoptEbayAttempts(tenantId: string): Promise<{ adopted: number }> {
  const attempts = (await listAttempts(ebayDb(tenantId))).filter((a) => a.status === "published" && a.sku && a.listingId);
  if (!attempts.length) return { adopted: 0 };
  const known = new Set(
    (await db.select({ sku: schema.listings.sku }).from(schema.listings).where(and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.channel, "ebay")))).map((r) => r.sku),
  );
  let adopted = 0;
  for (const a of attempts) {
    if (known.has(a.sku!)) continue;
    if (await linkEbayAttempt(tenantId, a, { bookStock: false })) adopted++;
  }
  return { adopted };
}
