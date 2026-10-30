import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, integrations, tasks, tenantId, updatedAt, users } from "./core";

export const MAIL_CATEGORIES = ["critical", "action", "info", "noise"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const mailboxes = pgTable("mailboxes", {
  id: id(),
  tenantId: tenantId(),
  provider: text("provider", { enum: ["gmail", "outlook", "imap", "upload"] }).notNull(),
  address: text("address").notNull(),
  label: text("label"),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  /** Anzeigename beim Versand („Ludwig Grund – BlueQ“). */
  fromName: text("from_name"),
  /** Eigene Signatur – wird an Einkaufsanfragen und Nachfass-Mails angehängt. */
  signature: text("signature"),
  /** IMAP: abgerufene Ordner/Labels. Leer = automatisch (Gmail „Alle Nachrichten“, sonst Posteingang + Archiv). */
  ordner: jsonb("ordner").$type<string[] | null>(),
  /** Nur abrufen, nicht darüber senden (SMTP gesperrt oder nicht gewünscht). */
  nurAbruf: boolean("nur_abruf").notNull().default(false),
  /** Art des letzten Fehlers: anmeldung, imap_aus, port, server, tls, sonst. */
  fehlerArt: text("fehler_art"),
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
    /** Empfangsadresse (Delivered-To bzw. „An“) – zeigt, an welche Adresse/welchen Alias Amazon schreibt. */
    an: text("an"),
    /** Ordner/Label, aus dem die Mail abgerufen wurde („[Gmail]/Alle Nachrichten“, „INBOX“, „Upload“). */
    ordner: text("ordner"),
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
    // Zähler „wichtig“ in der Seitenleiste läuft bei jedem Seitenaufruf – nur offene Mails im Index.
    index("emails_open_category_idx").on(t.tenantId, t.category).where(sql`archived = false`),
  ],
);

/**
 * Antwort-Entwürfe zu einer Mail (z. B. von Claude vorbereitet). Gesendet wird nur per Klick im Seller-System –
 * nie automatisch. `via`: claude | app (Fragefeld) | hand.
 */
export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: id(),
    tenantId: tenantId(),
    emailId: uuid("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    via: text("via").notNull().default("hand"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentFrom: text("sent_from"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("email_drafts_email_idx").on(t.tenantId, t.emailId)],
);
