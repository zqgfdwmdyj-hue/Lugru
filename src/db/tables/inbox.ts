import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
    /** Regel (Posteingang auf null), die beim Eingang gegriffen hat. */
    regelId: uuid("regel_id").references((): AnyPgColumn => mailRegeln.id, { onDelete: "set null" }),
    /** Antwort aus dem Gesendet-Ordner erkannt (extern beantwortet, z. B. am Handy) bzw. über das Seller-System gesendet. */
    beantwortetAm: timestamp("beantwortet_am", { withTimezone: true }),
    /** Postfach (und Name), aus dem geantwortet wurde. */
    beantwortetVon: text("beantwortet_von"),
    /** Message-IDs aus In-Reply-To/References – für den Verlauf (Antworten auf eigene ausgehende Mails). */
    antwortAuf: jsonb("antwort_auf").$type<string[]>().notNull().default([]),
    /** Diese Mail ist die Antwort auf eine eigene ausgehende Mail (Nachfassen erledigt). */
    ausgangId: uuid("ausgang_id"),
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

/**
 * Regeln je Absender/Thema (Posteingang auf null): automatisch archivieren, als Aufgabe anlegen oder an den
 * Zuständigen weiterleiten (Aufgabe mit Zuständigkeit). Alle angegebenen Bedingungen müssen passen.
 */
export const mailRegeln = pgTable(
  "mail_regeln",
  {
    id: id(),
    tenantId: tenantId(),
    /** Teil der Absenderadresse bzw. Domain („@dhl.de“, „newsletter@“). */
    absender: text("absender"),
    /** Betreff enthält. */
    betreff: text("betreff"),
    /** Thema der Einstufung (topic). */
    thema: text("thema"),
    aktion: text("aktion", { enum: ["archivieren", "aufgabe", "weiterleiten"] }).notNull(),
    zustaendigId: uuid("zustaendig_id").references(() => users.id, { onDelete: "set null" }),
    aktiv: boolean("aktiv").notNull().default(true),
    treffer: integer("treffer").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("mail_regeln_tenant_idx").on(t.tenantId)],
);

/**
 * Kontakte aus dem Mailverkehr: Festlegung je Absender (persönlich / geschäftlich / ignorieren) und Anrede (Sie/Du).
 * Adresse und Name verschlüsselt; gesucht wird über den Hash der kleingeschriebenen Adresse.
 */
export const mailKontakte = pgTable(
  "mail_kontakte",
  {
    id: id(),
    tenantId: tenantId(),
    adresseHash: text("adresse_hash").notNull(),
    adresse: text("adresse").notNull(),
    name: text("name"),
    /** persoenlich | geschaeftlich | ignorieren – null = noch nicht festgelegt (automatisch eingestuft). */
    art: text("art"),
    /** du | sie – aus früherem Schriftverkehr. */
    anrede: text("anrede"),
    /** Zuordnung ausgehender Mails: b2b_kunde | lieferant | persoenlich | sonst. */
    bezug: text("bezug"),
    festgelegtVon: uuid("festgelegt_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("mail_kontakte_uq").on(t.tenantId, t.adresseHash)],
);

/**
 * Postausgang (geschäftlich): aus dem Gesendet-Ordner gelesene bzw. über das System gesendete Mails. Mit `emailId`
 * ist es die Antwort auf eine eingegangene Mail; ohne ist es „ausgehend“ (neu angeschrieben) – mit Nachfassen.
 * Persönliche gesendete Mails liegen nur im Privatbereich, nie hier.
 */
export const mailAusgang = pgTable(
  "mail_ausgang",
  {
    id: id(),
    tenantId: tenantId(),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
    messageKey: text("message_key").notNull(),
    an: text("an").notNull(),
    anName: text("an_name"),
    betreff: text("betreff").notNull().default(""),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }).notNull(),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    /** Gesendet von: Postfach-Adresse und Absendername. */
    absender: text("absender"),
    absenderName: text("absender_name"),
    antwortAuf: jsonb("antwort_auf").$type<string[]>().notNull().default([]),
    /** Eingegangene Mail, auf die geantwortet wurde. */
    emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
    kontaktId: uuid("kontakt_id").references(() => mailKontakte.id, { onDelete: "set null" }),
    referenzen: jsonb("referenzen").$type<Record<string, string>>().notNull().default({}),
    /** Nachfassen: an diesem Tag Aufgabe, falls bis dahin keine Antwort kam. */
    nachfassenAm: text("nachfassen_am"),
    nachfassTaskId: uuid("nachfass_task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Antwort darauf eingegangen. */
    antwortEmailId: uuid("antwort_email_id").references(() => emails.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mail_ausgang_uq").on(t.tenantId, t.messageKey), index("mail_ausgang_email_idx").on(t.tenantId, t.emailId)],
);

/** Schon verarbeitete Message-IDs (Hash) – der Abruf lädt sie nicht noch einmal (auch ignorierte und persönliche). */
export const mailGesehen = pgTable(
  "mail_gesehen",
  {
    tenantId: tenantId(),
    keyHash: text("key_hash").notNull(),
    ergebnis: text("ergebnis").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mail_gesehen_uq").on(t.tenantId, t.keyHash)],
);
