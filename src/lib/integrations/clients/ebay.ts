import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerListingPublisher } from "@/lib/listings/publish";
import { registerTrackingUploader } from "@/lib/orders/service";
import { splitStreet } from "@/lib/shipping/countries";
import { getSettings, getToken } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getUserAccessToken } from "@/lib/ebay/ebay/auth";
import { apiBase, MARKETPLACE } from "@/lib/ebay/ebay/config";
import type { Settings } from "@/lib/ebay/types";
import { registerTester } from "../test";

// eBay REST APIs: Fulfillment (Bestellungen, Sendungsnummer) und Inventory (Artikel einstellen).
// Die Verbindung (App-Schlüssel, Umgebung, Anmeldung) ist dieselbe wie im eBay-Listing-Tool
// (eBay → eBay-Einstellungen → Verbindung).

type Conn = { base: string; token: string; marketplaceId: string; settings: Settings };

/** Verbindung des Mandanten oder null, wenn keine eBay-Anmeldung besteht. */
async function cfg(tenantId: string): Promise<Conn | null> {
  const db = ebayDb(tenantId);
  const settings = await getSettings(db);
  if (!settings.clientId || !settings.clientSecret) return null;
  const stored = await getToken(db, settings.env, "user");
  if (!stored?.refreshToken) return null;
  const token = await getUserAccessToken(db, settings);
  return { base: apiBase(settings.env), token, marketplaceId: MARKETPLACE, settings };
}

/** Besteht eine eBay-Verbindung? (für den Hintergrund-Abruf) */
export async function ebayConnected(tenantId: string): Promise<boolean> {
  const db = ebayDb(tenantId);
  const settings = await getSettings(db);
  return Boolean(settings.clientId && (await getToken(db, settings.env, "user"))?.refreshToken);
}

async function api<T>(c: Conn, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${c.base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json", "Content-Language": "de-DE", "Accept-Language": "de-DE", "X-EBAY-C-MARKETPLACE-ID": c.marketplaceId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (json.errors as { message?: string; longMessage?: string }[] | undefined)?.map((e) => e.longMessage ?? e.message).join("; ");
    if (res.status === 403 || res.status === 401) {
      throw new Error("Die eBay-Verbindung erlaubt das noch nicht (Bestellungen bearbeiten). Bitte unter eBay → eBay-Einstellungen → Verbindung einmal neu verbinden.");
    }
    throw new Error(`eBay ${method} ${path.split("?")[0]} → ${res.status}${msg ? ` (${msg})` : ""}`);
  }
  return json as T;
}

type EbayOrder = {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: string;
  buyer?: { username?: string };
  pricingSummary?: { total?: { value: string; currency: string } };
  fulfillmentStartInstructions?: { shippingStep?: { shipTo?: { fullName?: string; contactAddress?: { addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string; countryCode?: string }; primaryPhone?: { phoneNumber?: string }; email?: string } } }[];
  lineItems: { lineItemId: string; sku?: string; title?: string; quantity: number; lineItemCost?: { value: string } }[];
};

