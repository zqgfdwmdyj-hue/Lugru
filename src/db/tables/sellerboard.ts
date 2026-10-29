import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, money, tenantId } from "./core";

// Daten aus sellerboard (nur lesend über den sellerboard-Connector). Jede Zeile trägt den Abrufzeitpunkt,
// damit überall „Stand …“ angezeigt werden kann. Eigene Daten im Seller-System haben Vorrang.

/** Produkte mit Einkaufspreis (netto) und Amazon-Gebühren je SKU. */
export const sellerboardProducts = pgTable(
  "sellerboard_products",
  {
    id: id(),
    tenantId: tenantId(),
    sbId: text("sb_id").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    ean: text("ean"),
    name: text("name"),
    channel: text("channel"),
    /** Einkaufspreis netto je Stück laut sellerboard (null = dort nicht hinterlegt). */
    cost: money("cost"),
    costPeriod: text("cost_period"),
    price: money("price"),
    fbaFee: money("fba_fee"),
    referralFee: money("referral_fee"),
    vatPct: numeric("vat_pct", { precision: 6, scale: 2 }),
    margin: money("margin"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sb_products_uq").on(t.tenantId, t.sbId), index("sb_products_sku_idx").on(t.tenantId, t.sku)],
);

/** Bestand und Nachbestell-Hinweise je FNSKU/SKU. */
export const sellerboardInventory = pgTable(
  "sellerboard_inventory",
  {
    id: id(),
    tenantId: tenantId(),
    sbId: text("sb_id").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    fnsku: text("fnsku"),
    name: text("name"),
    channel: text("channel"),
    fbaStock: integer("fba_stock").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    inbound: integer("inbound").notNull().default(0),
    salesVelocity: numeric("sales_velocity", { precision: 10, scale: 2 }),
    daysLeft: integer("days_left"),
    /** „YES“ / „SOON“ / „NO“ laut sellerboard. */
    timeToReorder: text("time_to_reorder"),
    daysToReorder: integer("days_to_reorder"),
    qtyToReorder: integer("qty_to_reorder").notNull().default(0),
    runningOut: text("running_out"),
    cost: money("cost"),
    /** Lagerwert zum EK laut sellerboard (StockAtCostPrice). */
    stockValue: money("stock_value"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sb_inventory_uq").on(t.tenantId, t.sbId), index("sb_inventory_sku_idx").on(t.tenantId, t.sku)],
);

export type SbShipmentLine = { sku: string; fnsku: string | null; asin: string | null; name: string | null; units: number; received: number };

/** FBA-Sendungen (je Amazon-Sendung) mit verschickter und von Amazon empfangener Menge. */
export const sellerboardShipments = pgTable(
  "sellerboard_shipments",
  {
    id: id(),
    tenantId: tenantId(),
    sbId: text("sb_id").notNull(),
    amazonId: text("amazon_id"),
    name: text("name"),
    status: text("status").notNull(),
    createdOn: date("created_on", { mode: "string" }),
    lastUpdate: date("last_update", { mode: "string" }),
    lines: jsonb("lines").$type<SbShipmentLine[]>().notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sb_shipments_uq").on(t.tenantId, t.sbId)],
);

/** Monatswerte laut sellerboard-Dashboard (Vergleich zur eigenen Gewinnrechnung). */
export const sellerboardMonths = pgTable(
  "sellerboard_months",
  {
    tenantId: tenantId(),
    month: text("month").notNull(),
    sales: money("sales"),
    units: integer("units"),
    orders: integer("orders"),
    refunds: integer("refunds"),
    amazonFees: money("amazon_fees"),
    productCosts: money("product_costs"),
    expenses: money("expenses"),
    grossProfit: money("gross_profit"),
    netProfit: money("net_profit"),
    payout: money("payout"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month] })],
);

/**
 * Verkaufs-Kennzahlen je Kanal (amazon/ebay) und Zeitraum wie die sellerboard-Kacheln: ein Tag (von = bis) oder
 * ein Bereich (Monat bis heute, letzter Monat). Tage sind UTC-Tage wie in sellerboard.
 */
export const sellerboardKpis = pgTable(
  "sellerboard_kpis",
  {
    tenantId: tenantId(),
    channel: text("channel").notNull(),
    fromDay: date("from_day", { mode: "string" }).notNull(),
    toDay: date("to_day", { mode: "string" }).notNull(),
    sales: money("sales"),
    orders: integer("orders"),
    units: integer("units"),
    refunds: integer("refunds"),
    advertising: money("advertising"),
    payout: money("payout"),
    grossProfit: money("gross_profit"),
    netProfit: money("net_profit"),
    /** sellerboard meldet fehlende Einkaufspreise – Gewinn dort zu hoch. */
    missingCost: boolean("missing_cost").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.channel, t.fromDay, t.toDay] })],
);

