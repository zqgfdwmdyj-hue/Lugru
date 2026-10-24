import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAttempt, listAttempts } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import type { EbayActiveItem } from "@/lib/ebay/trading-map";
import type { ListingAttempt } from "@/lib/ebay/types";
import { ebayActiveItems, ebayConnected, ebayLegacyItem } from "@/lib/integrations/clients/ebay";
import { temuConnected } from "@/lib/integrations/clients/temu";
import { adoptLegacyEbayItem, linkEbayPublished } from "@/lib/stock/ebay-link";
import { availableOf } from "@/lib/stock/channel-logic";
import { stockLevels } from "@/lib/stock/channel-sync";
import { TEMU_GOODS_STATUS, TEMU_PENDING_LABEL, type TemuPackage } from "./goods";
import { publishListingToTemu, rememberTemuDefaults, temuDefaults, temuGoodsKey } from "./from-ebay";
import type { TemuPriceRule } from "./price";

// eBay-Angebote übernehmen – alle auf einmal: aus dem eBay-Tool und ältere direkt bei eBay
// eingestellte. Auf Temu einstellen (mit Wawi-Bestand) oder nur in die Wawi. Läuft als
// Warteschlange im Hintergrund, damit auch hunderte Angebote durchgehen.

const T = schema.ebayTransfers;
const L = schema.listings;

export type TransferSource = "attempt" | "ebay";
export type TransferTarget = "temu" | "wawi";

export type Candidate = {
  key: string;
  source: TransferSource;
  ref: string;
  title: string;
  image: string | null;
  url: string | null;
  sku: string | null;
  price: number;
  quantity: number;
  /** Verfügbar in der Wawi (Bestand − reserviert) über die Lager-SKU; null = nicht in der Wawi geführt. */
  wawiQty: number | null;
  variations: number;
  ean: string | null;
  condition: string | null;
  pack: Partial<TemuPackage>;
  temu: { label: string; status: string | null; goodsId: string | null; error: string | null } | null;
  wawi: boolean;
  job: { target: TransferTarget; status: string; message: string | null } | null;
};

export type CandidateList = {
  candidates: Candidate[];
  ebay: { connected: boolean; error: string | null; loadedAt: string | null };
  temuConnected: boolean;
  rule: TemuPriceRule;
  pack: Partial<TemuPackage>;
  running: boolean;
};

// Laufende eBay-Angebote je Mandant kurz merken – das Laden blättert durch alle Seiten.
const cache = new Map<string, { at: number; items: EbayActiveItem[] }>();
const CACHE_MS = 10 * 60 * 1000;

async function activeItems(tenantId: string, fresh: boolean): Promise<{ items: EbayActiveItem[]; at: number }> {
  const hit = cache.get(tenantId);
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit;
  const items = await ebayActiveItems(tenantId);
  const entry = { at: Date.now(), items };
  cache.set(tenantId, entry);
  return entry;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v) || undefined);

