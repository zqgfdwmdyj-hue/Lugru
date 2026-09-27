import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { type Address, createdAt, files, id, lots, money, tenantId, updatedAt } from "./core";

export const CHANNELS = ["amazon", "ebay", "tiktok", "temu", "kaufland", "shop", "manual"] as const;
export type Channel = (typeof CHANNELS)[number];

export const ORDER_STATUSES = ["open", "label_created", "shipped", "delivered", "cancelled", "returned"] as const;

export const orders = pgTable(
  "orders",
  {
    id: id(),
    tenantId: tenantId(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    externalId: text("external_id").notNull(),
    orderDate: timestamp("order_date", { withTimezone: true }).notNull(),
    /** FBA = Amazon versendet, FBM = du versendest. */
    fulfillment: text("fulfillment", { enum: ["FBA", "FBM"] }).notNull().default("FBM"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("open"),
    externalStatus: text("external_status"),
    buyerName: text("buyer_name"),
    shipTo: jsonb("ship_to").$type<Address>(),
    total: money("total"),
    currency: text("currency").notNull().default("EUR"),
    shipBy: timestamp("ship_by", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUploadedAt: timestamp("tracking_uploaded_at", { withTimezone: true }),
    trackingUploadError: text("tracking_upload_error"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_ext_uq").on(t.tenantId, t.channel, t.externalId),
    index("orders_status_idx").on(t.tenantId, t.status),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    externalItemId: text("external_item_id"),
    sku: text("sku"),
    asin: text("asin"),
    title: text("title"),
    quantity: integer("quantity").notNull().default(1),
    price: money("price"),
    lotId: uuid("lot_id").references(() => lots.id, { onDelete: "set null" }),
  },
  (t) => [index("order_items_sku_idx").on(t.tenantId, t.sku)],
);

/** Versandlabels (DHL). */
export const parcels = pgTable(
  "parcels",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    carrier: text("carrier").notNull().default("DHL"),
    product: text("product").notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 3 }).notNull(),
    trackingNumber: text("tracking_number"),
    labelFileId: uuid("label_file_id").references(() => files.id, { onDelete: "set null" }),
    status: text("status", { enum: ["created", "error", "cancelled"] }).notNull(),
    error: text("error"),
    isReturnLabel: integer("is_return_label").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("parcels_order_idx").on(t.tenantId, t.orderId)],
);
