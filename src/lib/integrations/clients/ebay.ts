import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerListingPublisher } from "@/lib/listings/publish";
import { registerTrackingUploader } from "@/lib/orders/service";
import { splitStreet } from "@/lib/shipping/countries";
import { getIntegration } from "../store";
import { registerTester } from "../test";

// eBay REST APIs: Fulfillment (Bestellungen, Sendungsnummer) und Inventory (Artikel einstellen).

const SCOPES = ["https://api.ebay.com/oauth/api_scope", "https://api.ebay.com/oauth/api_scope/sell.fulfillment", "https://api.ebay.com/oauth/api_scope/sell.inventory", "https://api.ebay.com/oauth/api_scope/sell.account"];
const cache = new Map<string, { token: string; until: number }>();

type Cfg = Record<string, string>;
const base = (c: Cfg) => (c.environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com");

async function token(c: Cfg) {
  const key = `${c.clientId}:${(c.refreshToken ?? "").slice(-10)}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const res = await fetch(`${base(c)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refreshToken, scope: SCOPES.join(" ") }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!j.access_token) throw new Error(`eBay-Anmeldung fehlgeschlagen: ${j.error_description ?? j.error ?? res.status}`);
  cache.set(key, { token: j.access_token, until: Date.now() + ((j.expires_in ?? 7200) - 300) * 1000 });
  return j.access_token;
}

async function api<T>(c: Cfg, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base(c)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(c)}`, "Content-Type": "application/json", "Content-Language": "de-DE", "Accept-Language": "de-DE", "X-EBAY-C-MARKETPLACE-ID": c.marketplaceId || "EBAY_DE" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (json.errors as { message?: string; longMessage?: string }[] | undefined)?.map((e) => e.longMessage ?? e.message).join("; ");
    throw new Error(`eBay ${method} ${path.split("?")[0]} → ${res.status}${msg ? ` (${msg})` : ""}`);
  }
  return json as T;
}

async function cfg(tenantId: string) {
  const c = await getIntegration(tenantId, "ebay");
  return c?.clientId && c.clientSecret && c.refreshToken ? c : null;
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
  if (!c) throw new Error("eBay ist nicht verbunden – Sendungsnummer bitte in eBay eintragen.");
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
  if (!c.fulfillmentPolicyId || !c.paymentPolicyId || !c.returnPolicyId || !c.merchantLocationKey) throw new Error("Richtlinien-IDs und Artikelstandort fehlen (Anbindungen → eBay).");
  const sku = encodeURIComponent(l.sku);
  await api(c, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: l.quantity } },
    condition: l.condition,
    product: { title: l.title, description: l.description ?? l.title, imageUrls: p.imageUrls, ...(l.ean ? { ean: [l.ean] } : {}) },
  });
  const offers = await api<{ offers?: { offerId: string }[] }>(c, "GET", `/sell/inventory/v1/offer?sku=${sku}`).catch(() => ({ offers: [] as { offerId: string }[] }));
  const offer = {
    sku: l.sku,
    marketplaceId: c.marketplaceId || "EBAY_DE",
    format: "FIXED_PRICE",
    availableQuantity: l.quantity,
    categoryId: p.categoryId,
    listingDescription: l.description ?? l.title,
    listingPolicies: { fulfillmentPolicyId: c.fulfillmentPolicyId, paymentPolicyId: c.paymentPolicyId, returnPolicyId: c.returnPolicyId },
    pricingSummary: { price: { value: (l.price ?? 0).toFixed(2), currency: "EUR" } },
    merchantLocationKey: c.merchantLocationKey,
  };
  let offerId = offers.offers?.[0]?.offerId;
  if (offerId) await api(c, "PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
  else offerId = (await api<{ offerId: string }>(c, "POST", "/sell/inventory/v1/offer", offer)).offerId;
  const pub = await api<{ listingId: string }>(c, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  return { externalId: pub.listingId };
});

registerTester("ebay", async (_v, tenantId) => {
  const c = await cfg(tenantId);
  if (!c) throw new Error("App-ID, Cert-ID und Refresh-Token angeben.");
  const r = await api<{ total?: number }>(c, "GET", `/sell/fulfillment/v1/order?limit=1`);
  return `Verbunden (${r.total ?? 0} Bestellungen abrufbar).`;
});
