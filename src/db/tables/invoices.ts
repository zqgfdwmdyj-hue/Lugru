import { date, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, lots, money, suppliers, tenantId, updatedAt } from "./core";

export const INVOICE_KINDS = ["goods", "expense", "unknown"] as const;
export const INVOICE_STATUSES = ["new", "matched", "review", "ignored"] as const;
/** Belegart laut Erkennung (Text/Dateiname) oder von Hand. */
export const DOC_TYPES = ["rechnung", "gutschrift", "storno", "bestaetigung", "lieferschein", "mahnung", "quittung", "keinbeleg", "unbekannt"] as const;
export type InvoiceChecks = {
  /** Datum unsicher: Grund und – falls es einen gibt – ein Vorschlag (ISO). */
  date?: { uncertain: string; suggestion?: string | null };
  /** Belegart nicht sicher erkannt. */
  docType?: { uncertain: string };
  /** Als „kein Rechnungsbeleg“ aussortiert (AGB, Garantie, Werbung …): woran erkannt. */
  notInvoice?: string;
  /** Mögliche Duplikate (IDs) mit Grund – nur Hinweis, nichts wird gelöscht. */
  duplicateOf?: { id: string; reason: string }[];
  /** Von Hand bestätigt: kein Duplikat. */
  notDuplicate?: boolean;
  /** Von Hand gesetzte Felder – werden bei der erneuten Prüfung nicht mehr angezweifelt. */
  manual?: ("date" | "docType")[];
  /** Stand der Prüflogik, mit der zuletzt geprüft wurde. */
  v?: number;
};

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId(),
    /** „scan“: Kassenzettel/Beleg mit dem Handy fotografiert. */
    source: text("source", { enum: ["drive", "upload", "scan"] }).notNull(),
    externalId: text("external_id"),
    fileName: text("file_name").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    /** Quelle aus dem Dateinamen, z. B. "amazon-business-api" oder "hd-plus-de". */
    sourceKey: text("source_key"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    kind: text("kind", { enum: INVOICE_KINDS }).notNull().default("unknown"),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("new"),
    docType: text("doc_type", { enum: DOC_TYPES }).notNull().default("rechnung"),
    /** Hinweise der Prüfung: unsicheres Datum (mit Vorschlag), unklare Belegart, mögliche Duplikate. */
    checks: jsonb("checks").$type<InvoiceChecks>().notNull().default({}),
    invoiceDate: date("invoice_date", { mode: "string" }),
    invoiceNumber: text("invoice_number"),
    orderNumber: text("order_number"),
    totalGross: money("total_gross"),
    totalNet: money("total_net"),
    currency: text("currency").notNull().default("EUR"),
    textExcerpt: text("text_excerpt"),
    /** Händler/Aussteller (bei Belegen von der KI gelesen). */
    vendor: text("vendor"),
    /** Firma (Buchhaltung je Firma); leer = Hauptfirma. */
    firma: text("firma"),
    /** Stand der Übertragung an Stotax Select (Mail2Select). */
    stotaxSentAt: timestamp("stotax_sent_at", { withTimezone: true }),
    stotaxTriedAt: timestamp("stotax_tried_at", { withTimezone: true }),
    stotaxError: text("stotax_error"),
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
