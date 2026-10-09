import "server-only";
import { gunzipSync } from "node:zlib";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReportKind } from "@/lib/reports/amazon";
import { applyReport, mapAmazonStatus } from "@/lib/reports/apply";
import { readTable } from "@/lib/tabular";
import { splitStreet } from "@/lib/shipping/countries";
import { registerStockPusher } from "@/lib/stock/channel-sync";
import { registerTrackingUploader } from "@/lib/orders/service";
import { getIntegration } from "../store";
import { registerTester } from "../test";

// Amazon Selling Partner API (Europa). Seit 2023 genügt das LWA-Token, keine AWS-Signatur.

const ENDPOINT = () => (process.env.AMAZON_SP_BASE_URL || "https://sellingpartnerapi-eu.amazon.com").replace(/\/$/, "");
const LWA_URL = () => process.env.AMAZON_LWA_URL || "https://api.amazon.com/auth/o2/token";
const tokenCache = new Map<string, { token: string; until: number }>();

type Creds = { clientId: string; clientSecret: string; refreshToken: string; marketplaceIds: string[]; sellerId: string | null; publicImageBase: string | null };

/** Hauptkonto (amazon_sp) oder zweites Verkäuferkonto (amazon_sp_2, z. B. die GmbH einer Marke). */
async function creds(tenantId: string, provider: "amazon_sp" | "amazon_sp_2" = "amazon_sp"): Promise<Creds | null> {
  const v = await getIntegration(tenantId, provider);
  if (!v?.clientId || !v.clientSecret || !v.refreshToken) return null;
  return {
    clientId: v.clientId,
    clientSecret: v.clientSecret,
    refreshToken: v.refreshToken,
    marketplaceIds: (v.marketplaceIds || "A1PA6795UKMFR9").split(/[,\s]+/).filter(Boolean),
    sellerId: v.sellerId?.trim() || null,
    publicImageBase: v.publicImageBase?.trim().replace(/\/$/, "") || null,
  };
}

async function lwaToken(c: Creds): Promise<string> {
  const key = `${c.clientId}:${c.refreshToken.slice(-12)}`;
  const hit = tokenCache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const res = await fetch(LWA_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!j.access_token) throw new Error(`Amazon-Anmeldung fehlgeschlagen: ${j.error_description ?? j.error ?? res.status}`);
  tokenCache.set(key, { token: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 300) * 1000 });
  return j.access_token;
}