export async function syncEbayOrders(tenantId: string) {
  const c = await cfg(tenantId);
  if (!c) return { orders: 0 };
  const r = await api<{ orders: EbayOrder[] }>(c, "GET", `/sell/fulfillment/v1/order?filter=${encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}")}&limit=100`);
  let count = 0;
  for (const o of r.orders ?? []) {
    const st = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const a = st?.contactAddress ?? {};
    const { street, houseNo } = splitStreet(a.addressLine1 ?? "");
    const shipTo = { name1: st?.fullName, name2: a.addressLine2 || undefined, street, houseNo, zip: a.postalCode, city: a.city, country: a.countryCode ?? "DE", phone: st?.primaryPhone?.phoneNumber, email: st?.email };
    const [row] = await db
      .insert(schema.orders)
      .values({ tenantId, channel: "ebay", externalId: o.orderId, orderDate: new Date(o.creationDate), fulfillment: "FBM", status: "open", externalStatus: o.orderFulfillmentStatus, buyerName: st?.fullName ?? o.buyer?.username ?? null, shipTo, total: o.pricingSummary?.total ? Number(o.pricingSummary.total.value) : null })
      .onConflictDoUpdate({ target: [schema.orders.tenantId, schema.orders.channel, schema.orders.externalId], set: { externalStatus: sql`excluded.external_status`, shipTo: sql`excluded.ship_to`, updatedAt: sql`now()` } })
      .returning({ id: schema.orders.id, inserted: sql<boolean>`(xmax = 0)` });
    await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, row.id));
    await db.insert(schema.orderItems).values(o.lineItems.map((i) => ({ tenantId, orderId: row.id, externalItemId: i.lineItemId, sku: i.sku ?? null, title: i.title ?? null, quantity: i.quantity, price: i.lineItemCost ? Number(i.lineItemCost.value) / Math.max(1, i.quantity) : null })));
    if (row.inserted) count++;
  }
  return { orders: count };
}

registerTrackingUploader("ebay", async (tenantId, order, items) => {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen) – Sendungsnummer bitte in eBay eintragen.");
  await api(c, "POST", `/sell/fulfillment/v1/order/${encodeURIComponent(order.externalId)}/shipping_fulfillment`, {
    lineItems: items.filter((i) => i.externalItemId).map((i) => ({ lineItemId: i.externalItemId, quantity: i.quantity })),
    shippedDate: (order.shippedAt ?? new Date()).toISOString(),
    shippingCarrierCode: order.carrier ?? "DHL",
    trackingNumber: order.trackingNumber,
  });
});

registerListingPublisher("ebay", async (tenantId, l) => {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden.");
  const p = l.payload as { categoryId?: string; imageUrls?: string[] };
  if (!p.categoryId) throw new Error("eBay-Kategorie-ID fehlt (im Listing eintragen).");
  if (!p.imageUrls?.length) throw new Error("Mindestens ein Bild-Link ist nötig.");
  const st = c.settings;
  if (!st.fulfillmentPolicyId || !st.paymentPolicyId || !st.returnPolicyId || !st.merchantLocationKey) throw new Error("Verkaufsprofile und Artikelstandort fehlen (eBay → eBay-Einstellungen → Verkauf).");
  const sku = encodeURIComponent(l.sku);
  await api(c, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: l.quantity } },
    condition: l.condition,
    product: { title: l.title, description: l.description ?? l.title, imageUrls: p.imageUrls, ...(l.ean ? { ean: [l.ean] } : {}) },
  });
  const offers = await api<{ offers?: { offerId: string }[] }>(c, "GET", `/sell/inventory/v1/offer?sku=${sku}`).catch(() => ({ offers: [] as { offerId: string }[] }));
  const offer = {
    sku: l.sku,
    marketplaceId: c.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: l.quantity,
    categoryId: p.categoryId,
    listingDescription: l.description ?? l.title,
    listingPolicies: { fulfillmentPolicyId: st.fulfillmentPolicyId, paymentPolicyId: st.paymentPolicyId, returnPolicyId: st.returnPolicyId },
    pricingSummary: { price: { value: (l.price ?? 0).toFixed(2), currency: "EUR" } },
    merchantLocationKey: st.merchantLocationKey,
  };
  let offerId = offers.offers?.[0]?.offerId;
  if (offerId) await api(c, "PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
  else offerId = (await api<{ offerId: string }>(c, "POST", "/sell/inventory/v1/offer", offer)).offerId;
  const pub = await api<{ listingId: string }>(c, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  return { externalId: pub.listingId };
});

registerTester("ebay", async (_v, tenantId) => {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist noch nicht verbunden – unter eBay → eBay-Einstellungen → Verbindung einrichten.");
  const r = await api<{ total?: number }>(c, "GET", `/sell/fulfillment/v1/order?limit=1`);
  return `Verbunden (${r.total ?? 0} Bestellungen abrufbar).`;
});
