import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerListingPublisher } from "@/lib/listings/publish";
import { registerTrackingUploader } from "@/lib/orders/service";
import { ManualStockError, registerStockPusher } from "@/lib/stock/channel-sync";
import { splitStreet } from "@/lib/shipping/countries";
import { getSettings, getToken } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getUserAccessToken, listingGranted } from "@/lib/ebay/ebay/auth";
import { apiBase, graphqlUrl, MARKETPLACE } from "@/lib/ebay/ebay/config";
import { bulkUpdateInventory, fetchActiveListings, fetchListing, type GqlConn } from "@/lib/ebay/listing-api";
import { activeFromListing, legacyFromListing } from "@/lib/ebay/listing-map";
import { withModern } from "@/lib/ebay/modern";
import type { Settings } from "@/lib/ebay/types";
import { activeItems, escXml, inventoryStatusXml, isInventoryManagedError, legacyItem, matchSpecifics, tradingBody, type EbayActiveItem, type LegacyItem } from "@/lib/ebay/trading-map";
import type { XmlObject } from "@/lib/xml";
import { registerTester } from "../test";

// eBay REST APIs: Fulfillment (Bestellungen, Sendungsnummer) und Inventory (Artikel einstellen).
// Die Verbindung (App-Schlüssel, Umgebung, Anmeldung) ist dieselbe wie im eBay-Listing-Tool
// (eBay → eBay-Einstellungen → Verbindung).

type Conn = { tenantId: string; base: string; token: string; marketplaceId: string; settings: Settings; listingOk: boolean | null };

/** Verbindung des Mandanten oder null, wenn keine eBay-Anmeldung besteht. */
async function cfg(tenantId: string): Promise<Conn | null> {
  const db = ebayDb(tenantId);
  const settings = await getSettings(db);
  if (!settings.clientId || !settings.clientSecret) return null;
  const stored = await getToken(db, settings.env, "user");
  if (!stored?.refreshToken) return null;
  const token = await getUserAccessToken(db, settings);
  return { tenantId, base: apiBase(settings.env), token, marketplaceId: MARKETPLACE, settings, listingOk: listingGranted(settings, stored.refreshToken) };
}

/** Neue Listing-API (GraphQL) mit demselben Token. */
const gqlConn = (c: Conn): GqlConn => ({ url: graphqlUrl(c.settings.env), token: c.token, marketplaceId: c.marketplaceId });

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
  /** Gesamte eBay-Gebühren der Bestellung (Verkaufsprovision u. a.). */
  totalMarketplaceFee?: { value: string; currency: string };
  fulfillmentStartInstructions?: { shippingStep?: { shipTo?: { fullName?: string; contactAddress?: { addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string; countryCode?: string }; primaryPhone?: { phoneNumber?: string }; email?: string } } }[];
  lineItems: { lineItemId: string; sku?: string; legacyItemId?: string; variationAspects?: { name?: string; value?: string }[]; title?: string; quantity: number; lineItemCost?: { value: string } }[];
};

/** Ältere eBay-Angebote (Trading API) ohne SKU: Position über Artikelnummer und Variantenmerkmale der Wawi-SKU zuordnen. */
async function legacySkus(tenantId: string, orders: EbayOrder[]) {
  const ids = [...new Set(orders.flatMap((o) => o.lineItems.filter((i) => !i.sku && i.legacyItemId).map((i) => i.legacyItemId!)))];
  if (!ids.length) return () => null;
  const L = schema.listings;
  const rows = await db
    .select({ sku: L.sku, externalId: L.externalId, payload: L.payload })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), inArray(L.externalId, ids), sql`${L.payload}->>'trading' = 'true'`));
  return (i: EbayOrder["lineItems"][number]) => {
    const hits = rows.filter((r) => r.externalId === i.legacyItemId);
    const hit = hits.length === 1 && !(hits[0].payload.specifics as unknown[] | undefined)?.length ? hits[0] : hits.find((r) => matchSpecifics((r.payload.specifics as { name: string; value: string }[]) ?? [], i.variationAspects ?? []));
    return hit?.sku ?? null;
  };
}