async function sp<T>(c: Creds, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${ENDPOINT()}${path}`, {
      method,
      headers: { "x-amz-access-token": token ?? (await lwaToken(c)), "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = (json.errors as { message?: string; code?: string }[] | undefined)?.map((e) => `${e.code}: ${e.message}`).join("; ");
      throw new Error(`Amazon ${method} ${path.split("?")[0]} → ${res.status}${msg ? ` (${msg})` : ""}`);
    }
    return json as T;
  }
  throw new Error("Amazon: zu viele Anfragen (Rate Limit) – später erneut.");
}

// --- Reports -------------------------------------------------------------------------

export const REPORT_TYPES: Record<Exclude<ReportKind, "settlement">, string> = {
  ledger: "GET_LEDGER_DETAIL_VIEW_DATA",
  reimbursements: "GET_FBA_REIMBURSEMENTS_DATA",
  customerReturns: "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA",
  removalOrders: "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA",
  removalShipments: "GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA",
  inventory: "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
  orders: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
  feedback: "GET_SELLER_FEEDBACK_DATA",
  fees: "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA",
  transactions: "GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA",
  fbmReturns: "GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE",
};
const KIND_BY_TYPE = new Map<string, ReportKind>([...Object.entries(REPORT_TYPES).map(([k, v]) => [v, k as ReportKind] as const), ["GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", "settlement"]]);

/** Wie viele Tage rückwirkend je Report angefordert werden. */
const LOOKBACK: Partial<Record<ReportKind, number>> = { ledger: 45, reimbursements: 90, customerReturns: 90, removalOrders: 120, removalShipments: 120, orders: 30, feedback: 90, transactions: 90, fbmReturns: 90 };

export async function requestReport(tenantId: string, kind: Exclude<ReportKind, "settlement">) {
  const c = await creds(tenantId);
  if (!c) throw new Error("Amazon ist nicht verbunden.");
  const body: Record<string, unknown> = { reportType: REPORT_TYPES[kind], marketplaceIds: c.marketplaceIds };
  const days = LOOKBACK[kind];
  if (days) {
    body.dataStartTime = new Date(Date.now() - days * 86400_000).toISOString();
    if (kind === "ledger") body.reportOptions = { aggregateByLocation: "FC", aggregatedByTimePeriod: "DAILY" };
  }
  const r = await sp<{ reportId: string }>(c, "POST", "/reports/2021-06-30/reports", body);
  await db.insert(schema.apiReportRequests).values({ tenantId, reportType: REPORT_TYPES[kind], reportId: r.reportId }).onConflictDoNothing();
  return r.reportId;
}

async function downloadDocument(c: Creds, documentId: string): Promise<Uint8Array> {
  const doc = await sp<{ url: string; compressionAlgorithm?: string }>(c, "GET", `/reports/2021-06-30/documents/${documentId}`);
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Report-Download fehlgeschlagen (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Uint8Array(doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf) : buf);
}

/** Holt fertige Reports ab und übernimmt sie wie einen Upload. */
export async function processPendingReports(tenantId: string) {
  const c = await creds(tenantId);
  if (!c) return { processed: 0 };
  const pending = await db.select().from(schema.apiReportRequests).where(and(eq(schema.apiReportRequests.tenantId, tenantId), eq(schema.apiReportRequests.status, "pending")));
  let processed = 0;
  for (const p of pending) {
    try {
      const r = await sp<{ processingStatus: string; reportDocumentId?: string }>(c, "GET", `/reports/2021-06-30/reports/${p.reportId}`);
      if (["IN_QUEUE", "IN_PROGRESS"].includes(r.processingStatus)) continue;
      if (r.processingStatus !== "DONE" || !r.reportDocumentId) {
        await db.update(schema.apiReportRequests).set({ status: r.processingStatus === "CANCELLED" ? "done" : "error", error: r.processingStatus, processedAt: new Date() }).where(eq(schema.apiReportRequests.id, p.id));
        continue;
      }
      const kind = KIND_BY_TYPE.get(p.reportType)!;
      await applyReport({ tenantId, kind, table: readTable(await downloadDocument(c, r.reportDocumentId)), fileName: `SP-API ${p.reportType}`, via: "api" });
      await db.update(schema.apiReportRequests).set({ status: "done", processedAt: new Date() }).where(eq(schema.apiReportRequests.id, p.id));
      processed++;
    } catch (e) {
      await db.update(schema.apiReportRequests).set({ status: "error", error: e instanceof Error ? e.message : String(e), processedAt: new Date() }).where(eq(schema.apiReportRequests.id, p.id));
    }
  }
  return { processed };
}

/** Abrechnungen erstellt Amazon selbst – neue abholen. */
export async function fetchSettlements(tenantId: string) {
  const c = await creds(tenantId);
  if (!c) return { fetched: 0 };
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const list = await sp<{ reports: { reportId: string; processingStatus: string; reportDocumentId?: string }[] }>(c, "GET", `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2&createdSince=${encodeURIComponent(since)}&pageSize=50`);
  const known = new Set((await db.select({ id: schema.apiReportRequests.reportId }).from(schema.apiReportRequests).where(eq(schema.apiReportRequests.tenantId, tenantId))).map((r) => r.id));
  let fetched = 0;
  for (const r of list.reports) {
    if (known.has(r.reportId) || r.processingStatus !== "DONE" || !r.reportDocumentId) continue;
    await applyReport({ tenantId, kind: "settlement", table: readTable(await downloadDocument(c, r.reportDocumentId)), fileName: `SP-API Settlement ${r.reportId}`, via: "api" });
    await db.insert(schema.apiReportRequests).values({ tenantId, reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", reportId: r.reportId, status: "done", processedAt: new Date() }).onConflictDoNothing();
    fetched++;
  }
  return { fetched };
}

/** Fordert Reports nach Plan an (höchstens einmal je Zeitraum). */
export async function scheduleReports(tenantId: string) {
  if (!(await creds(tenantId))) return;
  const plan: [Exclude<ReportKind, "settlement">, number][] = [
    ["inventory", 4], ["ledger", 24], ["reimbursements", 24], ["customerReturns", 24], ["removalOrders", 24], ["removalShipments", 24], ["fees", 72], ["feedback", 72], ["transactions", 24], ["fbmReturns", 24],
  ];
  for (const [kind, hours] of plan) {
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.apiReportRequests)
      .where(and(eq(schema.apiReportRequests.tenantId, tenantId), eq(schema.apiReportRequests.reportType, REPORT_TYPES[kind]), gte(schema.apiReportRequests.requestedAt, new Date(Date.now() - hours * 3600_000))));
    if (recent.n === 0) await requestReport(tenantId, kind).catch((e) => console.error("Report-Anforderung", kind, e));
  }
}

// --- Bestellungen (FBM) mit Adresse -------------------------------------------------

type SpOrder = {
  AmazonOrderId: string;
  PurchaseDate: string;
  OrderStatus: string;
  FulfillmentChannel: "MFN" | "AFN";
  OrderTotal?: { Amount: string; CurrencyCode: string };
  LatestShipDate?: string;
  ShippingAddress?: { Name?: string; AddressLine1?: string; AddressLine2?: string; AddressLine3?: string; City?: string; PostalCode?: string; CountryCode?: string; Phone?: string };
  BuyerInfo?: { BuyerEmail?: string; BuyerName?: string };
};

export async function syncFbmOrders(tenantId: string) {
  const c = await creds(tenantId);
  if (!c) return { orders: 0 };
  // Adressen sind geschützte Daten – dafür ein Restricted Data Token anfordern.
  const rdt = await sp<{ restrictedDataToken: string }>(c, "POST", "/tokens/2021-03-01/restrictedDataToken", {
    restrictedResources: [{ method: "GET", path: "/orders/v0/orders", dataElements: ["buyerInfo", "shippingAddress"] }],
  }).catch(() => null);
  const after = new Date(Date.now() - 14 * 86400_000).toISOString();
  const q = `MarketplaceIds=${c.marketplaceIds.join(",")}&CreatedAfter=${encodeURIComponent(after)}&FulfillmentChannels=MFN&OrderStatuses=Unshipped,PartiallyShipped&MaxResultsPerPage=100`;
  const res = await sp<{ payload: { Orders: SpOrder[] } }>(c, "GET", `/orders/v0/orders?${q}`, undefined, rdt?.restrictedDataToken);
  let count = 0;
  for (const o of res.payload.Orders) {
    const a = o.ShippingAddress ?? {};
    const lines = [a.AddressLine1, a.AddressLine2, a.AddressLine3].filter(Boolean) as string[];
    const streetLine = lines.find((l) => /\d/.test(l)) ?? lines[0] ?? "";
    const { street, houseNo } = splitStreet(streetLine);
    const extra = lines.filter((l) => l !== streetLine).join(", ");
    const shipTo = { name1: a.Name, name2: extra || undefined, street, houseNo, zip: a.PostalCode, city: a.City, country: a.CountryCode ?? "DE", phone: a.Phone, email: o.BuyerInfo?.BuyerEmail };
    const [row] = await db
      .insert(schema.orders)
      .values({
        tenantId,
        channel: "amazon",
        externalId: o.AmazonOrderId,
        orderDate: new Date(o.PurchaseDate),
        fulfillment: "FBM",
        status: mapAmazonStatus(o.OrderStatus, "FBM"),
        externalStatus: o.OrderStatus,
        buyerName: a.Name ?? o.BuyerInfo?.BuyerName ?? null,
        shipTo: a.Name ? shipTo : undefined,
        total: o.OrderTotal ? Number(o.OrderTotal.Amount) : null,
        currency: o.OrderTotal?.CurrencyCode ?? "EUR",
        shipBy: o.LatestShipDate ? new Date(o.LatestShipDate) : null,
      })
      .onConflictDoUpdate({
        target: [schema.orders.tenantId, schema.orders.channel, schema.orders.externalId],
        set: { externalStatus: sql`excluded.external_status`, shipTo: sql`coalesce(excluded.ship_to, ${schema.orders.shipTo})`, shipBy: sql`excluded.ship_by`, fulfillment: sql`'FBM'`, updatedAt: sql`now()` },
      })
      .returning({ id: schema.orders.id, inserted: sql<boolean>`(xmax = 0)` });
    const items = await sp<{ payload: { OrderItems: { OrderItemId: string; SellerSKU?: string; ASIN: string; Title?: string; QuantityOrdered: number; ItemPrice?: { Amount: string } }[] } }>(c, "GET", `/orders/v0/orders/${o.AmazonOrderId}/orderItems`);
    await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, row.id));
    await db.insert(schema.orderItems).values(
      items.payload.OrderItems.map((i) => ({ tenantId, orderId: row.id, externalItemId: i.OrderItemId, sku: i.SellerSKU ?? null, asin: i.ASIN, title: i.Title ?? null, quantity: i.QuantityOrdered, price: i.ItemPrice ? Number(i.ItemPrice.Amount) / Math.max(1, i.QuantityOrdered) : null })),
    );
    if (row.inserted) count++;
  }
  return { orders: count };
}

registerTrackingUploader("amazon", async (tenantId, order, items) => {
  const c = await creds(tenantId);
  if (!c) throw new Error("Amazon ist nicht verbunden – Versandbestätigung als Datei hochladen.");
  if (items.some((i) => !i.externalItemId)) throw new Error("Positions-IDs fehlen (Auftrag nicht per Schnittstelle geladen) – Versandbestätigung als Datei hochladen.");
  await sp(c, "POST", `/orders/v0/orders/${order.externalId}/shipmentConfirmation`, {
    marketplaceId: c.marketplaceIds[0],
    packageDetail: {
      packageReferenceId: "1",
      carrierCode: order.carrier ?? "DHL",
      shippingMethod: "Paket",
      trackingNumber: order.trackingNumber,
      shipDate: (order.shippedAt ?? new Date()).toISOString(),
      orderItems: items.map((i) => ({ orderItemId: i.externalItemId, quantity: i.quantity })),
    },
  });
});

for (const provider of ["amazon_sp", "amazon_sp_2"] as const) registerTester(provider, async (v, tenantId) => {
  const c = await creds(tenantId, provider);
  if (!c) throw new Error("Client-ID, Secret und Refresh-Token angeben.");
  const r = await sp<{ payload: { marketplace: { id: string; countryCode: string } ; participation: { isParticipating: boolean } }[] }>(c, "GET", "/sellers/v1/marketplaceParticipations");
  const active = r.payload.filter((p) => p.participation.isParticipating).map((p) => p.marketplace.countryCode);
  void v;
  return `Verbunden. Aktive Marktplätze: ${active.join(", ") || "keine"}.`;
});



// --- Listings (Artikel anlegen/ändern) ------------------------------------------------

export type ListingsAccount = "haupt" | "zweit";

/** Verbindung für das Listings-API: Konto wählen, Verkäufer-ID und Marktplatz prüfen. */
export async function listingsConn(tenantId: string, account: ListingsAccount) {
  const provider = account === "zweit" ? "amazon_sp_2" : "amazon_sp";
  const c = await creds(tenantId, provider);
  const where = account === "zweit" ? "Anbindungen → „Amazon – zweites Verkäuferkonto“" : "Anbindungen → „Amazon Seller Central“";
  if (!c) throw new Error(`Amazon-Konto nicht verbunden (${where}).`);
  if (!c.sellerId) throw new Error(`Händler-ID (Merchant Token) fehlt (${where}).`);
  return {
    sellerId: c.sellerId,
    marketplaceId: c.marketplaceIds[0] ?? "A1PA6795UKMFR9",
    publicImageBase: c.publicImageBase,
    call: <T>(method: string, path: string, body?: unknown) => sp<T>(c, method, path, body),
  };
}

// --- Verkaufsfreigabe (Listings Restrictions) ------------------------------------------------

export type Sellable = { ok: boolean; reason: string | null; link: string | null };

/**
 * Darf das eigene Konto diese ASINs (Zustand neu) anbieten? Leere Liste = ja; sonst Grund, z. B.
 * „Freischaltung erforderlich“, mit Link zum Antrag. Braucht die App-Rolle „Produktlisting“.
 */
export async function listingRestrictions(tenantId: string, asins: string[]): Promise<Map<string, Sellable>> {
  const c = await listingsConn(tenantId, "haupt");
  const out = new Map<string, Sellable>();
  for (const asin of asins) {
    const q = new URLSearchParams({ asin, sellerId: c.sellerId, marketplaceIds: c.marketplaceId, conditionType: "new_new", reasonLocale: "de_DE" });
    const r = await c.call<{ restrictions?: { reasons?: { message?: string; reasonCode?: string; links?: { resource?: string; title?: string }[] }[] }[] }>("GET", `/listings/2021-08-01/restrictions?${q}`);
    const reasons = (r.restrictions ?? []).flatMap((x) => x.reasons ?? []);
    const first = reasons[0];
    out.set(asin, {
      ok: reasons.length === 0,
      reason: first ? (first.reasonCode === "APPROVAL_REQUIRED" ? "Freischaltung erforderlich" : first.reasonCode === "ASIN_NOT_FOUND" ? "ASIN nicht gefunden" : first.message?.slice(0, 160) || first.reasonCode || "gesperrt") : null,
      link: first?.links?.find((l) => l.resource)?.resource ?? null,
    });
    // 5 Anfragen/Sekunde erlaubt – etwas Luft lassen.
    await new Promise((res) => setTimeout(res, 250));
  }
  return out;
}

// --- Bestandsabgleich (FBM-Menge) --------------------------------------------------------

class SyncOffError extends Error {
  /** Angebot nicht abgleichen (z. B. FBA – den Bestand führt Amazon). */
  disableSync = true;
}

/**
 * Setzt die FBM-Menge eines Angebots über die Listings-API. Beim ersten Mal wird der
 * Produkttyp gelesen und geprüft, dass es kein FBA-Angebot ist – das würde sonst auf
 * Eigenversand umgestellt.
 */
registerStockPusher("amazon", async (tenantId, l, quantity) => {
  const p = (l.payload ?? {}) as { account?: ListingsAccount; productType?: string; fbmChecked?: boolean };
  const c = await listingsConn(tenantId, p.account ?? "haupt");
  const path = `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(l.sku)}`;
  let productType = p.productType;
  if (!productType || !p.fbmChecked) {
    const item = await c.call<{ summaries?: { productType?: string }[]; fulfillmentAvailability?: { fulfillmentChannelCode?: string }[] }>(
      "GET",
      `${path}?marketplaceIds=${c.marketplaceId}&includedData=summaries,fulfillmentAvailability`,
    );
    productType = item.summaries?.[0]?.productType;
    if (!productType) throw new Error("Angebot bei Amazon nicht gefunden (SKU prüfen).");
    const fba = (item.fulfillmentAvailability ?? []).some((f) => f.fulfillmentChannelCode && f.fulfillmentChannelCode !== "DEFAULT");
    if (fba) throw new SyncOffError("FBA-Angebot – den Bestand führt Amazon. Abgleich für dieses Angebot ausgeschaltet.");
  }
  const r = await c.call<{ status?: string; issues?: { severity?: string; message?: string }[] }>("PATCH", `${path}?marketplaceIds=${c.marketplaceId}`, {
    productType,
    patches: [{ op: "replace", path: "/attributes/fulfillment_availability", value: [{ fulfillment_channel_code: "DEFAULT", quantity }] }],
  });
  if (r.status && r.status !== "ACCEPTED") {
    throw new Error((r.issues ?? []).filter((i) => i.severity === "ERROR").map((i) => i.message).join("; ") || `Amazon-Status ${r.status}`);
  }
  return { payload: { productType, fbmChecked: true } };
});
