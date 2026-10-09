import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, suppliers, tenantId, updatedAt } from "./core";

/** Wo ein Kontakt gerade steht – vom Registerfund bis zur Antwort. */
export const LEAD_STATUSES = ["neu", "geprueft", "entwurf", "angeschrieben", "antwort", "follow_up", "preisliste", "abgeschlossen", "kein_interesse", "ausgeschlossen"] as const;
/** Einstufung nach der Prüfung (Vorab aus dem Register, danach per KI-Websuche). */
export const LEAD_KINDS = ["grosshandel", "haendler", "hersteller", "salon", "marktplatz", "privat", "unklar"] as const;

export type LeadEvidence = { label: string; value: string; url?: string };
/** Wo eine Firma gefunden wurde (eine Firma kann in mehreren Quellen auftauchen). */
export const LEAD_SOURCES = ["lucid", "amazon", "ebay", "gpsr", "web", "messe"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadFinding = { source: LeadSource; label: string; detail?: string; url?: string; brand?: string; at: string };

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
    /** Fundstellen: Register, Amazon-/eBay-Verkäufer, GPSR-Angaben, Websuche. */
    findings: jsonb("findings").$type<LeadFinding[]>().notNull().default([]),
    vatId: text("vat_id"),
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
    /** Nachfass-Mail gesendet. */
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    /** Von Hand aufs Board gelegt (Spalte „Zu kontaktieren“). */
    onBoard: boolean("on_board").notNull().default(false),
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

/** Suchläufe je Marke und Quelle – laufen im Hintergrund, die Seite zeigt den Stand. */
export const supplierLeadSearches = pgTable(
  "supplier_lead_searches",
  {
    id: id(),
    tenantId: tenantId(),
    brand: text("brand").notNull(),
    source: text("source", { enum: LEAD_SOURCES }).notNull(),
    status: text("status", { enum: ["laeuft", "fertig", "fehler"] }).notNull().default("laeuft"),
    message: text("message"),
    found: integer("found").notNull().default(0),
    created: integer("created").notNull().default(0),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("supplier_lead_searches_idx").on(t.tenantId, t.startedAt)],
);
