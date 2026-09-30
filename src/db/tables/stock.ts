import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, products, suppliers, tenantId, updatedAt, users } from "./core";
import { CHANNELS } from "./orders";

/** Eigenes Lager (FBM-Ware) je SKU. */
export const ownStock = pgTable(
  "own_stock",
  {
    id: id(),
    tenantId: tenantId(),
    sku: text("sku").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(0),
    location: text("location"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("own_stock_sku_uq").on(t.tenantId, t.sku)],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    tenantId: tenantId(),
    sku: text("sku").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    reference: text("reference"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("stock_mov_sku_idx").on(t.tenantId, t.sku)],
);

export const inventoryCounts = pgTable("inventory_counts", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  status: text("status", { enum: ["open", "booked"] }).notNull().default("open"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  bookedAt: timestamp("booked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const inventoryCountLines = pgTable(
  "inventory_count_lines",
  {
    id: id(),
    tenantId: tenantId(),
    countId: uuid("count_id")
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    expected: integer("expected").notNull().default(0),
    counted: integer("counted").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("count_line_uq").on(t.countId, t.sku)],
);

export const LISTING_STATUSES = ["draft", "active", "ended", "error"] as const;

export const listings = pgTable(
  "listings",
  {
    id: id(),
    tenantId: tenantId(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    sku: text("sku").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    title: text("title").notNull(),
    description: text("description"),
    ean: text("ean"),
    condition: text("condition").notNull().default("NEW"),
    price: money("price"),
    quantity: integer("quantity").notNull().default(0),
    status: text("status", { enum: LISTING_STATUSES }).notNull().default("draft"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("listings_uq").on(t.tenantId, t.channel, t.sku)],
);

export type FeedMapping = {
  ean?: string;
  asin?: string;
  supplierSku?: string;
  title?: string;
  price?: string;
  stock?: string;
  /** Aufschlag in % auf den EK für Versand, Zoll, Einfuhr-USt-Vorfinanzierung (nur für die Gewinnrechnung). */
  costPct?: string;
  /** USt-Satz der Artikel in % (Süßigkeiten 7) – sonst der allgemeine aus den Einstellungen. */
  vatPct?: string;
};

export type OfferMarket = {
  checkedAt: string;
  asin: string | null;
  title?: string;
  price: number | null;
  fbaFee: number | null;
  referralPct: number | null;
  monthlySold: number | null;
  salesRank: number | null;
  offers?: number | null;
  /** Ohne EAN per Titelsuche gefunden – kann ein anderes Produkt sein. */
  byTitle?: boolean;
};

export const supplierFeeds = pgTable("supplier_feeds", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  mapping: jsonb("mapping").$type<FeedMapping>().notNull().default({}),
  lastImportAt: timestamp("last_import_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const supplierOffers = pgTable(
  "supplier_offers",
  {
    id: id(),
    tenantId: tenantId(),
    feedId: uuid("feed_id")
      .notNull()
      .references(() => supplierFeeds.id, { onDelete: "cascade" }),
    supplierSku: text("supplier_sku").notNull(),
    ean: text("ean"),
    asin: text("asin"),
    title: text("title"),
    price: money("price"),
    stock: integer("stock"),
    // Aus Scan/Seite: Originalpreis in Fremdwährung (price ist dann in EUR umgerechnet), Link, Bild, Packungsgröße.
    priceOrig: money("price_orig"),
    currency: text("currency"),
    url: text("url"),
    imageUrl: text("image_url"),
    pack: text("pack"),
    /** Amazon.de laut Keepa (per EAN gesucht). */
    market: jsonb("market").$type<OfferMarket>(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("offers_uq").on(t.feedId, t.supplierSku), index("offers_ean_idx").on(t.tenantId, t.ean)],
);
