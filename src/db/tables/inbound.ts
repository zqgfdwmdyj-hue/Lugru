import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, lots, products, tenantId, updatedAt, users } from "./core";

export const INBOUND_STATUSES = ["draft", "ready", "transmitted", "shipped", "receiving", "closed"] as const;

export const inboundShipments = pgTable(
  "inbound_shipments",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    status: text("status", { enum: INBOUND_STATUSES }).notNull().default("draft"),
    amazonShipmentId: text("amazon_shipment_id"),
    amazonPlanId: text("amazon_plan_id"),
    destination: text("destination"),
    notes: text("notes"),
    transmittedAt: timestamp("transmitted_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("inbound_tenant_idx").on(t.tenantId, t.status)],
);

export type InboundCheck = { level: "ok" | "warn" | "error"; message: string };

export const inboundItems = pgTable("inbound_items", {
  id: id(),
  tenantId: tenantId(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => inboundShipments.id, { onDelete: "cascade" }),
  lotId: uuid("lot_id").references(() => lots.id, { onDelete: "set null" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  sku: text("sku").notNull(),
  fnsku: text("fnsku"),
  asin: text("asin"),
  title: text("title"),
  plannedQuantity: integer("planned_quantity").notNull().default(0),
  scannedQuantity: integer("scanned_quantity").notNull().default(0),
  checks: jsonb("checks").$type<InboundCheck[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const inboundBoxes = pgTable("inbound_boxes", {
  id: id(),
  tenantId: tenantId(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => inboundShipments.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  lengthCm: numeric("length_cm", { precision: 6, scale: 1 }),
  widthCm: numeric("width_cm", { precision: 6, scale: 1 }),
  heightCm: numeric("height_cm", { precision: 6, scale: 1 }),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  createdAt: createdAt(),
});

export const inboundBoxItems = pgTable("inbound_box_items", {
  id: id(),
  tenantId: tenantId(),
  boxId: uuid("box_id")
    .notNull()
    .references(() => inboundBoxes.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => inboundItems.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(0),
});

/** Jeder Scan einzeln – das ist später der Nachweis bei Differenzen. */
export const inboundScans = pgTable(
  "inbound_scans",
  {
    id: id(),
    tenantId: tenantId(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => inboundShipments.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => inboundItems.id, { onDelete: "set null" }),
    boxId: uuid("box_id").references(() => inboundBoxes.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    quantity: integer("quantity").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("inbound_scans_shipment_idx").on(t.shipmentId, t.createdAt)],
);