/** Alle eBay-Angebote mit ihrem Stand bei Temu, in der Wawi und in der Warteschlange. */
export async function transferCandidates(tenantId: string, opts: { fresh?: boolean } = {}): Promise<CandidateList> {
  const [connected, temuOk, defaults] = await Promise.all([ebayConnected(tenantId), temuConnected(tenantId), temuDefaults(tenantId)]);
  const attempts = (await listAttempts(ebayDb(tenantId))).filter((a) => a.status === "published" && a.sku && a.listingId);
  let legacy: EbayActiveItem[] = [];
  let error: string | null = null;
  let loadedAt: string | null = null;
  if (connected) {
    try {
      const r = await activeItems(tenantId, Boolean(opts.fresh));
      legacy = r.items;
      loadedAt = new Date(r.at).toISOString();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  // Angebote aus dem eBay-Tool führt das Tool selbst – nicht doppelt.
  const toolIds = new Set(attempts.map((a) => a.listingId!));
  legacy = legacy.filter((i) => !toolIds.has(i.itemId));

  const temuRows = await db
    .select({ key: sql<string>`${L.payload}->>'externalGoodsId'`, status: sql<string | null>`${L.payload}->>'temuStatus'`, goodsId: L.externalId, error: L.lastError, active: L.status })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.channel, "temu"), sql`${L.payload} ? 'externalGoodsId'`));
  const temuBy = new Map<string, (typeof temuRows)[number]>();
  for (const r of temuRows) if (!temuBy.has(r.key) || r.active !== "active") temuBy.set(r.key, r);
  const ebayRows = await db.select({ id: L.externalId, sku: L.sku, stockSku: L.stockSku }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay")));
  const wawiIds = new Set(ebayRows.filter((r) => r.id).map((r) => r.id!));
  const levels = await stockLevels(tenantId);
  // Verfügbare Menge: über das Wawi-Angebot (Lager-SKU) bzw. die SKU selbst; Varianten zusammengezählt.
  const qtyOf = (skus: string[], itemId?: string): number | null => {
    const found = skus.length
      ? skus.map((sku) => levels.get(ebayRows.find((r) => r.sku === sku)?.stockSku?.trim() || sku)).filter((l): l is NonNullable<typeof l> => Boolean(l))
      : [];
    if (!found.length && itemId) {
      const row = ebayRows.find((r) => r.id === itemId);
      const lvl = row ? levels.get(row.stockSku?.trim() || row.sku) : undefined;
      return lvl ? availableOf(lvl) : null;
    }
    return found.length ? found.reduce((n, l) => n + availableOf(l), 0) : null;
  };
  const jobs = await db.select().from(T).where(eq(T.tenantId, tenantId));
  const jobOf = (source: TransferSource, ref: string) => {
    const mine = jobs.filter((j) => j.source === source && j.ref === ref).sort((a, b) => +b.updatedAt - +a.updatedAt)[0];
    return mine ? { target: mine.target, status: mine.status, message: mine.message } : null;
  };
  const temuOf = (key: string) => {
    const r = temuBy.get(key);
    if (!r) return null;
    const st = r.status?.toUpperCase() ?? null;
    return { label: st ? (TEMU_GOODS_STATUS[st] ?? st) : TEMU_PENDING_LABEL, status: st, goodsId: r.goodsId, error: r.error };
  };
  const packs = await packsByEan(tenantId, attempts);

  const candidates: Candidate[] = [
    ...attempts.map((a): Candidate => {
      const prices = a.variants ? a.variants.items.map((i) => i.price) : [a.price];
      return {
        key: `attempt:${a.id}`,
        source: "attempt",
        ref: String(a.id),
        title: a.title ?? a.sku!,
        image: a.imageUrls?.[0] ?? null,
        url: a.listingId ? `https://www.ebay.de/itm/${a.listingId}` : null,
        sku: a.sku!,
        price: Math.min(...prices),
        quantity: a.variants ? a.variants.items.filter((i) => !i.set).reduce((s, i) => s + i.quantity, 0) : a.quantity,
        wawiQty: qtyOf(a.variants ? a.variants.items.filter((i) => !i.set).map((i) => i.sku) : [a.sku!], a.listingId ?? undefined),
        variations: a.variants?.items.length ?? 0,
        ean: a.ean || null,
        condition: a.condition,
        pack: packs.get(a.id) ?? {},
        temu: temuOf(temuGoodsKey(a, { attemptId: a.id })),
        wawi: wawiIds.has(a.listingId!),
        job: jobOf("attempt", String(a.id)),
      };
    }),
    ...legacy.map((i): Candidate => ({
      key: `ebay:${i.itemId}`,
      source: "ebay",
      ref: i.itemId,
      title: i.title,
      image: i.image,
      url: i.url ?? `https://www.ebay.de/itm/${i.itemId}`,
      sku: i.sku,
      price: i.price,
      quantity: i.quantity,
      wawiQty: qtyOf(i.sku ? [i.sku] : [], i.itemId),
      variations: i.variations,
      ean: null,
      condition: null,
      pack: {},
      temu: temuOf(`EB-${i.itemId}`),
      wawi: wawiIds.has(i.itemId),
      job: jobOf("ebay", i.itemId),
    })),
  ];
  return {
    candidates,
    ebay: { connected, error, loadedAt },
    temuConnected: temuOk,
    rule: defaults.rule,
    pack: defaults.pack,
    running: jobs.some((j) => j.status === "wartet" || j.status === "läuft"),
  };
}

