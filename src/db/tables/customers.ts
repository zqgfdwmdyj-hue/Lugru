import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt } from "./core";
import { encryptedText } from "./encrypted";

/** Firmenkunden für B2B-Rechnungen – beim Rechnungschreiben gespeichert und wieder vorgeschlagen. */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    contact: encryptedText("contact"),
    street: encryptedText("street").notNull(),
    zip: text("zip").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull().default("DE"),
    vatId: text("vat_id"),
    email: encryptedText("email"),
    customerNumber: text("customer_number"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_name_uq").on(t.tenantId, t.name)],
);

export const INVOICE_DRAFT_STATUSES = ["offen", "erstellt", "verworfen", "ignoriert"] as const;

/**
 * Eingang aus dem „Rechnungshelfer“ (Discord, JSON-Webhook): je Ticket ein Entwurf, der geprüft
 * und zur Rechnung gemacht wird – oder automatisch, wenn alles passt.
 */
export const invoiceDrafts = pgTable(
  "invoice_drafts",
  {
    id: id(),
    tenantId: tenantId(),
    source: text("source").notNull().default("rechnungshelfer"),
    ticket: text("ticket").notNull(),
    status: text("status", { enum: INVOICE_DRAFT_STATUSES }).notNull().default("offen"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    error: text("error"),
    invoiceId: integer("invoice_id"),
    invoiceNumber: text("invoice_number"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [index("invoice_drafts_status_idx").on(t.tenantId, t.status), index("invoice_drafts_ticket_idx").on(t.tenantId, t.ticket)],
);
