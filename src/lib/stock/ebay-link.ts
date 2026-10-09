import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listAttempts } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import type { ListingAttempt } from "@/lib/ebay/types";
import { ebayQuantity } from "@/lib/integrations/clients/ebay";
import { stockSkuOf } from "./channel-logic";
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

/** Verkauft, aber noch nicht versandt (offene eBay-Bestellungen) – liegt noch im Lager. */
async function openEbayOrderQty(tenantId: string, sku: string): Promise<number> {
  const res = await db.execute<{ qty: number }>(sql`
    select coalesce(sum(i.quantity), 0)::int as qty
      from order_items i
      join orders o on o.id = i.order_id
     where o.tenant_id = ${tenantId} and o.channel = 'ebay' and o.fulfillment = 'FBM'
       and o.status in ('open', 'label_created')
       and coalesce(o.external_status, '') !~* '(cancel|storn)'
       and i.sku = ${sku}`);
  return Number(res.rows[0]?.qty ?? 0);
}

export type EbayStock = { onHand: number; ebay: number; reserved: number };

/**
 * Lagerbestand eines laufenden eBay-Angebots: was eBay gerade anbietet (nach allen Verkäufen)
 * plus verkaufte, noch nicht versandte Stück.
 */
export async function ebayStockOf(tenantId: string, sku: string): Promise<EbayStock> {
  const ebay = await ebayQuantity(tenantId, sku);
  const reserved = await openEbayOrderQty(tenantId, sku);
  return { onHand: ebay + reserved, ebay, reserved };
}

type OwnStock = typeof schema.ownStock.$inferSelect;

/** Bestand setzen und als Bewegung festhalten. Gibt die gebuchte Änderung zurück. */
async function bookStock(tenantId: string, sku: string, quantity: number, current: OwnStock | undefined, reason: string, reference: string): Promise<number> {
  const S = schema.ownStock;
  if (current) {
    await db.update(S).set({ quantity, updatedAt: new Date() }).where(and(eq(S.tenantId, tenantId), eq(S.sku, sku)));
  } else {
    // Nur wer den Eintrag anlegt, bucht – zwei gleichzeitige Läufe zählen nie doppelt.
    const created = await db.insert(S).values({ tenantId, sku, quantity }).onConflictDoNothing().returning({ id: S.id });
    if (!created.length) return 0;
  }
  const delta = quantity - (current?.quantity ?? 0);
  if (delta) await db.insert(schema.stockMovements).values({ tenantId, sku, delta, reason, reference });
  return delta;
}

const ADOPTED = "Übernommen aus dem eBay-Tool";
const NOT_BOOKED = "Wawi-Bestand nicht angelegt:";
/** eBay kennt die SKU nicht – Nachfragen hilft nicht, der Bestand muss von Hand eingetragen werden. */
export const UNKNOWN_SKU = /eBay kennt die SKU/;

/** `stocked`: Wawi-Bestand wurde jetzt angelegt oder gebucht. */
export type LinkResult = { stockSku: string; booked: number; stocked: boolean; note: string };

/**
 * Ein im eBay-Tool veröffentlichtes Angebot in die Wawi übernehmen: Wawi-SKU per EAN
 * finden (sonst die eBay-SKU), Bestand anlegen, Kanal-Angebot anlegen und die anderen
 * Kanäle abgleichen.
 *
 * Führt die Wawi die SKU noch nicht, wird der Bestand gebucht – bei einem neuen Angebot die
 * eingestellte Menge, bei der Übernahme eines älteren (`adopt`) die aktuelle eBay-Menge plus
 * verkaufte, noch nicht versandte Stück (es kann ja schon verkauft sein).
 */
