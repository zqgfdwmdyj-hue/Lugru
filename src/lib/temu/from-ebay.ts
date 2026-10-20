import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { variantTitle } from "@/lib/ebay/pipeline/variants";
import type { ListingAttempt } from "@/lib/ebay/types";
import { refreshTemuListings, temuConnected, temuCreateGoods } from "@/lib/integrations/clients/temu";
import { availableOf } from "@/lib/stock/channel-logic";
import { stockLevels } from "@/lib/stock/channel-sync";
import { TEMU_GOODS_STATUS, TEMU_PENDING_LABEL, temuGoodsFromAttempt, temuListingState, type TemuPackage } from "./goods";
import { TEMU_PRICE_RULE, temuFactor, type TemuPriceRule } from "./price";

// Ein eBay-Angebot zusätzlich bei Temu einstellen – aus dem eBay-Tool oder ein älteres direkt bei
// eBay. In der Wawi entsteht je SKU ein Temu-Angebot mit derselben SKU und demselben Lager wie bei eBay.

export type TemuPanel = {
  connected: boolean;
  entries: { sku: string; label: string; goodsId: string | null; status: string | null; statusLabel: string; error: string | null; compliance: string | null; complianceRaw: string | null; price: number | null }[];
  defaults: Partial<TemuPackage> & { quantities: Record<string, number>; rule: TemuPriceRule };
};

/** Woher das Angebot kommt: Nummer im eBay-Tool oder Artikelnummer eines älteren eBay-Angebots. */
export type TemuSource = { attemptId?: number; ebayItemId?: string };

const L = schema.listings;

const skusOf = (a: ListingAttempt) => (a.variants ? a.variants.items.map((i) => i.sku) : a.sku ? [a.sku] : []);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v) || undefined);

/** Angebotsnummer bei Temu (externalGoodsId): die eBay-SKU bzw. Gruppennummer, bei älteren Angeboten aus der Artikelnummer. */
export const temuGoodsKey = (a: ListingAttempt, src: TemuSource) => (src.ebayItemId ? `EB-${src.ebayItemId}` : a.sku!);

async function temuRows(tenantId: string, key: string) {
  return db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "temu"), sql`${L.payload}->>'externalGoodsId' = ${key}`));
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

