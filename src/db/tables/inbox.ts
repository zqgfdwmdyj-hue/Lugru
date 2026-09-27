import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, integrations, tasks, tenantId, updatedAt } from "./core";

export const MAIL_CATEGORIES = ["critical", "action", "info", "noise"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const mailboxes = pgTable("mailboxes", {
  id: id(),
  tenantId: tenantId(),
  provider: text("provider", { enum: ["gmail", "outlook", "upload"] }).notNull(),
  address: text("address").notNull(),
  label: text("label"),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const emails = pgTable(
  "emails",
  {
    id: id(),
    tenantId: tenantId(),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
    providerMessageId: text("provider_message_id"),
    /** Message-ID-Header: gleich in allen Postfächern → erkennt Dubletten. */
    messageKey: text("message_key").notNull(),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    category: text("category", { enum: MAIL_CATEGORIES }).notNull().default("info"),
    topic: text("topic"),
    matchedRule: text("matched_rule"),
    references: jsonb("references").$type<Record<string, string>>().notNull().default({}),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("emails_key_uq").on(t.tenantId, t.messageKey),
    index("emails_received_idx").on(t.tenantId, t.receivedAt),
  ],
);