export async function linkEbayAttempt(tenantId: string, a: ListingAttempt, opts: { adopt?: boolean } = {}): Promise<LinkResult | null> {
  if (a.status !== "published" || !a.sku || !a.listingId) return null;
  const L = schema.listings;
  const [existing] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), eq(L.sku, a.sku)));
  const stockSku = existing?.stockSku?.trim() || (a.ean ? await matchStockSku(tenantId, a.ean) : null) || a.sku;

  const [stock] = await db.select().from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, tenantId), eq(schema.ownStock.sku, stockSku)));
  let booked = 0;
  let listed = a.quantity;
  let source: EbayStock | null = null;
  let failure: string | null = null;
  let withStock = Boolean(stock);
  if (!opts.adopt && (!stock || stock.quantity <= 0)) {
    booked = await bookStock(tenantId, stockSku, a.quantity, stock, "Anfangsbestand eBay-Angebot", `eBay ${a.listingId}`);
    withStock = true;
  } else if (opts.adopt && !stock) {
    try {
      source = await ebayStockOf(tenantId, a.sku);
      booked = await bookStock(tenantId, stockSku, source.onHand, undefined, "Anfangsbestand aus eBay-Menge", `eBay ${a.listingId}: ${source.ebay} angeboten + ${source.reserved} verkauft, nicht versandt`);
      listed = source.ebay;
      withStock = true;
    } catch (e) {
      failure = `${NOT_BOOKED} ${e instanceof Error ? e.message : String(e)} – neuer Versuch beim nächsten Abruf oder „Bestand aus eBay anlegen“.`;
    }
  }
  const fresh = withStock && !stock;

  const values = {
    tenantId,
    channel: "ebay" as const,
    sku: a.sku,
    stockSku: stockSku === a.sku ? null : stockSku,
    title: (a.title ?? a.sku).slice(0, 80),
    ean: a.ean || null,
    condition: a.condition,
    price: a.price,
    quantity: listed,
    status: "active" as const,
    externalId: a.listingId,
    payload: { offerId: a.offerId, attemptId: a.id, categoryId: a.categoryId, imageUrls: a.imageUrls ?? [] },
    pushedQuantity: listed,
    pushedAt: new Date(),
    lastSyncAt: new Date(),
    stockSync: withStock,
    lastError: withStock ? null : (failure ?? `${ADOPTED} – Wawi-Bestand prüfen und eintragen, dann Bestandsabgleich einschalten.`),
  };
  await db
    .insert(L)
    .values(values)
    .onConflictDoUpdate({
      target: [L.tenantId, L.channel, L.sku],
      set: {
        title: values.title,
        ean: values.ean,
        price: values.price,
        status: "active",
        externalId: values.externalId,
        payload: values.payload,
        stockSku: values.stockSku,
        // Bestand gerade angelegt → ab jetzt abgleichen.
        ...(fresh || booked ? { stockSync: true, lastError: null, quantity: listed, pushedQuantity: listed, pushedAt: new Date() } : {}),
        updatedAt: new Date(),
      },
    });
  await dropReplacedDrafts(tenantId, a.sku, stockSku);

  if (withStock) syncSoon(tenantId, [stockSku]);
  const note = source
    ? `In der Wawi: ${source.onHand} Stück als Bestand gebucht (SKU ${stockSku}: ${source.ebay} auf eBay + ${source.reserved} verkauft, noch nicht versandt). Die Menge wird ab jetzt mit Amazon FBM, Temu & Co. abgeglichen.`
    : booked
      ? `In der Wawi: ${booked} Stück als Bestand gebucht (SKU ${stockSku}). Die Menge wird ab jetzt mit Amazon FBM, Temu & Co. abgeglichen.`
      : stock
        ? `In der Wawi verknüpft mit SKU ${stockSku} (Bestand ${stock.quantity}). Die Menge auf eBay folgt ab jetzt dem verfügbaren Wawi-Bestand.`
        : `In der Wawi angelegt (SKU ${stockSku}) – ${failure ?? "Bestand bitte unter Bestand eintragen."}`;
  return { stockSku, booked, stocked: fresh || booked !== 0, note };
}

/** Wawi-Entwürfe für eBay („Im eBay-Tool einstellen“), die jetzt durch das echte Angebot ersetzt sind. */
async function dropReplacedDrafts(tenantId: string, ebaySku: string, stockSku: string) {
  const L = schema.listings;
  await db
    .delete(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), eq(L.status, "draft"), isNull(L.externalId), ne(L.sku, ebaySku), sql`coalesce(nullif(${L.stockSku}, ''), ${L.sku}) = ${stockSku}`));
}