/** Gewicht/Maße aus Produkten bzw. Artikelstamm per EAN – in einem Rutsch für alle Tool-Angebote. */
async function packsByEan(tenantId: string, attempts: ListingAttempt[]): Promise<Map<number, Partial<TemuPackage>>> {
  const out = new Map<number, Partial<TemuPackage>>();
  const eans = [...new Set(attempts.flatMap((a) => [a.ean, ...(a.variants?.items.map((i) => i.ean) ?? [])]).filter((e): e is string => Boolean(e)))];
  if (!eans.length) return out;
  const found = new Map<string, Partial<TemuPackage>>();
  for (const S of [schema.articles, schema.products]) {
    const rows = await db
      .select({ ean: S.ean, w: S.weightGrams, l: S.lengthCm, b: S.widthCm, h: S.heightCm })
      .from(S)
      .where(and(eq(S.tenantId, tenantId), inArray(S.ean, eans), sql`${S.weightGrams} is not null`));
    for (const r of rows) if (r.ean) found.set(r.ean, { weightG: num(r.w), lengthCm: num(r.l), widthCm: num(r.b), heightCm: num(r.h) });
  }
  for (const a of attempts) {
    const hit = [a.ean, ...(a.variants?.items.map((i) => i.ean) ?? [])].map((e) => (e ? found.get(e) : undefined)).find(Boolean);
    if (hit) out.set(a.id, hit);
  }
  return out;
}

export type TransferPick = { source: TransferSource; ref: string; title?: string; price?: number; pack?: Partial<TemuPackage>; packChecked?: boolean; packSource?: string };

/** Ausgewählte Angebote in die Warteschlange; startet die Abarbeitung im Hintergrund. */
export async function queueTransfers(
  tenantId: string,
  target: TransferTarget,
  picks: TransferPick[],
  opts: { rule: TemuPriceRule; pack: Partial<TemuPackage> },
): Promise<{ queued: number; problems: string[] }> {
  const problems: string[] = [];
  if (target === "temu" && !(await temuConnected(tenantId))) throw new Error("Temu ist nicht verbunden (Anbindungen → Temu).");
  if (!(opts.rule.factor >= 0.1 && opts.rule.factor <= 3)) throw new Error("Temu-Preisrechner: Faktor bitte zwischen 10 und 300 %.");
  let queued = 0;
  for (const p of picks) {
    const pack = { ...opts.pack, ...Object.fromEntries(Object.entries(p.pack ?? {}).filter(([, v]) => Number(v) > 0)) };
    if (target === "temu" && !(pack.weightG! > 0 && pack.lengthCm! > 0 && pack.widthCm! > 0 && pack.heightCm! > 0)) {
      problems.push(`${p.title ?? p.ref}: Gewicht/Paketmaße fehlen – Standardpaket oben oder in der Zeile eintragen.`);
      continue;
    }
    // Vollständig ist nicht geprüft: ohne bestätigte Versandmaße geht nichts zu Temu.
    if (target === "temu" && p.packChecked !== true) {
      problems.push(`${p.title ?? p.ref}: Versandmaße nicht bestätigt – in Schritt 3 „Versandmaße geprüft“ anhaken.`);
      continue;
    }
    const input = { factor: opts.rule.factor, food: opts.rule.food, ...(p.price && p.price > 0 ? { price: p.price } : {}), ...pack, ...(p.packSource ? { packSource: p.packSource } : {}) };
    await db
      .insert(T)
      .values({ tenantId, source: p.source, ref: p.ref, target, title: p.title?.slice(0, 200) ?? null, input, status: "wartet", message: null })
      .onConflictDoUpdate({ target: [T.tenantId, T.source, T.ref, T.target], set: { input, title: p.title?.slice(0, 200) ?? null, status: "wartet", message: null, updatedAt: new Date() } });
    queued++;
  }
  await rememberTemuDefaults(tenantId, { factor: opts.rule.factor, food: opts.rule.food, pack: opts.pack });
  if (queued) kickTransfers(tenantId);
  return { queued, problems };
}