/** eBay-Gebühren der Bestellung, falls geliefert – sonst bleibt das Feld leer („fehlt“, nie 0 €). */
export function ebayFee(o: Pick<EbayOrder, "totalMarketplaceFee">): { fees: number; feesSource: string } | Record<string, never> {
  const v = o.totalMarketplaceFee ? Number(o.totalMarketplaceFee.value) : NaN;
  return Number.isFinite(v) ? { fees: Math.abs(v), feesSource: "api" } : {};
}

export async function syncEbayOrders(tenantId: string) {
  const c = await cfg(tenantId);
  if (!c) return { orders: 0 };
  const r = await api<{ orders: EbayOrder[] }>(c, "GET", `/sell/fulfillment/v1/order?filter=${encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}")}&limit=100`);
  let count = 0;
  const legacy = await legacySkus(tenantId, r.orders ?? []);
  for (const o of r.orders ?? []) {
    const st = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const a = st?.contactAddress ?? {};
    const { street, houseNo } = splitStreet(a.addressLine1 ?? "");
    const shipTo = { name1: st?.fullName, name2: a.addressLine2 || undefined, street, houseNo, zip: a.postalCode, city: a.city, country: a.countryCode ?? "DE", phone: st?.primaryPhone?.phoneNumber, email: st?.email };
    const [row] = await db
      .insert(schema.orders)
      .values({ tenantId, channel: "ebay", externalId: o.orderId, orderDate: new Date(o.creationDate), fulfillment: "FBM", status: "open", externalStatus: o.orderFulfillmentStatus, buyerName: st?.fullName ?? o.buyer?.username ?? null, shipTo, total: o.pricingSummary?.total ? Number(o.pricingSummary.total.value) : null, ...ebayFee(o) })
      .onConflictDoUpdate({
        target: [schema.orders.tenantId, schema.orders.channel, schema.orders.externalId],
        // Gebühr nur ergänzen, nie eine von Hand eingetragene überschreiben.
        set: { externalStatus: sql`excluded.external_status`, shipTo: sql`excluded.ship_to`, fees: sql`coalesce(${schema.orders.fees}, excluded.fees)`, feesSource: sql`coalesce(${schema.orders.feesSource}, excluded.fees_source)`, updatedAt: sql`now()` },
      })
      .returning({ id: schema.orders.id, inserted: sql<boolean>`(xmax = 0)` });
    await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, row.id));
    await db.insert(schema.orderItems).values(o.lineItems.map((i) => ({ tenantId, orderId: row.id, externalItemId: i.lineItemId, sku: i.sku || legacy(i), title: i.title ?? null, quantity: i.quantity, price: i.lineItemCost ? Number(i.lineItemCost.value) / Math.max(1, i.quantity) : null })));
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

/**
 * Menge eines Angebots setzen (Bestandsabgleich der Wawi). Inventory-API-Angebote: Bestand des
 * Artikels und – falls bekannt – die Angebotsmenge in einem Aufruf.
 */
