import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, tenantId, updatedAt } from "./core";

// Daten aus Amazon-Reports (Seller Central Download oder SP-API). Jede Zeile trägt einen
// Hash über ihren Inhalt, damit ein erneuter Upload nichts doppelt anlegt.

export const amazonLedgerEvents = pgTable(
  "amazon_ledger_events",
  {
    id: id(),
    tenantId: tenantId(),
    rowHash: text("row_hash").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    fnsku: text("fnsku"),
    asin: text("asin"),
    sku: text("sku"),
    title: text("title"),
    eventType: text("event_type").notNull(),
    referenceId: text("reference_id"),
    quantity: integer("quantity").notNull(),
    fulfillmentCenter: text("fulfillment_center"),
    disposition: text("disposition"),
    reason: text("reason"),
    country: text("country"),
    reconciledQuantity: integer("reconciled_quantity"),
    unreconciledQuantity: integer("unreconciled_quantity"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ledger_hash_uq").on(t.tenantId, t.rowHash),
    index("ledger_sku_idx").on(t.tenantId, t.sku, t.eventDate),
    index("ledger_fnsku_idx").on(t.tenantId, t.fnsku),
  ],
);

export const amazonReimbursements = pgTable(
  "amazon_reimbursements",
  {
    id: id(),
    tenantId: tenantId(),
    rowHash: text("row_hash").notNull(),
    approvalDate: date("approval_date", { mode: "string" }).notNull(),
    reimbursementId: text("reimbursement_id").notNull(),
    caseId: text("case_id"),
    orderId: text("order_id"),
    reason: text("reason"),
    sku: text("sku"),
    fnsku: text("fnsku"),
    asin: text("asin"),
    condition: text("condition"),
    currency: text("currency"),
    amountPerUnit: money("amount_per_unit"),
    amountTotal: money("amount_total"),
    quantityCash: integer("quantity_cash").notNull().default(0),
    quantityInventory: integer("quantity_inventory").notNull().default(0),
    quantityTotal: integer("quantity_total").notNull().default(0),
    originalReimbursementId: text("original_reimbursement_id"),
    originalReimbursementType: text("original_reimbursement_type"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reimb_hash_uq").on(t.tenantId, t.rowHash),
    index("reimb_sku_idx").on(t.tenantId, t.sku),
    index("reimb_order_idx").on(t.tenantId, t.orderId),
  ],
);

export const amazonCustomerReturns = pgTable(
  "amazon_customer_returns",
  {
    id: id(),
    tenantId: tenantId(),
    rowHash: text("row_hash").notNull(),
    returnDate: date("return_date", { mode: "string" }).notNull(),
    orderId: text("order_id"),
    sku: text("sku"),
    asin: text("asin"),
    fnsku: text("fnsku"),
    title: text("title"),
    quantity: integer("quantity").notNull(),
    fulfillmentCenter: text("fulfillment_center"),
    disposition: text("disposition"),
    reason: text("reason"),
    status: text("status"),
    lpn: text("lpn"),
    customerComments: text("customer_comments"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("returns_hash_uq").on(t.tenantId, t.rowHash),
    index("returns_order_idx").on(t.tenantId, t.orderId),
    index("returns_lpn_idx").on(t.tenantId, t.lpn),
  ],
);

/** Remissions- und Entsorgungsaufträge (eine Zeile je Auftrag, SKU und Zustand). */
export const amazonRemovalOrders = pgTable(
  "amazon_removal_orders",
  {
    id: id(),
    tenantId: tenantId(),
    requestDate: date("request_date", { mode: "string" }).notNull(),
    orderId: text("order_id").notNull(),
    orderType: text("order_type"),
    orderStatus: text("order_status"),
    lastUpdated: date("last_updated", { mode: "string" }),
    sku: text("sku").notNull(),
    fnsku: text("fnsku"),
    disposition: text("disposition").notNull().default(""),
    requestedQuantity: integer("requested_quantity").notNull().default(0),
    cancelledQuantity: integer("cancelled_quantity").notNull().default(0),
    disposedQuantity: integer("disposed_quantity").notNull().default(0),
    shippedQuantity: integer("shipped_quantity").notNull().default(0),
    inProcessQuantity: integer("in_process_quantity").notNull().default(0),
    removalFee: money("removal_fee"),
    currency: text("currency"),
    /** Von dir beim Auspacken bestätigt. */
    receivedQuantity: integer("received_quantity"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("removal_order_uq").on(t.tenantId, t.orderId, t.sku, t.disposition)],
);

export const amazonRemovalShipments = pgTable(
  "amazon_removal_shipments",
  {
    id: id(),
    tenantId: tenantId(),
    rowHash: text("row_hash").notNull(),
    requestDate: date("request_date", { mode: "string" }),
    orderId: text("order_id").notNull(),
    shipmentDate: date("shipment_date", { mode: "string" }),
    sku: text("sku"),
    fnsku: text("fnsku"),
    disposition: text("disposition"),
    shippedQuantity: integer("shipped_quantity").notNull().default(0),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    orderType: text("order_type"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("removal_ship_hash_uq").on(t.tenantId, t.rowHash)],
);

/** Aktueller FBA-Bestand je SKU (letzter Report gewinnt). */
export const amazonInventory = pgTable(
  "amazon_inventory",
  {
    id: id(),
    tenantId: tenantId(),
    sku: text("sku").notNull(),
    fnsku: text("fnsku"),
    asin: text("asin"),
    title: text("title"),
    condition: text("condition"),
    price: money("price"),
    fulfillable: integer("fulfillable").notNull().default(0),
    unsellable: integer("unsellable").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    inboundWorking: integer("inbound_working").notNull().default(0),
    inboundShipped: integer("inbound_shipped").notNull().default(0),
    inboundReceiving: integer("inbound_receiving").notNull().default(0),
    researching: integer("researching").notNull().default(0),
    total: integer("total").notNull().default(0),
    mfnFulfillable: integer("mfn_fulfillable").notNull().default(0),
    /** Seit wann ist unverkäuflicher Bestand da (vom System beobachtet). */
    unsellableSince: date("unsellable_since", { mode: "string" }),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("amz_inv_sku_uq").on(t.tenantId, t.sku)],
);

export const amazonSettlements = pgTable(
  "amazon_settlements",
  {
    id: id(),
    tenantId: tenantId(),
    settlementId: text("settlement_id").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    depositDate: timestamp("deposit_date", { withTimezone: true }),
    totalAmount: money("total_amount"),
    currency: text("currency"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("settlement_uq").on(t.tenantId, t.settlementId)],
);

export const amazonSettlementLines = pgTable(
  "amazon_settlement_lines",
  {
    id: id(),
    tenantId: tenantId(),
    settlementId: text("settlement_id").notNull(),
    rowHash: text("row_hash").notNull(),
    transactionType: text("transaction_type"),
    orderId: text("order_id"),
    adjustmentId: text("adjustment_id"),
    shipmentId: text("shipment_id"),
    marketplace: text("marketplace"),
    /** AFN = Versand durch Amazon, MFN = eigener Versand. */
    fulfillmentId: text("fulfillment_id"),
    amountType: text("amount_type"),
    amountDescription: text("amount_description"),
    amount: money("amount").notNull(),
    postedDate: date("posted_date", { mode: "string" }),
    sku: text("sku"),
    quantity: integer("quantity"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("settle_line_uq").on(t.tenantId, t.rowHash),
    index("settle_line_sku_idx").on(t.tenantId, t.sku),
    index("settle_line_settlement_idx").on(t.tenantId, t.settlementId),
  ],
);

/** Protokoll aller Report-Uploads und -Abrufe. */
export const reportImports = pgTable("report_imports", {
  id: id(),
  tenantId: tenantId(),
  userId: uuid("user_id"),
  reportType: text("report_type").notNull(),
  fileName: text("file_name"),
  via: text("via").notNull().default("upload"),
  rows: integer("rows").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  message: text("message"),
  createdAt: createdAt(),
});

/** Per SP-API angeforderte Reports, die noch abgeholt werden müssen. */
export const apiReportRequests = pgTable(
  "api_report_requests",
  {
    id: id(),
    tenantId: tenantId(),
    reportType: text("report_type").notNull(),
    reportId: text("report_id").notNull(),
    status: text("status", { enum: ["pending", "done", "error"] }).notNull().default("pending"),
    error: text("error"),
    requestedAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_report_uq").on(t.tenantId, t.reportId), index("api_report_status_idx").on(t.tenantId, t.status)],
);

/**
 * Transaktionsbericht (Datumsbereich, Berichte → Zahlungen → Berichts-Repository).
 * Enthält Verkäufe, Erstattungen an Kunden und Zahlungen von Amazon an dich – auch für
 * Zeiträume, zu denen noch keine Abrechnung vorliegt.
 */
export const amazonTransactions = pgTable(
  "amazon_transactions",
  {
    id: id(),
    tenantId: tenantId(),
    rowHash: text("row_hash").notNull(),
    date: date("date", { mode: "string" }),
    /** sale, refund, reimb (Entschädigung von Amazon), safet, other */
    kind: text("kind").notNull(),
    type: text("type"),
    settlementId: text("settlement_id"),
    orderId: text("order_id"),
    sku: text("sku"),
    description: text("description"),
    quantity: integer("quantity").notNull().default(0),
    /** fba, fbm oder leer */
    channel: text("channel").notNull().default(""),
    productSales: money("product_sales"),
    shippingCredits: money("shipping_credits"),
    sellingFees: money("selling_fees"),
    fbaFees: money("fba_fees"),
    total: money("total"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("amz_tx_hash_uq").on(t.tenantId, t.rowHash),
    index("amz_tx_order_idx").on(t.tenantId, t.orderId),
    index("amz_tx_kind_idx").on(t.tenantId, t.kind, t.date),
  ],
);

/** Retourenbericht Händlerversand (Rücksendeanfragen mit Sendungsnummer, Zustellung, Erstattung). */
export const amazonFbmReturns = pgTable(
  "amazon_fbm_returns",
  {
    id: id(),
    tenantId: tenantId(),
    /** Bestellung + RMA + SKU – ein neuer Report aktualisiert die Zeile. */
    rowKey: text("row_key").notNull(),
    orderId: text("order_id").notNull(),
    orderDate: date("order_date", { mode: "string" }),
    rma: text("rma"),
    sku: text("sku"),
    asin: text("asin"),
    title: text("title"),
    requestDate: date("request_date", { mode: "string" }),
    status: text("status"),
    labelType: text("label_type"),
    tracking: text("tracking"),
    deliveryDate: date("delivery_date", { mode: "string" }),
    quantity: integer("quantity").notNull().default(1),
    reason: text("reason"),
    resolution: text("resolution"),
    orderAmount: money("order_amount"),
    refundedAmount: money("refunded_amount"),
    safetClaimId: text("safet_claim_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("amz_fbm_ret_uq").on(t.tenantId, t.rowKey), index("amz_fbm_ret_order_idx").on(t.tenantId, t.orderId)],
);
