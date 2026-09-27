import { sql } from "drizzle-orm";
import { index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, tenantId } from "./core";

// eBay-Listing-Tool (übernommen aus dem bisherigen LuGru eBay-Tool).
// Die Spalten folgen der bisherigen SQLite-Datenbank, damit die Datenübernahme 1:1 geht.

/** Einstellungen als Schlüssel/Wert – wie im bisherigen Tool. Geheime Werte verschlüsselt. */
export const ebaySettings = pgTable(
  "ebay_settings",
  {
    tenantId: tenantId(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/** OAuth-Tokens je Umgebung (sandbox/production) und Art (app/user), verschlüsselt. */
export const ebayTokens = pgTable(
  "ebay_tokens",
  {
    tenantId: tenantId(),
    env: text("env").notNull(),
    type: text("type").notNull(),
    accessToken: text("access_token").notNull(),
    accessExpiresAt: text("access_expires_at").notNull(),
    refreshToken: text("refresh_token"),
    refreshExpiresAt: text("refresh_expires_at"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.env, t.type] })],
);

/**
 * Listing-Versuche. Die Nummer ist mandantenübergreifend fortlaufend: sie steckt in der
 * eBay-SKU (LG-<EAN>-<Nummer>) und darf sich nie wiederholen.
 */
export const ebayListings = pgTable(
  "ebay_listings",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    ean: text("ean").notNull(),
    price: numeric("price", { precision: 14, scale: 2, mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    condition: text("condition").notNull(),
    status: text("status").notNull(),
    epid: text("epid"),
    catalogMatches: jsonb("catalog_matches"),
    sku: text("sku"),
    offerId: text("offer_id"),
    listingId: text("listing_id"),
    title: text("title"),
    description: text("description"),
    imageUrls: jsonb("image_urls"),
    aspects: jsonb("aspects"),
    categoryId: text("category_id"),
    gpsr: jsonb("gpsr"),
    warnings: jsonb("warnings"),
    errorMessage: text("error_message"),
    purchasedUnits: integer("purchased_units"),
    purchasePrice: numeric("purchase_price", { precision: 14, scale: 4, mode: "number" }),
    purchaseSource: text("purchase_source"),
    targetPrice: numeric("target_price", { precision: 14, scale: 2, mode: "number" }),
    articleKey: text("article_key"),
    purchasePriceBasis: text("purchase_price_basis"),
    fulfillmentPolicyId: text("fulfillment_policy_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("ebay_listings_tenant_idx").on(t.tenantId, t.id), index("ebay_listings_ean_idx").on(t.tenantId, t.ean)],
);

/**
 * Rechnungen zu eBay-Bestellungen. Buchhaltungsbelege: Inhalt (`data`) und Nummer werden
 * beim Anlegen eingefroren; später ändern sich nur Versandstatus und Storno-Verweis.
 */
export const ebayInvoices = pgTable(
  "ebay_invoices",
  {
    id: serial("id").primaryKey(),
    tenantId: tenantId(),
    env: text("env").notNull(),
    number: text("number").notNull(),
    year: integer("year").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    orderId: text("order_id").notNull(),
    cancelsId: integer("cancels_id"),
    cancelledById: integer("cancelled_by_id"),
    data: jsonb("data").notNull(),
    createdAt: text("created_at").notNull(),
    emailedAt: text("emailed_at"),
    emailTo: text("email_to"),
    emailError: text("email_error"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ebay_invoices_number_uq").on(t.tenantId, t.number),
    uniqueIndex("ebay_invoices_year_seq_uq").on(t.tenantId, t.year, t.seq),
    // Je Bestellung höchstens eine gültige (nicht stornierte) Rechnung.
    uniqueIndex("ebay_invoices_open_order_uq").on(t.tenantId, t.orderId).where(sql`kind = 'invoice' and cancelled_by_id is null`),
  ],
);

/** Eigene Aufzeichnung des idealo-Bestpreises je Produkt und Tag. */
export const ebayIdealoPrices = pgTable(
  "ebay_idealo_prices",
  {
    tenantId: tenantId(),
    productKey: text("product_key").notNull(),
    day: text("day").notNull(),
    price: numeric("price", { precision: 14, scale: 2, mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.productKey, t.day] })],
);