/** Zuletzt benutzter Preisrechner und Standardpaket des Mandanten. */
export async function temuDefaults(tenantId: string): Promise<{ rule: TemuPriceRule; pack: Partial<TemuPackage> }> {
  const [t] = await db.select({ s: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const s = t?.s?.temu ?? {};
  return {
    rule: { factor: s.factor && s.factor > 0 ? s.factor : TEMU_PRICE_RULE.factor, food: Boolean(s.food) },
    pack: { weightG: num(s.pack?.weightG), lengthCm: num(s.pack?.lengthCm), widthCm: num(s.pack?.widthCm), heightCm: num(s.pack?.heightCm) },
  };
}

export async function rememberTemuDefaults(tenantId: string, patch: { factor?: number; food?: boolean; pack?: Partial<TemuPackage> }) {
  const T = schema.tenants;
  await db
    .update(T)
    .set({ settings: sql`${T.settings} || jsonb_build_object('temu', coalesce(${T.settings}->'temu', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(T.id, tenantId));
}

/** Gewicht und Maße aus Artikelstamm/Produkten (per EAN), sonst vom letzten Temu-Versuch. */
export async function packageDefaults(tenantId: string, a: ListingAttempt, rows: Awaited<ReturnType<typeof temuRows>> = []): Promise<Partial<TemuPackage>> {
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
  const key = temuGoodsKey(a, { attemptId: a.id });
  let rows = await temuRows(tenantId, key);
  // Stand bei Temu nachsehen, solange noch nicht alles aktiv ist.
  if (connected && rows.some((r) => r.status !== "active")) {
    await refreshTemuListings(tenantId, rows.map((r) => r.id)).catch(() => 0);
    rows = await temuRows(tenantId, key);
  }
  const values = new Map((a.variants?.items ?? []).map((i) => [i.sku, i.value]));
  const { quantities } = await wawiQuantities(tenantId, a);
  const { rule } = await temuDefaults(tenantId);
  return {
    connected,
    entries: rows.map((r) => {
      const status = typeof r.payload?.temuStatus === "string" ? r.payload.temuStatus.toUpperCase() : null;
      return {
        sku: r.sku,
        label: values.get(r.sku) ?? r.title,
        goodsId: r.externalId,
        status,
        statusLabel: status ? (TEMU_GOODS_STATUS[status] ?? status) : TEMU_PENDING_LABEL,
        error: r.lastError,
        compliance: typeof r.payload?.compliance === "string" ? r.payload.compliance : null,
        complianceRaw: typeof r.payload?.complianceRaw === "string" ? r.payload.complianceRaw : null,
        price: r.price === null || r.price === undefined ? null : Number(r.price),
      };
    }),
    defaults: { ...(await packageDefaults(tenantId, a, rows)), quantities, rule },
  };
}

/** `factor` z. B. 0,85 (Preisrechner); `prices` je SKU überschreiben den Rechner. */
export type TemuPublishInput = { factor: number; food?: boolean; prices?: Record<string, number>; weightG: number; lengthCm: number; widthCm: number; heightCm: number };

/** Angebot bei Temu anlegen und je SKU ein Wawi-Angebot (Kanal Temu, Entwurf bis zur Freigabe). */
export async function publishListingToTemu(tenantId: string, a: ListingAttempt, input: TemuPublishInput, src: TemuSource): Promise<{ goodsId: string; skus: number }> {
  if (a.status !== "published" || !a.sku) throw new Error("Erst auf eBay veröffentlichen – dann liegen die Bilder öffentlich bei eBay und Temu kann sie laden.");
  if (a.condition !== "NEW") throw new Error("Nur Neuware – Gebrauchtes braucht bei Temu einen eigenen Gebrauchtwaren-Shop.");
  const key = temuGoodsKey(a, src);
  if ((await temuRows(tenantId, key)).length) throw new Error("Dieses Angebot ist schon bei Temu angelegt.");
  const factor = temuFactor(Math.round(Number(input.factor) * 10000) / 100);
  if (!factor) throw new Error("Temu-Preisrechner: Faktor bitte zwischen 10 und 300 %.");
  const rule: TemuPriceRule = { factor, food: Boolean(input.food) };
  const prices = new Map<string, number>();
  for (const [sku, p] of Object.entries(input.prices ?? {})) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Temu-Preis für ${sku} fehlt oder ist 0 €.`);
    prices.set(sku, n);
  }
  const pack: TemuPackage = { weightG: Number(input.weightG) || 0, lengthCm: Number(input.lengthCm) || 0, widthCm: Number(input.widthCm) || 0, heightCm: Number(input.heightCm) || 0 };

  const { quantities, stockSkus } = await wawiQuantities(tenantId, a);
  const goods = temuGoodsFromAttempt(a, { rule, prices, pack, quantities: new Map(Object.entries(quantities)), goodsId: key });
  const { goodsId } = await temuCreateGoods(tenantId, goods);

  const values = new Map((a.variants?.items ?? []).map((i) => [i.sku, i]));
  const pending = temuListingState(null);
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
      payload: {
        ...(src.attemptId ? { attemptId: src.attemptId } : {}),
        ...(src.ebayItemId ? { ebayItemId: src.ebayItemId } : {}),
        externalGoodsId: key,
        goodsId,
        imageUrls: s.images,
        ...pack,
        priceRule: rule,
        ...(v ? { variant: v.value } : {}),
      },
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
  await rememberTemuDefaults(tenantId, { factor: rule.factor, food: rule.food });
  // Gleich nachsehen, wo Temu das Produkt einsortiert hat (aktiv, unvollständig, Entwurf …).
  const ids = (await temuRows(tenantId, key)).map((r) => r.id);
  await refreshTemuListings(tenantId, ids).catch(() => 0);
  return { goodsId, skus: goods.skus.length };
}

export async function publishAttemptToTemu(tenantId: string, a: ListingAttempt, input: TemuPublishInput): Promise<TemuPanel> {
  await publishListingToTemu(tenantId, a, input, { attemptId: a.id });
  return temuPanel(tenantId, a);
}
