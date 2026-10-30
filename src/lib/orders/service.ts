import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Channel } from "@/db/schema";
import { createDhlLabel, cancelDhlLabel } from "@/lib/integrations/clients/dhl";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { syncSoon, wawiSku } from "@/lib/stock/channel-sync";
import { adjustStock } from "@/lib/stock/sets";
import { untrackedPost } from "./tracking";

export const PACKAGING_GRAMS = 150;

/**
 * Artikelname einer Auftragsposition – gleiche Auflösung in Liste und Detail: Name aus dem Auftrag, sonst
 * Produkt (Charge), Artikelstamm, Wawi-Angebot oder eBay-Tool zur SKU. `i` = Alias von order_items.
 */
export const itemNameSql = sql<string | null>`coalesce(
  nullif(i.title, ''),
  (select p.title from lots l join products p on p.id = l.product_id where l.tenant_id = i.tenant_id and l.sku = i.sku and p.title is not null limit 1),
  (select a.title from articles a where a.tenant_id = i.tenant_id and a.sku = i.sku and a.title is not null limit 1),
  (select li.title from listings li where li.tenant_id = i.tenant_id and (li.sku = i.sku or li.stock_sku = i.sku) and li.title is not null limit 1),
  (select e.title from ebay_listings e where e.tenant_id = i.tenant_id and e.sku = i.sku and e.title is not null limit 1)
)`;

export type OrderItemLine = { q: number; sku: string | null; name: string | null };

export async function storeFile(tenantId: string, name: string, mimeType: string, data: Buffer) {
  const [f] = await db
    .insert(schema.files)
    .values({ tenantId, name, mimeType, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), data })
    .returning({ id: schema.files.id });
  return f.id;
}

export async function loadOrder(tenantId: string, id: string) {
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, tenantId)));
  if (!order) return null;
  const rows = await db
    .select({ item: schema.orderItems, weightGrams: schema.products.weightGrams, productTitle: schema.products.title })
    .from(schema.orderItems)
    .leftJoin(schema.lots, and(eq(schema.lots.tenantId, tenantId), eq(schema.lots.sku, schema.orderItems.sku)))
    .leftJoin(schema.products, eq(schema.products.id, schema.lots.productId))
    .where(and(eq(schema.orderItems.orderId, id), eq(schema.orderItems.tenantId, tenantId)));
  // Mehrere Chargen derselben SKU: Position nur einmal; Name wie in der Liste auflösen.
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.item.id) ? false : (seen.add(r.item.id), true)));
  const names = unique.length
    ? await db.execute<{ id: string; name: string | null }>(sql`select i.id, ${itemNameSql} as name from order_items i where i.tenant_id = ${tenantId} and i.order_id = ${id}`)
    : { rows: [] };
  const nameBy = new Map(names.rows.map((r) => [r.id, r.name]));
  const items = unique.map((r) => ({ ...r, productTitle: nameBy.get(r.item.id) ?? r.productTitle }));
  const parcels = await db.select().from(schema.parcels).where(eq(schema.parcels.orderId, id));
  return { order, items, parcels };
}

/** Gewicht aus den Artikeldaten + Verpackung; null, wenn ein Artikelgewicht fehlt. */
export function estimateWeightKg(items: { item: { quantity: number }; weightGrams: number | null }[]): number | null {
  if (items.length === 0 || items.some((i) => !i.weightGrams)) return null;
  const g = items.reduce((n, i) => n + (i.weightGrams ?? 0) * i.item.quantity, 0) + PACKAGING_GRAMS;
  return Math.round(g) / 1000;
}

