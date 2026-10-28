import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { loadOrder } from "@/lib/orders/service";
import { itemNameSql, PACKAGING_GRAMS } from "@/lib/orders/service";
import type { Channel } from "@/db/schema";
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

/**
 * Alle Artikel zum Eintragen: was in den letzten 120 Tagen selbst versendet wurde (FBM, alle Kanäle) und alles,
 * wofür schon ein Gewicht hinterlegt ist. Fehlende zuerst.
 */
export async function weightOverview(tenantId: string): Promise<SkuWeightInfo[]> {
  const recent = await db.execute<{ channel: Channel; sku: string; name: string | null }>(sql`
    select distinct on (o.channel, i.sku) o.channel, i.sku, ${itemNameSql} as name
    from order_items i join orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
    where i.tenant_id = ${tenantId} and o.fulfillment = 'FBM' and i.sku is not null and i.sku <> ''
      and o.order_date > now() - interval '120 days'
    order by o.channel, i.sku, o.order_date desc
    limit 300`);
  const out = new Map<string, SkuWeightInfo>();
  for (const r of recent.rows) {
    const key = await wawiSku(tenantId, r.channel, r.sku);
    if (!out.has(key)) out.set(key, { sku: key, title: r.name ?? key, grams: null });
  }
  const W = schema.skuWeights;
  const stored = await db.select({ sku: W.sku, grams: W.grams }).from(W).where(eq(W.tenantId, tenantId));
  for (const w of stored) out.set(w.sku, { sku: w.sku, title: out.get(w.sku)?.title ?? w.sku, grams: w.grams });
  return [...out.values()].sort((a, b) => Number(a.grams !== null) - Number(b.grams !== null) || a.title.localeCompare(b.title, "de"));
}
