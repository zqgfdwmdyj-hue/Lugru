import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, lots, money, products, suppliers, tenantId, updatedAt, users } from "./core";
import { invoices } from "./invoices";

// Einkauf wie in einer WaWi (JTL: Lieferantenbestellungen): Bestellung beim Shop/Lieferanten,
// Lieferung verfolgen, Wareneingang buchen – daraus entstehen Chargen (mit SKU) und Lagerbestand.

export const PO_STATUSES = ["draft", "ordered", "shipped", "partial", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    tenantId: tenantId(),
    /** Eigene Bestellnummer, z. B. EK-2026-0001. */
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    status: text("status", { enum: PO_STATUSES }).notNull().default("draft"),
    orderDate: date("order_date", { mode: "string" }),
    expectedDate: date("expected_date", { mode: "string" }),
    /** Bestellnummer beim Shop – verknüpft die Eingangsrechnung automatisch. */
    supplierOrderNo: text("supplier_order_no"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    shippingCostGross: money("shipping_cost_gross"),
    notes: text("notes"),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("po_number_uq").on(t.tenantId, t.number), index("po_status_idx").on(t.tenantId, t.status)],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    tenantId: tenantId(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    asin: text("asin").notNull(),
    title: text("title"),
    ean: text("ean"),
    quantity: integer("quantity").notNull(),
    received: integer("received").notNull().default(0),
    unitCostGross: numeric("unit_cost_gross", { precision: 12, scale: 4 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("19"),
    /** Geplanter Verkaufspreis – steht in der SKU. */
    targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
    /** SKU der Charge (Schema C: SHOP_TTMONJJ_ASIN_EKBRUTTO_VK). */
    sku: text("sku"),
    lotId: uuid("lot_id").references(() => lots.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("poi_po_idx").on(t.poId), index("poi_asin_idx").on(t.tenantId, t.asin)],
);
