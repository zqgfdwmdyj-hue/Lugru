import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Channel } from "@/db/schema";
import { createDhlLabel, cancelDhlLabel } from "@/lib/integrations/clients/dhl";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";

export const PACKAGING_GRAMS = 150;

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
  const items = await db
    .select({ item: schema.orderItems, weightGrams: schema.products.weightGrams, productTitle: schema.products.title })
    .from(schema.orderItems)
    .leftJoin(schema.lots, and(eq(schema.lots.tenantId, tenantId), eq(schema.lots.sku, schema.orderItems.sku)))
    .leftJoin(schema.products, eq(schema.products.id, schema.lots.productId))
    .where(eq(schema.orderItems.orderId, id));
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
  if (!p?.trackingNumber || p.status !== "created") return;
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

  // Eigenes Lager abbuchen (nur einmal)
  if (!alreadyShipped && data.order.fulfillment === "FBM") {
    for (const { item } of data.items) {
      if (!item.sku) continue;
      await db
        .insert(schema.ownStock)
        .values({ tenantId, sku: item.sku, quantity: -item.quantity })
        .onConflictDoUpdate({ target: [schema.ownStock.tenantId, schema.ownStock.sku], set: { quantity: sql`${schema.ownStock.quantity} - ${item.quantity}`, updatedAt: new Date() } });
      await db.insert(schema.stockMovements).values({ tenantId, sku: item.sku, delta: -item.quantity, reason: "Versand", reference: `${data.order.channel} ${data.order.externalId}`, userId });
    }
  }
  await uploadTracking(tenantId, orderId);
}

export async function uploadTracking(tenantId: string, orderId: string) {
  await import("@/lib/integrations/clients");
  const data = await loadOrder(tenantId, orderId);
  if (!data?.order.trackingNumber) return;
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