/** Alle veröffentlichten Angebote des eBay-Tools, die in der Wawi noch fehlen, übernehmen – mit Bestand. */
export async function adoptEbayAttempts(tenantId: string): Promise<{ adopted: number; booked: number }> {
  const attempts = (await listAttempts(ebayDb(tenantId))).filter((a) => a.status === "published" && a.sku && a.listingId);
  if (!attempts.length) return { adopted: 0, booked: 0 };
  const known = new Set(
    (await db.select({ sku: schema.listings.sku }).from(schema.listings).where(and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.channel, "ebay")))).map((r) => r.sku),
  );
  let adopted = 0;
  let booked = 0;
  for (const a of attempts) {
    if (known.has(a.sku!)) continue;
    const r = await linkEbayAttempt(tenantId, a, { adopt: true });
    if (r) adopted++;
    if (r?.stocked) booked++;
  }
  return { adopted, booked };
}

export type EnsureResult = { done: { sku: string; stockSku: string; booked: number | null; ebay?: number; reserved?: number }[]; failed: { sku: string; error: string }[] };

/**
 * Aktive eBay-Angebote ohne Wawi-Bestand nachziehen: Wawi-SKU per EAN suchen, sonst Bestand aus
 * der aktuellen eBay-Menge (+ verkauft, nicht versandt) anlegen; danach Abgleich an.
 * Ohne `ids` nur Angebote, die abgleichen sollen oder übernommen wurden – ein bewusst
 * abgeschalteter Abgleich bleibt aus. Mit `ids` (Knopf je Zeile) genau diese Angebote.
 */
export async function ensureEbayStock(tenantId: string, ids?: string[]): Promise<EnsureResult> {
  const L = schema.listings;
  const out: EnsureResult = { done: [], failed: [] };
  if (ids && !ids.length) return out;
  const rows = await db
    .select()
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), eq(L.status, "active"), ...(ids ? [inArray(L.id, ids)] : [])));
  const have = new Set((await db.select({ sku: schema.ownStock.sku }).from(schema.ownStock).where(eq(schema.ownStock.tenantId, tenantId))).map((r) => r.sku));
  // Automatisch nicht immer wieder nachfragen, wenn eBay die SKU gar nicht kennt (nicht übers Tool eingestellt).
  const todo = rows.filter(
    (l) => !have.has(stockSkuOf(l)) && (ids || ((l.stockSync || /^(Übernommen aus dem eBay-Tool|Wawi-Bestand nicht angelegt)/.test(l.lastError ?? "")) && !UNKNOWN_SKU.test(l.lastError ?? ""))),
  );
  for (const l of todo) {
    try {
      const matched = l.ean ? await matchStockSku(tenantId, l.ean) : null;
      if (matched) {
        await db.update(L).set({ stockSku: matched === l.sku ? null : matched, stockSync: true, lastError: null, updatedAt: new Date() }).where(eq(L.id, l.id));
        out.done.push({ sku: l.sku, stockSku: matched, booked: null });
        continue;
      }
      const stockSku = stockSkuOf(l);
      const s = await ebayStockOf(tenantId, l.sku);
      const booked = await bookStock(tenantId, stockSku, s.onHand, undefined, "Anfangsbestand aus eBay-Menge", `eBay ${l.externalId ?? l.sku}: ${s.ebay} angeboten + ${s.reserved} verkauft, nicht versandt`);
      await db.update(L).set({ stockSync: true, lastError: null, quantity: s.ebay, pushedQuantity: s.ebay, pushedAt: new Date(), lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(L.id, l.id));
      out.done.push({ sku: l.sku, stockSku, booked, ebay: s.ebay, reserved: s.reserved });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(L).set({ lastError: `${NOT_BOOKED} ${msg}` }).where(eq(L.id, l.id));
      out.failed.push({ sku: l.sku, error: msg });
    }
  }
  if (out.done.length) syncSoon(tenantId, out.done.map((d) => d.stockSku));
  return out;
}
