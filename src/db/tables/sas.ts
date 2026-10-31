import { boolean, date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, tasks, tenantId, updatedAt, users } from "./core";
import { invoices } from "./invoices";

// Amazon SAS-Programm (Strategic Account Services, Reseller): Programm-Stand, Aufgaben (an die normalen
// Aufgaben gekoppelt, damit sie auf der Startseite erscheinen), Marken für den Authorized-Reseller-Audit,
// Black-Week-Deals und Unterlagen. Kontaktdaten trägt der Nutzer selbst ein – nichts davon steht im Code.

export const SAS_MODULES = ["reseller", "deals", "portfolio", "paneu", "support", "termin", "sonstiges"] as const;
export const SAS_WAITING = ["ich", "consultant", "amazon"] as const;
export const SAS_BRAND_STATUS = ["offen", "ausgewaehlt", "eingereicht", "audit", "bestaetigt", "abgelehnt"] as const;
export const SAS_DEAL_STATUS = ["pruefen", "ja", "nein", "eingereicht"] as const;

/** Stand des Programms je Mandant (eine Zeile). */
export const sasProgram = pgTable("sas_program", {
  tenantId: tenantId().primaryKey(),
  consultantName: text("consultant_name"),
  consultantEmail: text("consultant_email"),
  pstamName: text("pstam_name"),
  nextMeeting: date("next_meeting", { mode: "string" }),
  dealDeadline: date("deal_deadline", { mode: "string" }),
  /** Authorized-Reseller-Pilot: Auswahl → eingereicht → Audit → bestätigt/abgelehnt. */
  pilotStatus: text("pilot_status", { enum: ["auswahl", "eingereicht", "audit", "bestaetigt", "abgelehnt"] }).notNull().default("auswahl"),
  pilotSubmittedAt: date("pilot_submitted_at", { mode: "string" }),
  notes: text("notes"),
  updatedAt: updatedAt(),
});

/** SAS-Zusatzangaben zu einer normalen Aufgabe (Titel, Fälligkeit, Status stehen in tasks). */
export const sasItems = pgTable(
  "sas_items",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    module: text("module", { enum: SAS_MODULES }).notNull().default("sonstiges"),
    /** Wer ist dran: ich, der Consultant oder Amazon (Audit-/Appeal-Team). */
    waitingOn: text("waiting_on", { enum: SAS_WAITING }).notNull().default("ich"),
    /** Schritt aus dem Standard-Fahrplan (verhindert Doppel beim erneuten Anlegen). */
    templateKey: text("template_key"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("sas_items_tenant_idx").on(t.tenantId), uniqueIndex("sas_items_template_uq").on(t.tenantId, t.templateKey)],
);

/** Marken aus der Liste des Consultants; Auswahl für den Authorized-Reseller-Audit. */
export const sasBrands = pgTable(
  "sas_brands",
  {
    id: id(),
    tenantId: tenantId(),
    brand: text("brand").notNull(),
    brandKey: text("brand_key").notNull(),
    selected: boolean("selected").notNull().default(false),
    status: text("status", { enum: SAS_BRAND_STATUS }).notNull().default("offen"),
    note: text("note"),
    /** Kennzahlen (beim Import bzw. „Neu berechnen“): Produkte und Umsatz laut sellerboard, Belege. */
    products: integer("products"),
    sales30: numeric("sales30", { precision: 14, scale: 2 }),
    units30: integer("units30"),
    /** Zeilen der 30-Tage-Auswertung mit der Marke (auch ohne Verkauf): 0 + keine Produkte = „keine Daten“. */
    salesRows: integer("sales_rows"),
    invoices: integer("invoices"),
    /** davon vom Nutzer bestätigt bzw. mit Hinweis „prüfen“ (noch nicht bestätigt) */
    invoicesConfirmed: integer("invoices_confirmed"),
    invoicesUnsure: integer("invoices_unsure"),
    supplierOffers: integer("supplier_offers"),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sas_brands_uq").on(t.tenantId, t.brandKey)],
);

/** Entscheidung des Nutzers, ob ein gefundener Beleg wirklich zur Marke gehört („falsch“ zählt nicht mehr). */
export const sasBrandEvidence = pgTable(
  "sas_brand_evidence",
  {
    tenantId: tenantId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => sasBrands.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    verdict: text("verdict", { enum: ["stimmt", "falsch"] }).notNull(),
    checkedBy: uuid("checked_by").references(() => users.id, { onDelete: "set null" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.invoiceId] }), index("sas_brand_evidence_tenant_idx").on(t.tenantId)],
);

/** Berechtigte ASINs für Deals (Liste des Consultants) mit Mindestrabatt. */
export const sasDeals = pgTable(
  "sas_deals",
  {
    id: id(),
    tenantId: tenantId(),
    asin: text("asin").notNull(),
    title: text("title"),
    minDiscountPct: numeric("min_discount_pct", { precision: 6, scale: 2 }),
    dealType: text("deal_type"),
    status: text("status", { enum: SAS_DEAL_STATUS }).notNull().default("pruefen"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sas_deals_uq").on(t.tenantId, t.asin)],
);

/** Unterlagen zum Programm (Präsentation, Markenliste, Audit-Nachweise). Datei verschlüsselt in files. */
export const sasDocuments = pgTable(
  "sas_documents",
  {
    id: id(),
    tenantId: tenantId(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["praesentation", "markenliste", "asin_liste", "nachweis", "sonstiges"] }).notNull().default("sonstiges"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("sas_documents_tenant_idx").on(t.tenantId)],
);

