import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { FeedMapping, OfferMarket } from "@/db/schema";
import { keepaPack, parseKeepaProduct } from "@/lib/brands/market";
import { decryptSecret } from "@/lib/crypto";
import { listingRestrictions } from "@/lib/integrations/clients/amazon";
import { keepaByCode, keepaKey, keepaProducts } from "@/lib/integrations/clients/keepa";
import { getSettings } from "@/lib/settings";
import { parseAmount } from "@/lib/numbers";
import { readTable, type Table } from "@/lib/tabular";
import { econOf } from "./offer-econ";
import { authHeaders, autoMapping, keepaPriority, looksLikeEan, normEan } from "./prices";

const O = schema.supplierOffers;
const F = schema.supplierFeeds;
type Feed = typeof F.$inferSelect;

/** Keepa erneut fragen, wenn der letzte Stand älter ist (Tage). */
export const KEEPA_MAX_AGE_DAYS = 2;
/** Höchstens so viele EANs je Hintergrund-Lauf – der Rest folgt im nächsten. */
export const KEEPA_CODES_PER_RUN = 300;
/** Unter diesem Token-Stand pausiert der Abgleich bis zum nächsten Lauf. */
export const KEEPA_MIN_TOKENS = 20;

const keepaState = new Map<string, { tokensLeft: number | null; at: string }>();
export const keepaStatus = (tenantId: string) => keepaState.get(tenantId) ?? null;


// ---- Import (Upload, Link-Abruf) ------------------------------------------------------------

/**
 * Preisliste übernehmen: Angebote anlegen/aktualisieren, Tagesstand in den Verlauf.
 * `full`: die Liste ist vollständig – was fehlt, ist beim Lieferanten nicht mehr gelistet.
 */
