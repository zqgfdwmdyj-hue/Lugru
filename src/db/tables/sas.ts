import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, tasks, tenantId, updatedAt } from "./core";

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
    invoices: integer("invoices"),
    supplierOffers: integer("supplier_offers"),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sas_brands_uq").on(t.tenantId, t.brandKey)],
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