registerStockPusher("ebay", async (tenantId, l, quantity) => {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden.");
  const payload = (l.payload ?? {}) as { offerId?: string } & LegacyPayload;
  // Älteres Angebot (nicht übers eBay-Tool): Menge über die Trading API.
  if (payload.trading && payload.itemId) {
    const variation = Boolean(payload.specifics?.length);
    if (variation && !payload.ebaySku) throw new ManualStockError("Variante ohne SKU bei eBay – bei eBay je Variante eine SKU eintragen, dann geht es automatisch");
    const itemId = payload.itemId;
    const ebaySku = variation ? payload.ebaySku : null;
    await withModern(
      tenantId,
      "Menge setzen",
      () => bulkUpdateInventory(gqlConn(c), [{ listingId: itemId, sku: ebaySku, availableQuantity: quantity }]),
      async () => {
        try {
          await trading(c, "ReviseInventoryStatus", inventoryStatusXml(itemId, quantity, ebaySku));
        } catch (e) {
          // Angebot aus einem anderen Programm über die Inventory API: Menge dort setzen (per SKU). Erkannt an
          // eBays Meldung/Fehlernummer oder daran, dass eBay zu genau diesem Angebot ein Offer führt.
          if (!payload.ebaySku) throw e;
          if (!isInventoryManagedError(e) && !(await inventoryOfferId(c, payload.ebaySku, itemId))) throw e;
          await pushInventoryQuantity(c, payload.ebaySku, quantity, null, itemId);
        }
      },
      c.listingOk,
    );
    return;
  }
  const offerId = await pushInventoryQuantity(c, l.sku, quantity, payload.offerId ?? null);
  return offerId && offerId !== payload.offerId ? { payload: { offerId } } : undefined;
});

/** Offer-Nummer, wenn eBay das Angebot `listingId` in der Inventory API unter dieser SKU führt – sonst null. */
async function inventoryOfferId(c: Conn, sku: string, listingId: string): Promise<string | null> {
  const r = await api<{ offers?: { offerId: string; listing?: { listingId?: string } }[] }>(c, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`).catch(() => null);
  return r?.offers?.find((o) => o.listing?.listingId === listingId)?.offerId ?? null;
}

/**
 * Menge über die Inventory API: Bestand des Artikels und – falls bekannt – die Angebotsmenge in einem Aufruf.
 * Ohne Angebotsnummer wird sie per SKU gesucht (bei `listingId` das Angebot genau dieses eBay-Angebots).
 */
async function pushInventoryQuantity(c: Conn, sku: string, quantity: number, knownOfferId: string | null, listingId?: string): Promise<string | undefined> {
  let offerId = knownOfferId ?? undefined;
  if (!offerId) {
    const r = await api<{ offers?: { offerId: string; listing?: { listingId?: string } }[] }>(c, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`).catch(() => null);
    const offers = r?.offers ?? [];
    offerId = (listingId ? offers.find((o) => o.listing?.listingId === listingId) : undefined)?.offerId ?? offers[0]?.offerId;
  }
  const res = await api<{ responses?: { statusCode: number; sku?: string; offerId?: string; errors?: { message?: string; longMessage?: string }[] }[] }>(c, "POST", "/sell/inventory/v1/bulk_update_price_quantity", {
    requests: [{ sku, shipToLocationAvailability: { quantity }, ...(offerId ? { offers: [{ offerId, availableQuantity: quantity }] } : {}) }],
  });
  const bad = (res.responses ?? []).find((r) => r.statusCode >= 300);
  if (bad) throw new Error((bad.errors ?? []).map((e) => e.longMessage ?? e.message).filter(Boolean).join("; ") || `eBay-Status ${bad.statusCode}`);
  return offerId;
}

/**
 * Was eBay gerade für eine SKU anbietet – nach allen Verkäufen (eBay zieht verkaufte Stück
 * selbst ab): Bestand des Inventory-Artikels, sonst die Angebotsmenge.
 */
