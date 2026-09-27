import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { CLAIM_TYPES, createdAt, id, lots, money, tenantId, updatedAt, users } from "./core";

export const CLAIM_STATUSES = [
  "detected", // vom System gefunden
  "queued", // zum Einreichen vorgemerkt
  "submitted", // bei Amazon eingereicht
  "reimbursed", // erstattet
  "partial", // teilweise erstattet
  "rejected", // abgelehnt
  "escalated", // an Anwalt / Eskalation
  "dismissed", // bewusst verworfen
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type ClaimEvidence = { label: string; value: string; source?: string }[];

export const claims = pgTable(
  "claims",
  {
    id: id(),
    tenantId: tenantId(),
    type: text("type", { enum: CLAIM_TYPES }).notNull(),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("detected"),
    /** Schlüssel der Erkennung – verhindert doppelte Ansprüche. */
    detectionKey: text("detection_key"),
    title: text("title").notNull(),
    sku: text("sku"),
    fnsku: text("fnsku"),
    asin: text("asin"),
    lotId: uuid("lot_id").references(() => lots.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(1),
    unitCost: money("unit_cost"),
    expectedAmount: money("expected_amount"),
    reimbursedAmount: money("reimbursed_amount"),
    reference: text("reference"),
    eventDate: date("event_date", { mode: "string" }),
    deadline: date("deadline", { mode: "string" }),
    amazonCaseId: text("amazon_case_id"),
    priority: integer("priority").notNull().default(0),
    evidence: jsonb("evidence").$type<ClaimEvidence>().notNull().default([]),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("claims_detection_uq").on(t.tenantId, t.detectionKey),
    index("claims_status_idx").on(t.tenantId, t.status),
  ],
);

export const claimEvents = pgTable("claim_events", {
  id: id(),
  tenantId: tenantId(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});
