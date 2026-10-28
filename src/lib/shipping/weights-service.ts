import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { loadOrder } from "@/lib/orders/service";
import { PACKAGING_GRAMS } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import { wawiSku } from "@/lib/stock/channel-sync";
import { shipWeight, type ShipWeight } from "./weight";

// Versandgewicht je Artikel (Wawi-SKU) speichern und für Aufträge aller Kanäle verwenden.

export type SkuWeightInfo = { sku: string; title: string; grams: number | null };

export async function skuWeightMap(tenantId: string, skus: string[]): Promise<Map<string, number>> {
  const list = [...new Set(skus.filter(Boolean))];
  if (!list.length) return new Map();
  const W = schema.skuWeights;
  const rows = await db.select({ sku: W.sku, grams: W.grams }).from(W).where(and(eq(W.tenantId, tenantId), inArray(W.sku, list)));
  return new Map(rows.map((r) => [r.sku, r.grams]));
}

/** Gewicht je Stück setzen (0 = Eintrag löschen, dann gelten wieder Artikeldaten bzw. Schätzwert). */
export async function saveSkuWeight(tenantId: string, sku: string, grams: number) {
  const W = schema.skuWeights;
  const key = sku.trim().slice(0, 120);
  if (!key) return;
  if (grams <= 0) {
    await db.delete(W).where(and(eq(W.tenantId, tenantId), eq(W.sku, key)));
    return;
  }
  await db.insert(W).values({ tenantId, sku: key, grams }).onConflictDoUpdate({ target: [W.tenantId, W.sku], set: { grams, updatedAt: new Date() } });
}

/** Versandgewicht eines Auftrags samt Rechenweg und den beteiligten Artikeln (Wawi-SKU). */
export async function orderShipWeight(tenantId: string, data: NonNullable<Awaited<ReturnType<typeof loadOrder>>>): Promise<ShipWeight & { skus: SkuWeightInfo[] }> {
  const settings = await getSettings(tenantId);
  const keyed = await Promise.all(data.items.map(async (i) => ({ i, key: i.item.sku ? await wawiSku(tenantId, data.order.channel, i.item.sku) : null })));
  const map = await skuWeightMap(tenantId, keyed.map((k) => k.key ?? ""));
  const w = shipWeight(
    keyed.map(({ i, key }) => ({ quantity: i.item.quantity, shipGrams: key ? map.get(key) ?? null : null, productGrams: i.weightGrams ?? null })),
    { defaultGrams: settings.post.itemGrams, packagingGrams: PACKAGING_GRAMS },
  );
  const skus = new Map<string, SkuWeightInfo>();
  for (const { i, key } of keyed) if (key && !skus.has(key)) skus.set(key, { sku: key, title: i.productTitle ?? i.item.title ?? key, grams: map.get(key) ?? null });
  return { ...w, skus: [...skus.values()] };
}
