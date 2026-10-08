import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, suppliers, tenantId, updatedAt } from "./core";

/** Wo ein Kontakt gerade steht – vom Registerfund bis zur Antwort. */
export const LEAD_STATUSES = ["neu", "geprueft", "entwurf", "angeschrieben", "antwort", "kein_interesse", "ausgeschlossen"] as const;
/** Einstufung nach der Prüfung (Vorab aus dem Register, danach per KI-Websuche). */
export const LEAD_KINDS = ["grosshandel", "haendler", "hersteller", "salon", "marktplatz", "privat", "unklar"] as const;

export type LeadEvidence = { label: string; value: string; url?: string };

/** Mögliche Bezugsquellen, z. B. aus dem Verpackungsregister (LUCID) zu einer Marke. */
export const supplierLeads = pgTable(
  "supplier_leads",
  {
    id: id(),
    tenantId: tenantId(),
    source: text("source").notNull().default("lucid"),
    /** Kennung in der Quelle (LUCID: ManufacturerId). */
    sourceId: text("source_id").notNull(),
    /** Gesuchte Marke(n), über die der Kontakt gefunden wurde. */
    searchBrands: jsonb("search_brands").$type<string[]>().notNull().default([]),
    companyName: text("company_name").notNull(),
    registerNumber: text("register_number"),
    street: text("street"),
    zip: text("zip"),
    city: text("city"),
    country: text("country"),
    phone: text("phone"),
    registeredAt: text("registered_at"),
    registrationEnd: text("registration_end"),
    isForeign: boolean("is_foreign").notNull().default(false),
    /** Alle im Register gemeldeten Marken; null = noch nicht geladen. */
    brands: jsonb("brands").$type<string[]>(),
    score: integer("score").notNull().default(0),
    kind: text("kind", { enum: LEAD_KINDS }).notNull().default("unklar"),
    status: text("status", { enum: LEAD_STATUSES }).notNull().default("neu"),
    /** Ergebnis der KI-Websuche. */
    website: text("website"),
    email: text("email"),
    b2bUrl: text("b2b_url"),
    sellsBrand: boolean("sells_brand"),
    summary: text("summary"),
    evidence: jsonb("evidence").$type<LeadEvidence[]>().notNull().default([]),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkError: text("check_error"),
    /** Läuft gerade eine Prüfung oder ein Entwurf im Hintergrund? */
    busy: text("busy"),
    mailLanguage: text("mail_language"),
    mailSubject: text("mail_subject"),
    mailBody: text("mail_body"),
    mailedAt: timestamp("mailed_at", { withTimezone: true }),
    mailedTo: text("mailed_to"),
    mailError: text("mail_error"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("supplier_leads_src_uq").on(t.tenantId, t.source, t.sourceId),
    index("supplier_leads_status_idx").on(t.tenantId, t.status),
  ],
);