const running = new Set<string>();

export function kickTransfers(tenantId: string) {
  void runTransfers(tenantId).catch((e) => console.error("[eBay-Übernahme]", e instanceof Error ? e.message : e));
}

const PAUSE_MS = Number(process.env.TRANSFER_PAUSE_MS ?? 400);

/** Warteschlange abarbeiten (ein Lauf je Mandant). Hängengebliebene Aufträge (Neustart) kommen wieder dran. */
export async function runTransfers(tenantId: string): Promise<number> {
  if (running.has(tenantId)) return 0;
  running.add(tenantId);
  let done = 0;
  try {
    await db
      .update(T)
      .set({ status: "wartet" })
      .where(and(eq(T.tenantId, tenantId), eq(T.status, "läuft"), lt(T.updatedAt, new Date(Date.now() - 15 * 60 * 1000))));
    for (;;) {
      const [job] = await db.select().from(T).where(and(eq(T.tenantId, tenantId), eq(T.status, "wartet"))).orderBy(T.createdAt).limit(1);
      if (!job) break;
      await db.update(T).set({ status: "läuft", updatedAt: new Date() }).where(eq(T.id, job.id));
      try {
        const message = await processTransfer(tenantId, job);
        await db.update(T).set({ status: "fertig", message, updatedAt: new Date() }).where(eq(T.id, job.id));
      } catch (e) {
        await db.update(T).set({ status: "fehler", message: e instanceof Error ? e.message : String(e), updatedAt: new Date() }).where(eq(T.id, job.id));
      }
      done++;
      if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  } finally {
    running.delete(tenantId);
  }
  return done;
}

type Job = typeof T.$inferSelect;

async function processTransfer(tenantId: string, job: Job): Promise<string> {
  const input = job.input as { factor: number; food?: boolean; price?: number; weightG?: number; lengthCm?: number; widthCm?: number; heightCm?: number };
  const pack = { weightG: Number(input.weightG) || 0, lengthCm: Number(input.lengthCm) || 0, widthCm: Number(input.widthCm) || 0, heightCm: Number(input.heightCm) || 0 };
  let a: ListingAttempt;
  let wawiNote: string | undefined;
  if (job.source === "attempt") {
    const found = await getAttempt(ebayDb(tenantId), Number(job.ref));
    if (!found || found.status !== "published") throw new Error("Angebot im eBay-Tool nicht (mehr) veröffentlicht.");
    a = found;
    const L2 = schema.listings;
    const known = await db.select({ id: L2.id }).from(L2).where(and(eq(L2.tenantId, tenantId), eq(L2.channel, "ebay"), eq(L2.externalId, a.listingId!))).limit(1);
    if (!known.length) wawiNote = await linkEbayPublished(tenantId, a, { adopt: true });
  } else {
    const item = await ebayLegacyItem(tenantId, job.ref);
    if (!item.active) throw new Error("Angebot ist bei eBay nicht mehr aktiv.");
    a = item.attempt;
    wawiNote = await adoptLegacyEbayItem(tenantId, item);
  }
  if (job.target === "wawi") return wawiNote ?? "Schon in der Wawi.";
  if (a.condition !== "NEW") throw new Error("Gebraucht/B-Ware – über diese Funktion nur Neuware zu Temu. In der Wawi ist es trotzdem übernommen.");
  const single = !a.variants && a.sku;
  const { goodsId, skus, quantity, fromWawi } = await publishListingToTemu(
    tenantId,
    a,
    { factor: input.factor, food: Boolean(input.food), prices: single && input.price ? { [a.sku!]: input.price } : {}, ...pack },
    job.source === "attempt" ? { attemptId: a.id } : { ebayItemId: job.ref },
  );
  return `Bei Temu angelegt (Temu-Nr. ${goodsId}${skus > 1 ? `, ${skus} Varianten` : ""}, Menge ${quantity} ${fromWawi ? "aus dem verfügbaren Wawi-Bestand, beim Einstellen geprüft" : "aus eBay – nicht in der Wawi"}) – Temu prüft.`;
}
