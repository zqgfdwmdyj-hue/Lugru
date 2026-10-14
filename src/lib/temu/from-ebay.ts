import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { variantTitle } from "@/lib/ebay/pipeline/variants";
import type { ListingAttempt } from "@/lib/ebay/types";
import { refreshTemuListings, temuConnected, temuCreateGoods } from "@/lib/integrations/clients/temu";
import { availableOf } from "@/lib/stock/channel-logic";
import { stockLevels } from "@/lib/stock/channel-sync";
import { TEMU_GOODS_STATUS, temuGoodsFromAttempt, temuListingState, type TemuPackage } from "./goods";

// Ein im eBay-Tool veröffentlichtes Angebot zusätzlich bei Temu einstellen. In der Wawi entsteht je
// SKU ein Temu-Angebot mit derselben SKU und demselben Lager wie bei eBay.

export type TemuPanel = {
  connected: boolean;
  entries: { sku: string; label: string; goodsId: string | null; status: string | null; statusLabel: string; error: string | null }[];
  defaults: Partial<TemuPackage> & { quantities: Record<string, number> };
};

const L = schema.listings;

const skusOf = (a: ListingAttempt) => (a.variants ? a.variants.items.map((i) => i.sku) : a.sku ? [a.sku] : []);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v) || undefined);

async function temuRows(tenantId: string, a: ListingAttempt) {
  return db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "temu"), sql`${L.payload}->>'attemptId' = ${String(a.id)}`));
}

/** Verfügbare Menge je eBay-SKU aus der Wawi (über das eBay-Angebot und dessen Lager-SKU). */
async function wawiQuantities(tenantId: string, a: ListingAttempt): Promise<{ quantities: Record<string, number>; stockSkus: Map<string, string | null> }> {
  const skus = skusOf(a);
  const quantities: Record<string, number> = {};
  const stockSkus = new Map<string, string | null>();
  if (!skus.length) return { quantities, stockSkus };
  const ebay = await db.select({ sku: L.sku, stockSku: L.stockSku }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), inArray(L.sku, skus)));
  const levels = await stockLevels(tenantId);
  for (const sku of skus) {
    const own = ebay.find((e) => e.sku === sku)?.stockSku?.trim() || null;
    stockSkus.set(sku, own);
    const lvl = levels.get(own ?? sku);
    if (lvl) quantities[sku] = availableOf(lvl);
  }
  return { quantities, stockSkus };
}

/** Gewicht und Maße aus Artikelstamm/Produkten (per EAN), sonst vom letzten Temu-Versuch. */
async function packageDefaults(tenantId: string, a: ListingAttempt, rows: Awaited<ReturnType<typeof temuRows>>): Promise<Partial<TemuPackage>> {
  const sent = rows.find((r) => r.payload?.weightG)?.payload;
  if (sent) return { weightG: num(sent.weightG), lengthCm: num(sent.lengthCm), widthCm: num(sent.widthCm), heightCm: num(sent.heightCm) };
  const eans = [a.ean, ...(a.variants?.items.map((i) => i.ean) ?? [])].filter((e): e is string => Boolean(e));
  if (!eans.length) return {};
  for (const T of [schema.products, schema.articles]) {
    const [p] = await db
      .select({ w: T.weightGrams, l: T.lengthCm, b: T.widthCm, h: T.heightCm })
      .from(T)
      .where(and(eq(T.tenantId, tenantId), inArray(T.ean, eans), sql`${T.weightGrams} is not null`))
      .limit(1);
    if (p) return { weightG: num(p.w), lengthCm: num(p.l), widthCm: num(p.b), heightCm: num(p.h) };
  }
  return {};
}

export async function temuPanel(tenantId: string, a: ListingAttempt): Promise<TemuPanel> {
  const connected = await temuConnected(tenantId);
  let rows = await temuRows(tenantId, a);
  // Stand bei Temu nachsehen, solange noch nicht alles aktiv ist.
  if (connected && rows.some((r) => r.status !== "active")) {
    await refreshTemuListings(tenantId, rows.map((r) => r.id)).catch(() => 0);
    rows = await temuRows(tenantId, a);
  }
  const values = new Map((a.variants?.items ?? []).map((i) => [i.sku, i.value]));
  const { quantities } = await wawiQuantities(tenantId, a);
  return {
    connected,
    entries: rows.map((r) => {
      const status = typeof r.payload?.temuStatus === "string" ? r.payload.temuStatus.toUpperCase() : null;
      return {
        sku: r.sku,
        label: values.get(r.sku) ?? r.title,
        goodsId: r.externalId,
        status,
        statusLabel: status ? (TEMU_GOODS_STATUS[status] ?? status) : "angelegt – Temu prüft",
        error: r.lastError,
      };
    }),
    defaults: { ...(await packageDefaults(tenantId, a, rows)), quantities },
  };
}

export type TemuPublishInput = { pricePercent: number; weightG: number; lengthCm: number; widthCm: number; heightCm: number };

export async function publishAttemptToTemu(tenantId: string, a: ListingAttempt, input: TemuPublishInput): Promise<TemuPanel> {
  if (a.status !== "published" || !a.sku) throw new Error("Erst auf eBay veröffentlichen – dann liegen die Bilder öffentlich bei eBay und Temu kann sie laden.");
  if (a.condition !== "NEW") throw new Error("Über diese Funktion nur Neuware – Gebrauchtes braucht bei Temu einen eigenen Gebrauchtwaren-Shop.");
  if ((await temuRows(tenantId, a)).some((r) => r.payload?.externalGoodsId)) throw new Error("Dieses Angebot ist schon bei Temu angelegt.");
  const pricePercent = Number(input.pricePercent);
  if (!Number.isFinite(pricePercent) || pricePercent < 10 || pricePercent > 300) throw new Error("Temu-Preis: bitte zwischen 10 und 300 % vom eBay-Preis.");
  const pack: TemuPackage = { weightG: Number(input.weightG) || 0, lengthCm: Number(input.lengthCm) || 0, widthCm: Number(input.widthCm) || 0, heightCm: Number(input.heightCm) || 0 };

  const { quantities, stockSkus } = await wawiQuantities(tenantId, a);
  const goods = temuGoodsFromAttempt(a, { pricePercent, pack, quantities: new Map(Object.entries(quantities)) });
  const { goodsId } = await temuCreateGoods(tenantId, goods);

  const values = new Map((a.variants?.items ?? []).map((i) => [i.sku, i]));
  const pending = temuListingState("INCOMPLETE");
  for (const s of goods.skus) {
    const v = values.get(s.externalSkuId);
    const row = {
      tenantId,
      channel: "temu" as const,
      sku: s.externalSkuId,
      stockSku: stockSkus.get(s.externalSkuId) ?? null,
      title: (v ? variantTitle(a.title, v.value) : (a.title ?? s.externalSkuId)).slice(0, 80),
      ean: s.ean ?? null,
      condition: a.condition,
      price: s.price,
      quantity: s.quantity,
      status: "draft" as const,
      externalId: goodsId,
      payload: { attemptId: a.id, externalGoodsId: goods.externalGoodsId, goodsId, imageUrls: s.images, ...pack, ...(v ? { variant: v.value } : {}) },
      stockSync: true,
      pushedQuantity: s.quantity,
      pushedAt: new Date(),
      lastError: pending.lastError,
    };
    await db
      .insert(L)
      .values(row)
      .onConflictDoUpdate({ target: [L.tenantId, L.channel, L.sku], set: { ...row, updatedAt: new Date() } });
  }
  return temuPanel(tenantId, a);
}