export async function importTable(tenantId: string, feed: Feed, table: Table, opts: { mapping?: FeedMapping; full: boolean }) {
  const mapping = autoMapping(table.headers, { ...feed.mapping, ...(opts.mapping ?? {}) });
  if (!mapping.supplierSku || !table.headers.includes(mapping.supplierSku)) {
    return { ok: false as const, message: "Bitte die Spalten zuordnen (mindestens Artikelnummer oder EAN).", headers: table.headers, mapping };
  }
  const idx = (h?: string) => (h ? table.headers.indexOf(h) : -1);
  const col = { ean: idx(mapping.ean), asin: idx(mapping.asin), sku: idx(mapping.supplierSku), title: idx(mapping.title), price: idx(mapping.price), stock: idx(mapping.stock), moq: idx(mapping.moq), url: idx(mapping.url) };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const seen = new Map<string, Record<string, unknown>>();
  for (const r of table.rows) {
    const supplierSku = cell(r, col.sku);
    if (!supplierSku) continue;
    const stockRaw = cell(r, col.stock);
    seen.set(supplierSku, {
      tenantId,
      feedId: feed.id,
      supplierSku,
      ean: col.ean >= 0 ? normEan(cell(r, col.ean)) : null,
      asin: col.asin >= 0 ? cell(r, col.asin).toUpperCase() || null : null,
      title: cell(r, col.title) || null,
      price: col.price >= 0 ? parseAmount(cell(r, col.price)) : null,
      // „auf Lager“/„lieferbar“ ohne Zahl: Bestand unbekannt, aber vorhanden.
      stock: col.stock >= 0 ? (/^\d/.test(stockRaw.replace(/[^\d,.-]/g, "")) ? Math.max(0, Math.round(parseAmount(stockRaw) ?? 0)) : /nicht|out|0|ausverkauft/i.test(stockRaw) ? 0 : null) : null,
      moq: col.moq >= 0 ? Math.max(1, Math.round(parseAmount(cell(r, col.moq)) ?? 1)) : null,
      url: col.url >= 0 && /^https?:\/\//i.test(cell(r, col.url)) ? cell(r, col.url) : null,
      active: true,
      lastSeenAt: new Date(),
    });
  }
  const values = [...seen.values()];
  const started = new Date(Date.now() - 1000);
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(O)
      .values(values.slice(i, i + 500) as (typeof O.$inferInsert)[])
      .onConflictDoUpdate({
        target: [O.feedId, O.supplierSku],
        set: {
          ean: sql`coalesce(excluded.ean, ${O.ean})`,
          asin: sql`coalesce(excluded.asin, ${O.asin})`,
          title: sql`coalesce(excluded.title, ${O.title})`,
          priceChangedAt: sql`case when ${O.price} is distinct from excluded.price then now() else ${O.priceChangedAt} end`,
          price: sql`excluded.price`,
          stock: sql`excluded.stock`,
          moq: sql`excluded.moq`,
          url: sql`coalesce(excluded.url, ${O.url})`,
          // Steht der Artikel in der Liste, gehört er zum regelmäßigen Abgleich.
          origin: sql`'feed'`,
          active: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
  let gone = 0;
  if (opts.full && values.length) {
    // Von Hand gezogene Artikel (Seller-Knopf) stehen nie in der Liste – die bleiben.
    const r = await db.update(O).set({ active: false, stock: 0 }).where(and(eq(O.feedId, feed.id), eq(O.active, true), eq(O.origin, "feed"), sql`${O.lastSeenAt} < ${started}`)).returning({ id: O.id });
    gone = r.length;
  }
  await recordHistory(tenantId, feed.id, started);
  await shareMarket(tenantId, feed.id);
  await db.update(F).set({ mapping, lastImportAt: new Date() }).where(eq(F.id, feed.id));
  return { ok: true as const, message: `${values.length} Angebote übernommen${gone ? `, ${gone} nicht mehr gelistet` : ""}.`, mapping };
}

/** Neue Angebote einer schon geprüften EAN übernehmen die Amazon-Daten der anderen Feeds – kostet keinen Keepa-Token. */
export async function shareMarket(tenantId: string, feedId: string) {
  await db.execute(sql`
    update supplier_offers o set market = s.market
      from (select distinct on (ean) ean, market from supplier_offers
             where tenant_id = ${tenantId} and ean is not null and market->>'checkedAt' is not null
             order by ean, market->>'checkedAt' desc) s
     where o.tenant_id = ${tenantId} and o.feed_id = ${feedId} and o.market is null and o.ean = s.ean`);
}

/** Tagesstand (Preis, Bestand) aller seit `since` geänderten Angebote eines Feeds in den Verlauf. */
export async function recordHistory(tenantId: string, feedId: string, since: Date) {
  await db.execute(sql`
    insert into supplier_offer_history (tenant_id, offer_id, day, price, stock)
    select tenant_id, id, current_date, price, stock from supplier_offers
     where tenant_id = ${tenantId} and feed_id = ${feedId} and updated_at >= ${since}
    on conflict (offer_id, day) do update set price = excluded.price, stock = excluded.stock`);
}

// ---- Abruf per Link ---------------------------------------------------------------------------

export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Das ist kein gültiger Link.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Nur http(s)-Links.");
  if (!process.env.SCAN_ALLOW_PRIVATE && (/^(localhost|.*\.local|.*\.internal|.*\.ts\.net)$/i.test(u.hostname) || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|\[)/.test(u.hostname))) {
    throw new Error("Nur öffentliche Adressen.");
  }
  return u;
}

/** Weiterleitungen selbst folgen: jedes Ziel muss öffentlich sein, der Zugang geht nur an den ursprünglichen Host. */
export async function fetchFollow(raw: string, auth: Record<string, string>): Promise<Response> {
  let u = assertPublicUrl(raw);
  const origin = u.origin;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(u, { headers: { "User-Agent": "Seller-System (Preisliste)", ...(u.origin === origin ? auth : {}) }, redirect: "manual", signal: AbortSignal.timeout(120_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res;
    u = assertPublicUrl(new URL(next, u).toString());
  }
  throw new Error("Zu viele Weiterleitungen.");
}


export async function pullFeed(tenantId: string, feedId: string) {
  const [feed] = await db.select().from(F).where(and(eq(F.id, feedId), eq(F.tenantId, tenantId)));
  if (!feed?.sourceUrl) throw new Error("Für diesen Feed ist kein Link hinterlegt.");
  try {
    const res = await fetchFollow(feed.sourceUrl, authHeaders(feed.sourceAuth ? decryptSecret(feed.sourceAuth) : null));
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? `Zugang abgelehnt (HTTP ${res.status}) – Zugangsdaten prüfen.` : `Abruf fehlgeschlagen (HTTP ${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) throw new Error("Datei größer als 50 MB.");
    const head = new TextDecoder().decode(bytes.slice(0, 400));
    if (/<html|<!doctype/i.test(head)) throw new Error("Der Link liefert eine Webseite statt einer Preisliste (Login nötig?).");
    const r = await importTable(tenantId, feed, readTable(bytes), { full: true });
    if (!r.ok) throw new Error(r.message);
    await db.update(F).set({ lastPullAt: new Date(), lastPullError: null }).where(eq(F.id, feedId));
    return r.message;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(F).set({ lastPullAt: new Date(), lastPullError: msg }).where(eq(F.id, feedId));
    throw new Error(msg);
  }
}

/** Fällige Feeds abholen (Hintergrund), danach Keepa für Neues/Geändertes. */
export async function pullDueFeeds(tenantId: string) {
  const feeds = await db
    .select({ id: F.id })
    .from(F)
    .where(and(eq(F.tenantId, tenantId), eq(F.autoPull, true), isNotNull(F.sourceUrl), sql`(${F.lastPullAt} is null or ${F.lastPullAt} < now() - make_interval(hours => ${F.pullEveryHours}))`));
  let pulled = 0;
  for (const f of feeds) {
    try {
      await pullFeed(tenantId, f.id);
      pulled++;
    } catch {
      /* Fehler steht am Feed */
    }
  }
  return { pulled, due: feeds.length };
}

// ---- Keepa: Amazon-Daten mit Token-Budget ------------------------------------------------------

/** Keepa-Produkt → Marktdaten (gleich für alle Angebote mit dieser EAN) und Tagesstand im VK-Verlauf. */
async function applyKeepa(tenantId: string, ean: string, p: Record<string, unknown> | undefined, now: string) {
  const mp = p ? parseKeepaProduct(p) : null;
  const cur = ((p?.stats ?? {}) as { current?: number[] }).current ?? [];
  const market: OfferMarket = mp
    ? {
        checkedAt: now,
        asin: mp.asin,
        title: mp.title,
        price: mp.price,
        fbaFee: mp.fbaFee,
        referralPct: mp.referralPct,
        monthlySold: mp.monthlySold,
        salesRank: mp.salesRank,
        items: mp.items ?? null,
        netG: mp.netG ?? null,
        offers: typeof cur[11] === "number" && cur[11] >= 0 ? cur[11] : null,
        amazonSells: typeof cur[0] === "number" ? cur[0] > 0 : null,
      }
    : { checkedAt: now, asin: null, price: null, fbaFee: null, referralPct: null, monthlySold: null, salesRank: null };
  // Die Verkaufsfreigabe (eigene Prüfung) bleibt erhalten, solange es dieselbe ASIN ist.
  await db
    .update(O)
    .set({
      market: sql`${JSON.stringify(market)}::jsonb || (case when ${O.market}->'sellable' is not null and ${O.market}->>'asin' = ${market.asin} then jsonb_build_object('sellable', ${O.market}->'sellable') else '{}'::jsonb end)`,
      ...(mp ? { asin: sql`coalesce(${O.asin}, ${mp.asin})` } : {}),
    })
    .where(and(eq(O.tenantId, tenantId), eq(O.ean, ean)));
  if (mp?.asin) {
    await db.execute(sql`
      insert into market_history (tenant_id, asin, day, price, sales_rank, monthly_sold, offers)
      values (${tenantId}, ${mp.asin}, current_date, ${mp.price}, ${mp.salesRank}, ${mp.monthlySold}, ${market.offers ?? null})
      on conflict (tenant_id, asin, day) do update set price = excluded.price, sales_rank = excluded.sales_rank, monthly_sold = excluded.monthly_sold, offers = excluded.offers`);
  }
  return Boolean(mp);
}

/** Welche EANs als Nächstes zu Keepa – je EAN nur einmal, egal in wie vielen Feeds. */
export async function keepaQueue(tenantId: string, limit = KEEPA_CODES_PER_RUN) {
  const rows = await db.execute<{ ean: string; checked: string | null; changed: string | null }>(sql`
    select ean, min(market->>'checkedAt') as checked, max(price_changed_at)::text as changed
      from supplier_offers
     where tenant_id = ${tenantId} and active and ean is not null and price is not null and origin = 'feed'
     group by ean`);
  const now = new Date().toISOString();
  const ranked = rows.rows
    .map((r) => ({ ean: r.ean, prio: keepaPriority({ checkedAt: r.checked, priceChangedAt: r.changed ? new Date(r.changed).toISOString() : null, now, maxAgeDays: KEEPA_MAX_AGE_DAYS }) }))
    .filter((r): r is { ean: string; prio: number } => r.prio !== null)
    .sort((a, b) => a.prio - b.prio);
  return { total: ranked.length, next: ranked.slice(0, limit).map((r) => r.ean) };
}

export async function refreshMarket(tenantId: string, opts: { eans?: string[]; limit?: number } = {}) {
  const key = await keepaKey(tenantId);
  if (!key) return { checked: 0, found: 0, waiting: 0, tokensLeft: null as number | null, note: "Kein Keepa-Schlüssel" };
  const known = keepaState.get(tenantId);
  if (!opts.eans && known?.tokensLeft !== null && known?.tokensLeft !== undefined && known.tokensLeft < KEEPA_MIN_TOKENS && Date.now() - Date.parse(known.at) < 30 * 60_000) {
    return { checked: 0, found: 0, waiting: (await keepaQueue(tenantId, 0)).total, tokensLeft: known.tokensLeft, note: "Keepa-Tokens knapp – nächster Lauf später" };
  }
  const queue = opts.eans ? { total: opts.eans.length, next: opts.eans } : await keepaQueue(tenantId, opts.limit ?? KEEPA_CODES_PER_RUN);
  let checked = 0;
  let found = 0;
  let tokensLeft: number | null = null;
  for (let n = 0; n < queue.next.length; n += 100) {
    const batch = queue.next.slice(n, n + 100);
    const res = await keepaByCode(key, batch);
    tokensLeft = res.tokensLeft;
    keepaState.set(tenantId, { tokensLeft, at: new Date().toISOString() });
    const byCode = new Map<string, Record<string, unknown>>();
    for (const p of res.products) {
      for (const c of [...((p.eanList as string[] | undefined) ?? []), ...((p.upcList as string[] | undefined) ?? [])]) {
        const e = normEan(String(c));
        if (e) byCode.set(e, p);
      }
    }
    const now = new Date().toISOString();
    for (const ean of batch) {
      if (await applyKeepa(tenantId, ean, byCode.get(ean), now)) found++;
      checked++;
    }
    if (tokensLeft !== null && tokensLeft < KEEPA_MIN_TOKENS) break;
  }
  return { checked, found, waiting: Math.max(0, queue.total - checked), tokensLeft, note: null };
}

/**
 * Packungsangaben (Stückzahl, Inhalt) für Angebote per ASIN bei Keepa nachladen – 1 Token je ASIN.
 * Für ältere Treffer, die noch ohne diese Angaben gespeichert wurden.
 */
export async function refreshPackData(tenantId: string, offerIds: string[]) {
  const key = await keepaKey(tenantId);
  if (!key) return { asked: 0, found: 0, tokensLeft: null as number | null, note: "Kein Keepa-Schlüssel – unter Anbindungen → Keepa eintragen." };
  if (!offerIds.length) return { asked: 0, found: 0, tokensLeft: null, note: null };
  const rows = await db
    .select({ asin: sql<string>`${O.market}->>'asin'` })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), inArray(O.id, offerIds.slice(0, 500)), sql`${O.market}->>'asin' is not null`));
  const asins = [...new Set(rows.map((r) => r.asin))].slice(0, 300);
  let found = 0;
  let tokensLeft: number | null = null;
  for (let n = 0; n < asins.length; n += 100) {
    const res = await keepaProducts(key, asins.slice(n, n + 100));
    tokensLeft = res.tokensLeft;
    keepaState.set(tenantId, { tokensLeft, at: new Date().toISOString() });
    for (const p of res.products) {
      if (typeof p.asin !== "string") continue;
      const pack = keepaPack(p);
      if (pack.items || pack.netG) found++;
      await db.execute(sql`
        update supplier_offers set market = market || ${JSON.stringify(pack)}::jsonb
         where tenant_id = ${tenantId} and market->>'asin' = ${p.asin}`);
    }
    if (tokensLeft !== null && tokensLeft < KEEPA_MIN_TOKENS) break;
  }
  return { asked: asins.length, found, tokensLeft, note: null };
}

// ---- Abfrage: wer hat es zu welchem Preis? ----------------------------------------------------

export type LookupOffer = {
  id: string;
  feedId: string;
  feedName: string;
  supplier: string | null;
  pricesGross: boolean;
  costPct: number;
  vatPct: number | null;
  supplierSku: string;
  ean: string | null;
  asin: string | null;
  title: string | null;
  price: number | null;
  stock: number | null;
  moq: number | null;
  url: string | null;
  pack: string | null;
  market: OfferMarket | null;
  amazonQty: number | null;
  active: boolean;
  lastSeenAt: Date | null;
  lastImportAt: Date | null;
};

/** Angebote zu EAN, ASIN oder Titelwörtern über alle Feeds. */
export async function lookupOffers(tenantId: string, q: string, feedIds?: string[]): Promise<LookupOffer[]> {
  const term = q.trim();
  if (!term) return [];
  const ean = looksLikeEan(term) ? normEan(term) : null;
  const asin = /^[A-Z0-9]{10}$/i.test(term) && /[A-Z]/i.test(term) ? term.toUpperCase() : null;
  const words = term.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  const cond = ean
    ? sql`o.ean = ${ean}`
    : asin
      ? sql`(o.asin = ${asin} or o.market->>'asin' = ${asin})`
      : sql`(${sql.join(words.map((w) => sql`(o.title ilike ${"%" + w + "%"} or o.supplier_sku ilike ${"%" + w + "%"})`), sql` and `)})`;
  const res = await db.execute<LookupOffer & { cost_pct: string | null; vat_pct: string | null }>(sql`
    select o.id, o.feed_id as "feedId", f.name as "feedName", coalesce(s.name, s.code) as supplier, f.prices_gross as "pricesGross",
           f.mapping->>'costPct' as cost_pct, f.mapping->>'vatPct' as vat_pct,
           o.supplier_sku as "supplierSku", o.ean, coalesce(o.asin, o.market->>'asin') as asin, o.title, o.price::float as price, o.stock, o.moq, o.url, o.pack,
           o.market, o.amazon_qty as "amazonQty", o.active, o.last_seen_at as "lastSeenAt", f.last_import_at as "lastImportAt"
      from supplier_offers o
      join supplier_feeds f on f.id = o.feed_id
      left join suppliers s on s.id = f.supplier_id
     where o.tenant_id = ${tenantId} and ${cond}
       ${feedIds?.length ? sql`and o.feed_id in (${sql.join(feedIds.map((f) => sql`${f}`), sql`, `)})` : sql``}
     order by o.price nulls last
     limit 300`);
  return res.rows.map((r) => ({ ...r, costPct: Number(r.cost_pct || 0), vatPct: r.vat_pct ? Number(r.vat_pct) : null }));
}

/** EK-Verlauf je Angebot (letzte `days` Tage). */
export async function offerHistory(tenantId: string, offerIds: string[], days = 120) {
  if (!offerIds.length) return new Map<string, { day: string; price: number | null; stock: number | null }[]>();
  const H = schema.supplierOfferHistory;
  const rows = await db
    .select({ offerId: H.offerId, day: H.day, price: H.price, stock: H.stock })
    .from(H)
    .where(and(eq(H.tenantId, tenantId), inArray(H.offerId, offerIds), sql`${H.day} >= current_date - ${days}::int`))
    .orderBy(H.day);
  const out = new Map<string, { day: string; price: number | null; stock: number | null }[]>();
  for (const r of rows) out.set(r.offerId, [...(out.get(r.offerId) ?? []), { day: r.day, price: r.price, stock: r.stock }]);
  return out;
}

/** VK-Verlauf (Amazon) je ASIN. */
export async function marketTrend(tenantId: string, asins: string[], days = 120) {
  if (!asins.length) return new Map<string, { day: string; price: number | null }[]>();
  const M = schema.marketHistory;
  const rows = await db
    .select({ asin: M.asin, day: M.day, price: M.price })
    .from(M)
    .where(and(eq(M.tenantId, tenantId), inArray(M.asin, asins), sql`${M.day} >= current_date - ${days}::int`))
    .orderBy(M.day);
  const out = new Map<string, { day: string; price: number | null }[]>();
  for (const r of rows) out.set(r.asin, [...(out.get(r.asin) ?? []), { day: r.day, price: r.price }]);
  return out;
}

/** Eigene Einkäufe zu EAN/ASIN: wann, wo, wie viel, zu welchem Netto-Preis. */
export async function ownPurchases(tenantId: string, ean: string | null, asin: string | null) {
  if (!ean && !asin) return [];
  const res = await db.execute<{ id: string; date: string | null; number: string; supplier: string | null; quantity: number; unit_net: number; status: string }>(sql`
    select po.id, coalesce(po.order_date::text, po.created_at::date::text) as date, po.number, coalesce(s.name, s.code) as supplier, i.quantity,
           round((i.unit_cost_gross / (1 + i.vat_rate / 100))::numeric, 2)::float as unit_net, po.status
      from purchase_order_items i
      join purchase_orders po on po.id = i.po_id
      left join suppliers s on s.id = po.supplier_id
     where i.tenant_id = ${tenantId} and po.status <> 'cancelled'
       and (${ean ? sql`i.ean = ${ean}` : sql`false`} or ${asin ? sql`i.asin = ${asin}` : sql`false`})
     order by 1 desc nulls last
     limit 20`);
  return res.rows;
}

// ---- Nach Scan/Upload: profitable Produkte + Verkaufsfreigabe -------------------------------

type Analysis = { step: string; at: number; note?: string | null; done?: boolean };
const ga = globalThis as typeof globalThis & { __feedAnalysis?: Map<string, Analysis> };
const analysis = (ga.__feedAnalysis ??= new Map<string, Analysis>());
/** Stand der Auswertung eines Feeds (läuft gerade / letzte Meldung). */
export const feedAnalysis = (feedId: string) => analysis.get(feedId) ?? null;

/** Profitabel = Gewinn ≥ minProfit € und ROI ≥ minRoi % gegen den Amazon-Preis (wie „Chancen“). */
export async function profitableOffers(tenantId: string, feedId: string, opts: { minRoi?: number; minProfit?: number } = {}) {
  const [feed] = await db.select().from(F).where(and(eq(F.id, feedId), eq(F.tenantId, tenantId)));
  if (!feed) return [];
  const s = await getSettings(tenantId);
  const offers = await db.select().from(O).where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), eq(O.active, true), sql`${O.market}->>'asin' is not null`));
  return offers
    .map((o) => ({ o, e: econOf({ price: o.price, title: o.title, url: o.url, market: o.market, pricesGross: feed.pricesGross, costPct: Number(feed.mapping.costPct || 0), vatPct: feed.mapping.vatPct ? Number(feed.mapping.vatPct) : null, amazonQty: o.amazonQty }, s) }))
    .filter(({ e }) => e.profit !== null && e.roi !== null && e.profit >= (opts.minProfit ?? 1) && e.roi >= (opts.minRoi ?? 20))
    .sort((a, b) => (b.e.roi ?? 0) - (a.e.roi ?? 0));
}

/** Verkaufsfreigabe je ASIN prüfen (höchstens 60 je Lauf, Ergebnis 7 Tage gültig) und an allen Angeboten merken. */
export async function checkSellable(tenantId: string, asins: string[], opts: { force?: boolean } = {}) {
  const unique = [...new Set(asins.filter(Boolean))];
  if (!unique.length) return { checked: 0, ok: 0 };
  const known = await db.execute<{ asin: string; at: string | null }>(sql`
    select distinct on (market->>'asin') market->>'asin' as asin, market->'sellable'->>'at' as at
      from supplier_offers where tenant_id = ${tenantId} and market->>'asin' in (${sql.join(unique.map((a) => sql`${a}`), sql`, `)})
     order by market->>'asin', market->'sellable'->>'at' desc nulls last`);
  const fresh = new Set(known.rows.filter((r) => r.at && Date.now() - Date.parse(r.at) < 7 * 86_400_000).map((r) => r.asin));
  const todo = unique.filter((a) => opts.force || !fresh.has(a)).slice(0, 60);
  const res = await listingRestrictions(tenantId, todo);
  const at = new Date().toISOString();
  let ok = 0;
  for (const [asin, v] of res) {
    if (v.ok) ok++;
    await db.execute(sql`update supplier_offers set market = market || jsonb_build_object('sellable', ${JSON.stringify({ ...v, at })}::jsonb) where tenant_id = ${tenantId} and market->>'asin' = ${asin}`);
  }
  return { checked: res.size, ok };
}

/**
 * Nach Scan oder Upload im Hintergrund: Keepa für neue EANs, dann für die profitablen Produkte
 * die Verkaufsfreigabe (falls das Amazon-Konto verbunden ist). Die Feed-Seite zeigt den Stand.
 */
export async function analyzeFeed(tenantId: string, feedId: string) {
  if (analysis.get(feedId)?.done === false) return;
  analysis.set(feedId, { step: "Keepa prüft die Artikel auf amazon.de …", at: Date.now(), done: false });
  const notes: string[] = [];
  try {
    if (await keepaKey(tenantId)) {
      const rows = await db
        .selectDistinct({ ean: O.ean })
        .from(O)
        .where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), isNotNull(O.ean), sql`(${O.market} is null or (${O.market}->>'checkedAt')::timestamptz < now() - interval '7 days')`))
        .limit(300);
      const r = await refreshMarket(tenantId, { eans: rows.map((x) => x.ean!) });
      notes.push(`Keepa: ${r.found} von ${r.checked} auf amazon.de gefunden`);
    } else {
      notes.push("Kein Keepa-Schlüssel – Amazon-Preise fehlen");
    }
    const prof = await profitableOffers(tenantId, feedId);
    notes.push(`${prof.length} profitabel`);
    if (prof.length) {
      analysis.set(feedId, { step: "Prüfe die Verkaufsfreigabe bei Amazon …", at: Date.now(), done: false });
      try {
        const s = await checkSellable(tenantId, prof.map((p) => p.o.market!.asin!));
        if (s.checked) notes.push(`Freigabe: ${s.ok} von ${s.checked} verkaufbar`);
      } catch (e) {
        notes.push(`Freigabe nicht geprüft: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
  } finally {
    analysis.set(feedId, { step: "", at: Date.now(), note: notes.join(" · "), done: true });
  }
}