export type SbTopRow = { name: string | null; sku: string | null; image: string | null; link: string | null; units: number; refunds: number; sales: number | null; netProfit: number | null };

/** Meistverkaufte Produkte je Kanal und Tag (sellerboard-Produkttabelle, nach Einheiten). */
export const sellerboardTop = pgTable(
  "sellerboard_top",
  {
    tenantId: tenantId(),
    channel: text("channel").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    total: integer("total").notNull().default(0),
    rows: jsonb("rows").$type<SbTopRow[]>().notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.channel, t.day] })],
);

/**
 * Kennzahlen je Produkt über die letzten 30 abgeschlossenen Tage (Grundlage der Hebel: Verlust, Marge,
 * Erstattungen, Kaufquote, Preis-Spielraum). Je Abgleich komplett ersetzt.
 */
export const sellerboardSkuStats = pgTable(
  "sellerboard_sku_stats",
  {
    tenantId: tenantId(),
    channel: text("channel").notNull(),
    sku: text("sku").notNull(),
    name: text("name"),
    asin: text("asin"),
    image: text("image"),
    link: text("link"),
    units: integer("units").notNull().default(0),
    refunds: integer("refunds").notNull().default(0),
    sales: money("sales"),
    netProfit: money("net_profit"),
    grossProfit: money("gross_profit"),
    /** Amazon- bzw. eBay-Gebühren (negativ). */
    fees: money("fees"),
    productCosts: money("product_costs"),
    advertising: money("advertising"),
    vat: money("vat"),
    /** Kosten der Erstattungen (negativ). */
    refundCost: money("refund_cost"),
    /** Durchschnittlicher Verkaufspreis (brutto) und aktueller Angebotspreis. */
    avgPrice: money("avg_price"),
    price: money("price"),
    sessions: integer("sessions"),
    /** Kaufquote in % (Einheiten je Besuch). */
    conversion: numeric("conversion", { precision: 8, scale: 2 }),
    stock: integer("stock"),
    daysLeft: integer("days_left"),
    salesVelocity: numeric("sales_velocity", { precision: 10, scale: 2 }),
    timeToReorder: text("time_to_reorder"),
    stockValue: money("stock_value"),
    /** sellerboard kennt keinen EK (Gewinn dort ohne Wareneinsatz). */
    costMissing: boolean("cost_missing").notNull().default(false),
    fromDay: date("from_day", { mode: "string" }).notNull(),
    toDay: date("to_day", { mode: "string" }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.channel, t.sku] })],
);

/** Verkaufte eBay-Einheiten je Tag und SKU (aus den Bestellpositionen) – für den eBay-Gewinn mit eigenem EK. */
export const sellerboardEbayUnits = pgTable(
  "sellerboard_ebay_units",
  {
    tenantId: tenantId(),
    day: date("day", { mode: "string" }).notNull(),
    sku: text("sku").notNull(),
    units: integer("units").notNull().default(0),
    /** Einheiten, für die sellerboard schon einen EK abgezogen hat. */
    unitsWithCost: integer("units_with_cost").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day, t.sku] })],
);

/** Buy-Box laut Keepa für Hebel-Kandidaten (täglich, sparsam mit Tokens). */
export const hebelKeepa = pgTable(
  "hebel_keepa",
  {
    tenantId: tenantId(),
    asin: text("asin").notNull(),
    buyBoxPrice: money("buy_box_price"),
    hasBuyBox: boolean("has_buy_box"),
    buyBoxIsAmazon: boolean("buy_box_is_amazon").notNull().default(false),
    buyBoxIsFba: boolean("buy_box_is_fba").notNull().default(false),
    buyBoxSellerId: text("buy_box_seller_id"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.asin] })],
);

/** Ausgeblendete Hebel („erledigt / später“) bis zu einem Datum. */
export const hebelDismissals = pgTable(
  "hebel_dismissals",
  {
    tenantId: tenantId(),
    key: text("key").notNull(),
    until: date("until", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/** Gewinn je SKU und Monat laut sellerboard. */
export const sellerboardSkuMonths = pgTable(
  "sellerboard_sku_months",
  {
    tenantId: tenantId(),
    month: text("month").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    name: text("name"),
    units: integer("units"),
    sales: money("sales"),
    netProfit: money("net_profit"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month, t.sku] })],
);

/**
 * Gewinn je SKU und Tag (letzte abgeschlossene Tage, für den Verlust-Stopp). Je Tag komplett ersetzt, nach
 * 21 Tagen gelöscht.
 */
export const sellerboardSkuTage = pgTable(
  "sellerboard_sku_tage",
  {
    tenantId: tenantId(),
    channel: text("channel").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    name: text("name"),
    units: integer("units").notNull().default(0),
    sales: money("sales"),
    netProfit: money("net_profit"),
    avgPrice: money("avg_price"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.channel, t.day, t.sku] }), index("sb_sku_tage_sku_idx").on(t.tenantId, t.sku)],
);
