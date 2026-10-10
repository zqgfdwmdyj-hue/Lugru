import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "./encrypted";
import { createdAt, id, knowledgeEntries, money, tenantId, updatedAt } from "./core";
import { CHANNELS, orders } from "./orders";

export const CASE_TYPES = [
  "a_to_z",
  "chargeback",
  "ebay_not_received",
  "ebay_not_as_described",
  "return_request",
  "buyer_message",
  "account_health",
  "other",
] as const;
export const CASE_STATUSES = ["open", "waiting", "won", "lost", "closed"] as const;

export const cases = pgTable(
  "cases",
  {
    id: id(),
    tenantId: tenantId(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    type: text("type", { enum: CASE_TYPES }).notNull(),
    status: text("status", { enum: CASE_STATUSES }).notNull().default("open"),
    title: text("title").notNull(),
    externalId: text("external_id"),
    orderRef: text("order_ref"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    customer: encryptedText("customer"),
    amount: money("amount"),
    deadline: date("deadline", { mode: "string" }),
    templateId: uuid("template_id").references(() => knowledgeEntries.id, { onDelete: "set null" }),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cases_status_idx").on(t.tenantId, t.status)],
);

export const RETURN_STATUSES = ["announced", "received", "refunded", "rejected", "closed"] as const;

/** Retouren aus eigenem Versand (FBM, eBay, TikTok, Temu …). */
export const customerReturns = pgTable(
  "customer_returns",
  {
    id: id(),
    tenantId: tenantId(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    orderRef: text("order_ref").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    sku: text("sku"),
    quantity: integer("quantity").notNull().default(1),
    reason: text("reason"),
    status: text("status", { enum: RETURN_STATUSES }).notNull().default("announced"),
    condition: text("condition", { enum: ["sellable", "damaged", "missing", "wrong_item"] }),
    refundAmount: money("refund_amount"),
    trackingNumber: text("tracking_number"),
    restocked: integer("restocked").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customer_returns_status_idx").on(t.tenantId, t.status)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    tenantId: tenantId(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    orderRef: text("order_ref"),
    rowHash: text("row_hash").notNull(),
    status: text("status", { enum: ["new", "ok", "answered", "removal_requested", "removed"] }).notNull().default("new"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_hash_uq").on(t.tenantId, t.rowHash)],
);
