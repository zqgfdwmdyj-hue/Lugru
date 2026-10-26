import { date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
