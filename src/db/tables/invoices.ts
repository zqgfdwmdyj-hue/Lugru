import { date, index, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, lots, money, suppliers, tenantId, updatedAt } from "./core";

export const INVOICE_KINDS = ["goods", "expense", "unknown"] as const;
export const INVOICE_STATUSES = ["new", "matched", "review", "ignored"] as const;

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId(),
    source: text("source", { enum: ["drive", "upload"] }).notNull(),
    externalId: text("external_id"),
    fileName: text("file_name").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    /** Quelle aus dem Dateinamen, z. B. "amazon-business-api" oder "hd-plus-de". */
    sourceKey: text("source_key"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    kind: text("kind", { enum: INVOICE_KINDS }).notNull().default("unknown"),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("new"),
    invoiceDate: date("invoice_date", { mode: "string" }),
    invoiceNumber: text("invoice_number"),
    orderNumber: text("order_number"),
    totalGross: money("total_gross"),
    totalNet: money("total_net"),
    currency: text("currency").notNull().default("EUR"),
    textExcerpt: text("text_excerpt"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_ext_uq").on(t.tenantId, t.source, t.externalId),
    index("invoices_status_idx").on(t.tenantId, t.status),
  ],
);

export const invoiceLots = pgTable(
  "invoice_lots",
  {
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    matchedBy: text("matched_by", { enum: ["auto", "manual"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.lotId] })],
);

/** Merkt sich, wie Rechnungen einer Quelle einzuordnen sind. */
export const invoiceSourceRules = pgTable(
  "invoice_source_rules",
  {
    id: id(),
    tenantId: tenantId(),
    sourceKey: text("source_key").notNull(),
    kind: text("kind", { enum: INVOICE_KINDS }).notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoice_rules_uq").on(t.tenantId, t.sourceKey)],
);
