import { boolean, date, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt } from "./core";
import { emails } from "./inbox";

// Amazon-ToDos: Aufgaben aus Amazon-Systemmails (Produktsicherheit, Reaktivierung, Echtheitsprüfung,
// Entsorgungsdrohung, Remission, Claims …) mit Frist. Übernommen aus dem Retouren-Tool.

export const AMAZON_TODO_STATUSES = ["open", "done", "ignored"] as const;
export const AMAZON_TODO_PRIORITIES = ["high", "medium", "low"] as const;

export const amazonTodos = pgTable(
  "amazon_todos",
  {
    id: id(),
    tenantId: tenantId(),
    /** Message-ID der Mail – je Mail höchstens eine Aufgabe. */
    messageKey: text("message_key").notNull(),
    emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    sender: text("sender"),
    subject: text("subject"),
    /** Schlagwort, z. B. produktsicherheit, reaktivierung, echtheitspruefung, entsorgung_drohung. */
    category: text("category").notNull().default("sonstiges"),
    priority: text("priority", { enum: AMAZON_TODO_PRIORITIES }).notNull().default("medium"),
    deadline: date("deadline", { mode: "string" }),
    asins: jsonb("asins").$type<string[]>().notNull().default([]),
    summary: text("summary"),
    bodyShort: text("body_short"),
    status: text("status", { enum: AMAZON_TODO_STATUSES }).notNull().default("open"),
    /** Nur zur Info (z. B. „Bestand freigegeben“) – steht als erledigt in der Liste. */
    infoOnly: boolean("info_only").notNull().default(false),
    note: text("note"),
    /** Wodurch erledigt: von Hand, automatisch durch Folge-Mail … */
    closedBy: text("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    source: text("source", { enum: ["ai", "rules", "import"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("amazon_todos_key_uq").on(t.tenantId, t.messageKey),
    index("amazon_todos_status_idx").on(t.tenantId, t.status, t.deadline),
  ],
);

/** Mails, die schon geprüft und verworfen wurden – gehen nie wieder zur KI. */
export const amazonMailSeen = pgTable(
  "amazon_mail_seen",
  {
    tenantId: tenantId(),
    messageKey: text("message_key").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.messageKey] })],
);
