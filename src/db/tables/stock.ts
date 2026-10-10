import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Wawi-SKU im eigenen Lager, wenn der Kanal eine andere SKU führt (z. B. eBay „LG-…“). Leer = `sku`. */
    stockSku: text("stock_sku"),
    /** Menge im Kanal folgt dem verfügbaren Wawi-Bestand. */
    stockSync: boolean("stock_sync").notNull().default(true),
    /** Höchstens so viele im Kanal zeigen (leer = alles Verfügbare). */
    maxQuantity: integer("max_quantity"),
    /** Zuletzt an den Kanal gemeldete Menge. */
    pushedQuantity: integer("pushed_quantity"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("listings_uq").on(t.tenantId, t.channel, t.sku), index("listings_stock_sku_idx").on(t.tenantId, t.stockSku)],
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
  /** Spalte Mindestabnahme (MOQ). */
  moq?: string;
  /** Spalte Produktlink. */
  url?: string;
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
  /** Amazon verkauft selbst (Keepa: aktueller Amazon-Preis) – Buy Box schwer zu holen. */
  amazonSells?: boolean | null;
  /** Darf das eigene Konto das Produkt anbieten? (SP-API Listings Restrictions, Zustand neu) */
  sellable?: { ok: boolean; reason: string | null; link: string | null; at: string } | null;
};

export const supplierFeeds = pgTable("supplier_feeds", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  mapping: jsonb("mapping").$type<FeedMapping>().notNull().default({}),
  lastImportAt: timestamp("last_import_at", { withTimezone: true }),
  /** Preise in der Liste sind brutto (inkl. USt) – gerechnet wird netto. */
  pricesGross: boolean("prices_gross").notNull().default(false),
  /** Automatischer Abruf: Download-Link der Preisliste (CSV/Excel), z. B. aus dem B2B-Shop oder Qogita-Export. */
  sourceUrl: text("source_url"),
  /** Zugang für den Link, verschlüsselt („Bearer …“, „Basic …“ oder Kopfzeile „Name: Wert“). */
  sourceAuth: text("source_auth"),
  autoPull: boolean("auto_pull").notNull().default(false),
  pullEveryHours: integer("pull_every_hours").notNull().default(24),
  lastPullAt: timestamp("last_pull_at", { withTimezone: true }),
  lastPullError: text("last_pull_error"),
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
    /** Mindestabnahme laut Liste. */
    moq: integer("moq"),
    /** In der letzten vollständigen Liste enthalten? Verschwundene bleiben für den Verlauf, zählen aber nicht. */
    active: boolean("active").notNull().default(true),
    /** Wann sich der EK zuletzt geändert hat – geänderte Preise werden bei Keepa zuerst neu geprüft. */
    priceChangedAt: timestamp("price_changed_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
    /**
     * Herkunft: „feed“ = Liste (Datei/Link, Abgleich alle 24 Std.), „scan“ = von Hand gezogen
     * (Seller-Knopf/Lesezeichen, Link, Foto) – wird einmal bei Keepa geprüft und getrennt gezeigt.
     */
    origin: text("origin", { enum: ["feed", "scan"] }).notNull().default("feed"),
    /** Einheiten je Amazon-Verkauf, von Hand gesetzt (leer = aus dem Amazon-Titel erkannt). */
    amazonQty: integer("amazon_qty"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("offers_uq").on(t.feedId, t.supplierSku), index("offers_ean_idx").on(t.tenantId, t.ean)],
);

/** EK-Verlauf: ein Stand je Angebot und Tag (letzter Preis/Bestand des Tages). */
export const supplierOfferHistory = pgTable(
  "supplier_offer_history",
  {
    id: id(),
    tenantId: tenantId(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => supplierOffers.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    price: money("price"),
    stock: integer("stock"),
  },
  (t) => [uniqueIndex("offer_hist_uq").on(t.offerId, t.day), index("offer_hist_tenant_idx").on(t.tenantId, t.day)],
);

/** VK-Verlauf: Amazon-Preis, Rang und Anbieter je ASIN und Tag (aus den Keepa-Abfragen). */
export const marketHistory = pgTable(
  "market_history",
  {
    id: id(),
    tenantId: tenantId(),
    asin: text("asin").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    price: money("price"),
    salesRank: integer("sales_rank"),
    monthlySold: integer("monthly_sold"),
    offers: integer("offers"),
  },
  (t) => [uniqueIndex("market_hist_uq").on(t.tenantId, t.asin, t.day)],
);