export async function createLabel(opts: { tenantId: string; orderId: string; weightKg: number; product: "paket" | "kleinpaket" }) {
  const { tenantId } = opts;
  const settings = await getSettings(tenantId);
  const creds = await getIntegration(tenantId, "dhl");
  if (!creds?.apiKey || !creds.username || !creds.password) throw new Error("DHL ist noch nicht eingerichtet (Anbindungen → DHL).");
  const s = settings.shipper;
  if (!s.name1 || !s.street || !s.zip || !s.city) throw new Error("Absenderadresse fehlt (Einstellungen → Versand).");
  const data = await loadOrder(tenantId, opts.orderId);
  if (!data) throw new Error("Auftrag nicht gefunden.");
  const to = data.order.shipTo;
  if (!to?.name1 || !to.street || !to.zip || !to.city) throw new Error("Lieferadresse unvollständig.");
  const isKlein = opts.product === "kleinpaket";
  const billingNumber = isKlein ? settings.dhl.billingNumberKleinpaket : settings.dhl.billingNumberPaket;
  if (!billingNumber) throw new Error(`Abrechnungsnummer für ${isKlein ? "Kleinpaket" : "Paket"} fehlt (Einstellungen → Versand).`);
  const productCode = isKlein ? settings.dhl.productKleinpaket : "V01PAK";

  try {
    const res = await createDhlLabel({
      creds: { apiKey: creds.apiKey, username: creds.username, password: creds.password },
      sandbox: settings.dhl.sandbox,
      product: productCode,
      billingNumber,
      shipper: s,
      to,
      weightKg: opts.weightKg,
      refNo: data.order.externalId,
      printFormat: settings.dhl.labelFormat,
    });
    const fileId = await storeFile(tenantId, `DHL_${res.shipmentNo}.pdf`, "application/pdf", res.labelPdf);
    await db.insert(schema.parcels).values({ tenantId, orderId: opts.orderId, product: productCode, weightKg: String(opts.weightKg), trackingNumber: res.shipmentNo, labelFileId: fileId, status: "created" });
    await db
      .update(schema.orders)
      .set({ status: "label_created", carrier: "DHL", trackingNumber: res.shipmentNo, updatedAt: new Date() })
      .where(eq(schema.orders.id, opts.orderId));
    return { trackingNumber: res.shipmentNo, fileId, warnings: res.warnings, sandbox: settings.dhl.sandbox };
  } catch (e) {
    await db.insert(schema.parcels).values({ tenantId, orderId: opts.orderId, product: productCode, weightKg: String(opts.weightKg), status: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function cancelLabel(tenantId: string, parcelId: string) {
  const [p] = await db.select().from(schema.parcels).where(and(eq(schema.parcels.id, parcelId), eq(schema.parcels.tenantId, tenantId)));
  if (!p || p.status !== "created") return;
  // Warensendung (Deutsche Post): kein Storno bei DHL – Label verwerfen, Auftrag wieder offen. Das Porto
  // erstattet die Post nur auf Antrag (Portokasse); darauf weist die Auftragsseite hin.
  if (p.carrier !== "DHL") {
    await db.update(schema.parcels).set({ status: "cancelled" }).where(eq(schema.parcels.id, parcelId));
    if (p.orderId) {
      await db
        .update(schema.orders)
        .set({ status: "open", trackingNumber: null, carrier: null, updatedAt: new Date() })
        .where(and(eq(schema.orders.id, p.orderId), eq(schema.orders.tenantId, tenantId), eq(schema.orders.status, "label_created"), eq(schema.orders.carrier, p.carrier)));
    }
    return;
  }
  if (!p.trackingNumber) return;
  const settings = await getSettings(tenantId);
  const creds = await getIntegration(tenantId, "dhl");
  if (creds?.apiKey) await cancelDhlLabel({ apiKey: creds.apiKey, username: creds.username, password: creds.password }, settings.dhl.sandbox, p.trackingNumber);
  await db.update(schema.parcels).set({ status: "cancelled" }).where(eq(schema.parcels.id, parcelId));
  if (p.orderId) {
    await db
      .update(schema.orders)
      .set({ status: "open", trackingNumber: null, carrier: null, updatedAt: new Date() })
      .where(and(eq(schema.orders.id, p.orderId), eq(schema.orders.trackingNumber, p.trackingNumber)));
  }
}

// --- Sendungsnummer an den Verkaufskanal melden ---------------------------------------

type TrackingUploader = (tenantId: string, order: typeof schema.orders.$inferSelect, items: (typeof schema.orderItems.$inferSelect)[]) => Promise<void>;
const uploaders = new Map<Channel, TrackingUploader>();
export function registerTrackingUploader(channel: Channel, fn: TrackingUploader) {
  uploaders.set(channel, fn);
}

export async function markShipped(tenantId: string, orderId: string, userId: string | null, tracking?: { carrier?: string; trackingNumber?: string }) {
  const data = await loadOrder(tenantId, orderId);
  if (!data) return;
  const alreadyShipped = data.order.status === "shipped";
  await db
    .update(schema.orders)
    .set({
      status: "shipped",
      shippedAt: data.order.shippedAt ?? new Date(),
      ...(tracking?.trackingNumber ? { trackingNumber: tracking.trackingNumber, carrier: tracking.carrier ?? "DHL" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.orders.id, orderId));

  // Eigenes Lager abbuchen (nur einmal) – auf die Wawi-SKU, auch wenn der Kanal eine eigene SKU führt.
  // Verschickt das Prep Center, kommt die Ware aus dessen Bestand – nicht vom eigenen Lager (B15.3).
  if (!alreadyShipped && data.order.fulfillment === "FBM" && data.order.shippedBy !== "prep") {
    const touched: string[] = [];
    for (const { item } of data.items) {
      if (!item.sku) continue;
      const sku = await wawiSku(tenantId, data.order.channel, item.sku);
      // Ein Set (Komplettset) bucht seine Bestandteile ab.
      touched.push(...(await adjustStock(tenantId, sku, -item.quantity, "Versand", `${data.order.channel} ${data.order.externalId}`, userId)));
    }
    // Lager und Reservierung sinken gleich – verfügbar bleibt; trotzdem abgleichen (Korrekturen, Mehrfach-Positionen).
    syncSoon(tenantId, touched);
  }
  await uploadTracking(tenantId, orderId);
}

export async function uploadTracking(tenantId: string, orderId: string) {
  await import("@/lib/integrations/clients");
  const data = await loadOrder(tenantId, orderId);
  // Ohne Sendungsnummer nur die Warensendung bei Amazon melden (Deutsche Post, keine Sendungsverfolgung).
  if (!data || (!data.order.trackingNumber && !untrackedPost(data.order))) return;
  const fn = uploaders.get(data.order.channel);
  if (!fn) {
    await db.update(schema.orders).set({ trackingUploadError: "Keine Schnittstelle – bitte manuell im Kanal eintragen oder per Datei melden." }).where(eq(schema.orders.id, orderId));
    return;
  }
  try {
    await fn(tenantId, data.order, data.items.map((i) => i.item));
    await db.update(schema.orders).set({ trackingUploadedAt: new Date(), trackingUploadError: null }).where(eq(schema.orders.id, orderId));
  } catch (e) {
    await db.update(schema.orders).set({ trackingUploadError: e instanceof Error ? e.message : String(e) }).where(eq(schema.orders.id, orderId));
  }
}

export async function openOrderIds(tenantId: string, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.tenantId, tenantId), inArray(schema.orders.id, ids)));
}


// --- Versender geändert / Prep-Center-Abbuchungen (B15.3) ---------------------------------------------------

const S_M = schema.stockMovements;
const ref = (o: { channel: string; externalId: string }) => `${o.channel} ${o.externalId}`;

/** Netto-Abbuchung vom eigenen Lager je SKU für einen Auftrag (Versand und spätere Korrekturen). */
async function abbuchungJeSku(tenantId: string, reference: string) {
  return db
    .select({ sku: S_M.sku, netto: sql<number>`sum(${S_M.delta})::int` })
    .from(S_M)
    .where(and(eq(S_M.tenantId, tenantId), eq(S_M.reference, reference), sql`${S_M.reason} like 'Versand%'`))
    .groupBy(S_M.sku);
}

/**
 * Versender eines schon versendeten FBM-Auftrags geändert: Prep Center → eigene Abbuchung zurückbuchen; doch selbst →
 * jetzt vom eigenen Lager abbuchen. Nur, was wirklich gebucht ist – doppelt wird nichts.
 */
export async function versenderUmbuchen(tenantId: string, orderId: string, neu: "self" | "prep" | null, userId: string | null) {
  const data = await loadOrder(tenantId, orderId);
  if (!data || data.order.fulfillment !== "FBM" || !["shipped", "delivered"].includes(data.order.status)) return;
  const r = ref(data.order);
  const gebucht = (await abbuchungJeSku(tenantId, r)).filter((x) => x.netto !== 0);
  const touched: string[] = [];
  if (neu === "prep") {
    for (const g of gebucht) if (g.netto < 0) touched.push(...(await adjustStock(tenantId, g.sku, -g.netto, "Versand: Prep Center statt eigenes Lager", r, userId)));
  } else if (!gebucht.length) {
    for (const { item } of data.items) {
      if (!item.sku) continue;
      const sku = await wawiSku(tenantId, data.order.channel, item.sku);
      touched.push(...(await adjustStock(tenantId, sku, -item.quantity, "Versand: doch eigenes Lager", r, userId)));
    }
  }
  if (touched.length) syncSoon(tenantId, touched);
}

/** Reparatur-Vorschlag: Prep-Center-Aufträge, die trotzdem vom eigenen Lager abgebucht haben (alte Buchungen). */
export async function prepAbbuchungen(tenantId: string) {
  const O = schema.orders;
  const rows = await db
    .select({ id: O.id, channel: O.channel, externalId: O.externalId, netto: sql<number>`coalesce((select sum(m.delta) from stock_movements m where m.tenant_id = ${tenantId} and m.reference = ${O.channel} || ' ' || ${O.externalId} and m.reason like 'Versand%'), 0)::int` })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), eq(O.fulfillment, "FBM"), eq(O.shippedBy, "prep"), inArray(O.status, ["shipped", "delivered"])));
  const betroffen = rows.filter((x) => x.netto < 0);
  return { auftraege: betroffen.length, stueck: betroffen.reduce((n, x) => n - x.netto, 0), ids: betroffen.map((x) => x.id) };
}

/** Reparatur anwenden (nur auf ausdrücklichen Klick): eigene Abbuchungen der Prep-Center-Aufträge zurückbuchen. */
export async function prepAbbuchungenZurueck(tenantId: string, userId: string | null): Promise<number> {
  const { ids } = await prepAbbuchungen(tenantId);
  for (const id of ids) await versenderUmbuchen(tenantId, id, "prep", userId);
  return ids.length;
}