export async function ebayQuantity(tenantId: string, sku: string): Promise<number> {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen → Verbindung).");
  const L = schema.listings;
  const [own] = await db.select({ payload: L.payload }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay"), eq(L.sku, sku)));
  const lp = (own?.payload ?? {}) as LegacyPayload;
  if (lp.trading && lp.itemId) {
    const item = await getLegacyItem(c, lp.itemId);
    const hit = item.skus.find((k) => k.sku === sku) ?? item.skus.find((k) => lp.specifics?.length && matchSpecifics(lp.specifics, k.specifics));
    if (!hit) throw new Error(`eBay-Angebot ${lp.itemId}: Variante zu ${sku} nicht mehr gefunden.`);
    return hit.quantity;
  }
  const s = encodeURIComponent(sku);
  try {
    const item = await api<{ availability?: { shipToLocationAvailability?: { quantity?: number } } }>(c, "GET", `/sell/inventory/v1/inventory_item/${s}`);
    const q = item.availability?.shipToLocationAvailability?.quantity;
    if (typeof q === "number") return Math.max(0, q);
  } catch (e) {
    if (!/→ 404/.test(e instanceof Error ? e.message : "")) throw e;
    throw new Error("eBay kennt die SKU nicht (nicht übers eBay-Tool eingestellt) – Bestand bitte von Hand eintragen.");
  }
  const r = await api<{ offers?: { availableQuantity?: number }[] }>(c, "GET", `/sell/inventory/v1/offer?sku=${s}`);
  const q = r.offers?.find((o) => typeof o.availableQuantity === "number")?.availableQuantity;
  if (typeof q !== "number") throw new Error(`eBay nennt für ${sku} keine Menge.`);
  return Math.max(0, q);
}

// ---- Ältere Angebote: neue Listing-API, Rückfall Trading API ----------------------------------

/** Am Wawi-Angebot gemerkt: Artikelnummer, SKU bei eBay (falls vergeben), Variantenmerkmale. */
export type LegacyPayload = { trading?: boolean; itemId?: string; ebaySku?: string | null; specifics?: { name: string; value: string }[] };

async function trading(c: Conn, call: string, inner: string): Promise<XmlObject> {
  const res = await fetch(`${c.base}/ws/api.dll`, {
    method: "POST",
    headers: {
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": "77",
      "X-EBAY-API-IAF-TOKEN": c.token,
      "Content-Type": "text/xml; charset=utf-8",
    },
    body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${inner}</${call}Request>`,
  });
  const text = await res.text();
  if (!res.ok && !text.includes(`${call}Response`)) throw new Error(`eBay ${call} → HTTP ${res.status}`);
  return tradingBody(text, call);
}

async function getLegacyItem(c: Conn, itemId: string): Promise<LegacyItem> {
  return withModern(
    c.tenantId,
    "Angebot lesen",
    async () => legacyFromListing(await fetchListing(gqlConn(c), itemId)),
    async () => legacyItem(await trading(c, "GetItem", `<ItemID>${escXml(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`)),
    c.listingOk,
  );
}

/** Alle laufenden Angebote des eBay-Kontos – auch die nicht übers eBay-Tool eingestellten. */
export async function ebayActiveItems(tenantId: string): Promise<EbayActiveItem[]> {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen → Verbindung).");
  return withModern(
    tenantId,
    "Angebotsliste",
    async () => (await fetchActiveListings(gqlConn(c))).map(activeFromListing).filter((i) => i.itemId),
    async () => {
      const out: EbayActiveItem[] = [];
      for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
        const body = await trading(c, "GetMyeBaySelling", `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><DetailLevel>ReturnAll</DetailLevel>`);
        const r = activeItems(body);
        pages = r.pages;
        out.push(...r.items);
      }
      return out;
    },
    c.listingOk,
  );
}

/** Ein eBay-Angebot mit allen Angaben (Beschreibung, Bilder, Merkmale, Varianten, EAN). */
export async function ebayLegacyItem(tenantId: string, itemId: string): Promise<LegacyItem> {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen → Verbindung).");
  return getLegacyItem(c, itemId);
}

registerTester("ebay", async (_v, tenantId) => {
  const c = await cfg(tenantId);
  if (!c) throw new Error("eBay ist noch nicht verbunden – unter eBay → eBay-Einstellungen → Verbindung einrichten.");
  const r = await api<{ total?: number }>(c, "GET", `/sell/fulfillment/v1/order?limit=1`);
  return `Verbunden (${r.total ?? 0} Bestellungen abrufbar).`;
});
