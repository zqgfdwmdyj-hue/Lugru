import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { loadOrder } from "@/lib/orders/service";
import { itemNameSql, PACKAGING_GRAMS } from "@/lib/orders/service";
import type { Channel } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { wawiSku } from "@/lib/stock/channel-sync";
import { shipWeight, type ShipWeight } from "./weight";
import type { WsItem } from "./warensendung";

// Versandangaben je Artikel (Wawi-SKU) speichern und für Aufträge aller Kanäle verwenden: Gewicht je Stück und
// wie viele Stück in eine Warensendung passen.

export type SkuWeightInfo = { sku: string; title: string; grams: number | null; wsMax: number | null };
export type SkuShipping = { grams: number | null; wsMax: number | null };

export async function skuShippingMap(tenantId: string, skus: string[]): Promise<Map<string, SkuShipping>> {
  const list = [...new Set(skus.filter(Boolean))];
  if (!list.length) return new Map();
  const W = schema.skuWeights;
  const rows = await db.select({ sku: W.sku, grams: W.grams, wsMax: W.wsMax }).from(W).where(and(eq(W.tenantId, tenantId), inArray(W.sku, list)));
  return new Map(rows.map((r) => [r.sku, { grams: r.grams, wsMax: r.wsMax }]));
}

/** Nur Gewichte (für Stellen, die nur das Gewicht brauchen). */
export async function skuWeightMap(tenantId: string, skus: string[]): Promise<Map<string, number>> {
  const m = await skuShippingMap(tenantId, skus);
  return new Map([...m].filter(([, v]) => v.grams !== null).map(([k, v]) => [k, v.grams as number]));
}

/**
 * Versandangaben setzen – nur die übergebenen Felder (undefined = unverändert, null/0 g = löschen). Sind danach
 * beide leer, verschwindet der Eintrag (dann gelten Artikeldaten bzw. Schätzwert und „nicht festgelegt“).
 */
export async function saveSkuShipping(tenantId: string, sku: string, patch: { grams?: number | null; wsMax?: number | null }) {
  const W = schema.skuWeights;
  const key = sku.trim().slice(0, 120);
  if (!key) return;
  const [cur] = await db.select({ grams: W.grams, wsMax: W.wsMax }).from(W).where(and(eq(W.tenantId, tenantId), eq(W.sku, key)));
  const grams = patch.grams === undefined ? cur?.grams ?? null : patch.grams && patch.grams > 0 ? patch.grams : null;
  const wsMax = patch.wsMax === undefined ? cur?.wsMax ?? null : patch.wsMax;
  if (grams === null && wsMax === null) {
    await db.delete(W).where(and(eq(W.tenantId, tenantId), eq(W.sku, key)));
    return;
  }
  await db.insert(W).values({ tenantId, sku: key, grams, wsMax }).onConflictDoUpdate({ target: [W.tenantId, W.sku], set: { grams, wsMax, updatedAt: new Date() } });
}

/** Nur das Gewicht setzen (0 = löschen). */
export async function saveSkuWeight(tenantId: string, sku: string, grams: number) {
  await saveSkuShipping(tenantId, sku, { grams: grams > 0 ? grams : null });
}

/** Versandgewicht eines Auftrags samt Rechenweg und den beteiligten Artikeln (Wawi-SKU). */
export async function orderShipWeight(tenantId: string, data: NonNullable<Awaited<ReturnType<typeof loadOrder>>>): Promise<ShipWeight & { skus: SkuWeightInfo[]; items: WsItem[] }> {
  const settings = await getSettings(tenantId);
  const keyed = await Promise.all(data.items.map(async (i) => ({ i, key: i.item.sku ? await wawiSku(tenantId, data.order.channel, i.item.sku) : null })));
  const map = await skuShippingMap(tenantId, keyed.map((k) => k.key ?? ""));
  const w = shipWeight(
    keyed.map(({ i, key }) => ({ quantity: i.item.quantity, shipGrams: key ? map.get(key)?.grams ?? null : null, productGrams: i.weightGrams ?? null })),
    { defaultGrams: settings.post.itemGrams, packagingGrams: PACKAGING_GRAMS },
  );
  const title = (i: (typeof keyed)[number]["i"], key: string | null) => i.productTitle ?? i.item.title ?? key ?? i.item.sku ?? "Artikel";
  const skus = new Map<string, SkuWeightInfo>();
  for (const { i, key } of keyed) if (key && !skus.has(key)) skus.set(key, { sku: key, title: title(i, key), grams: map.get(key)?.grams ?? null, wsMax: map.get(key)?.wsMax ?? null });
  // Für die Warensendung-Prüfung: je Position Stück und „passt bis“ (ohne SKU: nicht festgelegt).
  const items: WsItem[] = keyed.map(({ i, key }) => ({ quantity: i.item.quantity, title: title(i, key), wsMax: key ? map.get(key)?.wsMax ?? null : null }));
  return { ...w, skus: [...skus.values()], items };
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
    if (!out.has(key)) out.set(key, { sku: key, title: r.name ?? key, grams: null, wsMax: null });
  }
  const W = schema.skuWeights;
  const stored = await db.select({ sku: W.sku, grams: W.grams, wsMax: W.wsMax }).from(W).where(eq(W.tenantId, tenantId));
  for (const w of stored) out.set(w.sku, { sku: w.sku, title: out.get(w.sku)?.title ?? w.sku, grams: w.grams, wsMax: w.wsMax });
  const done = (x: SkuWeightInfo) => Number(x.grams !== null) + Number(x.wsMax !== null);
  return [...out.values()].sort((a, b) => done(a) - done(b) || a.title.localeCompare(b.title, "de"));
}
