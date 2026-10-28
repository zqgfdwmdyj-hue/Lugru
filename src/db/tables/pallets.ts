import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, money, tenantId, updatedAt, users } from "./core";
import { encryptedText } from "./encrypted";

/**
 * Eingelagerte Paletten (Palettenstellplätze für Kunden). Ab `inAt` läuft die Lagerzeit,
 * mit `outAt` ist die Palette ausgelagert. Eine Nummer ist nur einmal gleichzeitig eingelagert
 * und kann nach dem Auslagern wieder benutzt werden.
 */
export const pallets = pgTable(
  "pallets",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    customer: text("customer"),
    note: text("note"),
    /** Stellplatz im Lager, z. B. „B-03“. */
    location: text("location"),
    /** Was draufsteht, z. B. „48 Kartons Shampoo“. */
    contents: text("contents"),
    weightKg: money("weight_kg"),
    inAt: date("in_at").notNull(),
    outAt: date("out_at"),
    /** Fehlbuchung storniert: bleibt mit Verlauf erhalten, zählt aber nirgends mehr. */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("pallets_open_code_uq").on(t.tenantId, t.code).where(sql`${t.outAt} is null`),
    index("pallets_in_idx").on(t.tenantId, t.inAt),
  ],
);

/** Fotos je Palette (Zustand, Lieferschein). Bei mehreren Paletten auf einmal teilen sie sich die Datei. */
export const palletPhotos = pgTable(
  "pallet_photos",
  {
    id: id(),
    tenantId: tenantId(),
    palletId: uuid("pallet_id")
      .notNull()
      .references(() => pallets.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("pallet_photos_pallet_idx").on(t.palletId)],
);

/**
 * Kunden des Palettenlagers mit eigenen Konditionen. Leere Felder = Standard aus den Einstellungen.
 * Verknüpft über den Namen (pallets.customer), Groß/Klein egal.
 */
export const palletCustomers = pgTable(
  "pallet_customers",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    email: text("email"),
    pricePerMonth: money("price_per_month"),
    freeDays: integer("free_days"),
    mode: text("mode", { enum: ["monat", "anteilig"] }),
    inFee: money("in_fee"),
    outFee: money("out_fee"),
    /** Frühere Konditionen (gültig bis einschließlich Monat `until`) – Preisänderungen wirken nicht rückwirkend. */
    rateHistory: jsonb("rate_history").$type<RateVersion[]>().notNull().default([]),
    /** Monatsaufstellung am Monatsanfang automatisch per Mail senden. */
    monthlyMail: boolean("monthly_mail").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pallet_customers_name_uq").on(t.tenantId, sql`lower(${t.name})`)],
);

/** Zusatzleistungen (Folieren, Umpacken …) – landen in der Monatsabrechnung des Kunden. */
export const palletCharges = pgTable(
  "pallet_charges",
  {
    id: id(),
    tenantId: tenantId(),
    palletId: uuid("pallet_id").references(() => pallets.id, { onDelete: "set null" }),
    customer: text("customer").notNull(),
    day: date("day").notNull(),
    description: text("description").notNull(),
    quantity: money("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("pallet_charges_day_idx").on(t.tenantId, t.day)],
);

/** Gesendete Monatsaufstellungen – damit nichts doppelt rausgeht. */
export const palletStatements = pgTable(
  "pallet_statements",
  {
    id: id(),
    tenantId: tenantId(),
    customer: text("customer").notNull(),
    month: text("month").notNull(),
    recipient: text("recipient"),
    total: money("total"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    auto: boolean("auto").notNull().default(false),
    error: text("error"),
    /** In Rechnung gestellt (Rechnungsnummer) und bezahlt – getrennt vom Versand der Aufstellung. */
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    invoiceNo: text("invoice_no"),
    /** Betrag (netto) beim Stellen der Rechnung – ändert sich die Abrechnung danach, wird gewarnt. */
    invoicedTotal: money("invoiced_total"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pallet_statements_uq").on(t.tenantId, sql`lower(${t.customer})`, t.month)],
);

/** Abholung mehrerer Paletten auf einmal – mit Abholschein und Unterschrift des Abholers. */
export const palletPickups = pgTable(
  "pallet_pickups",
  {
    id: id(),
    tenantId: tenantId(),
    customer: text("customer"),
    day: date("day").notNull(),
    pickedBy: text("picked_by").notNull(),
    plate: text("plate"),
    note: text("note"),
    palletIds: jsonb("pallet_ids").$type<string[]>().notNull(),
    codes: jsonb("codes").$type<string[]>().notNull(),
    /** Unterschrift als PNG (files). */
    signatureFileId: uuid("signature_file_id").references(() => files.id, { onDelete: "set null" }),
    /** Abholung zurückgenommen (Paletten wieder im Lager) – Abholschein bleibt als storniert erhalten. */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("pallet_pickups_day_idx").on(t.tenantId, t.day)],
);

export const PALLET_EVENT_KINDS = ["ein", "aus", "abholung", "zurueck", "korrektur", "umlagern", "storno", "inventur", "leistung", "foto"] as const;
export type PalletEventKind = (typeof PALLET_EVENT_KINDS)[number];

/** Buchungsverlauf je Palette: jede Ein-/Auslagerung, Korrektur und Inventur – nichts wird still überschrieben. */
export const palletEvents = pgTable(
  "pallet_events",
  {
    id: id(),
    tenantId: tenantId(),
    palletId: uuid("pallet_id")
      .notNull()
      .references(() => pallets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: PALLET_EVENT_KINDS }).notNull(),
    /** Fachlicher Tag (z. B. Auslagerungstag), falls abweichend vom Buchungszeitpunkt. */
    day: date("day"),
    text: text("text").notNull(),
    userName: text("user_name"),
    createdAt: createdAt(),
  },
  (t) => [index("pallet_events_pallet_idx").on(t.palletId, t.createdAt)],
);

/** Konditionen, die bis einschließlich `until` (JJJJ-MM) galten. */
export type RateVersion = { until: string; pricePerMonth: number | null; freeDays: number | null; mode: "monat" | "anteilig" | null; inFee: number | null; outFee: number | null };

export const SHIPMENT_DIRECTIONS = ["ein", "aus"] as const;
export const SHIPMENT_STATUSES = ["geplant", "unterwegs", "verzoegert", "zugestellt", "problem", "storniert"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Sendungen per Spedition oder Paketdienst: Anlieferung ins Lager („ein“) oder Versand an einen Kunden („aus“),
 * Paletten oder Kartons. `plannedDate` ist der aktuell erwartete Tag, `firstDate` der zuerst genannte –
 * jede Verschiebung steht im Verlauf (pallet_shipment_events).
 */
export const palletShipments = pgTable(
  "pallet_shipments",
  {
    id: id(),
    tenantId: tenantId(),
    direction: text("direction", { enum: SHIPMENT_DIRECTIONS }).notNull(),
    /** Kunde des Palettenlagers (wie pallets.customer), optional. */
    customer: text("customer"),
    /** Kurzbezeichnung, z. B. „12 Paletten Shampoo“ oder Auftragsnummer. */
    title: text("title").notNull(),
    /** Von wo (Anlieferung) bzw. wohin (Versand) – Ort oder Firma. */
    place: text("place"),
    /** Schlüssel aus der Spediteursliste (dhl, schenker …) oder „andere“. */
    carrier: text("carrier").notNull(),
    /** Name bei „andere“. */
    carrierName: text("carrier_name"),
    trackingNo: text("tracking_no"),
    /** Eigener Link zur Sendungsverfolgung (z. B. aus der Mail des Spediteurs). */
    trackingUrl: text("tracking_url"),
    palletCount: integer("pallet_count"),
    cartonCount: integer("carton_count"),
    plannedDate: date("planned_date"),
    /** Zeitfenster, z. B. „8–12 Uhr“. */
    plannedTime: text("planned_time"),
    firstDate: date("first_date"),
    status: text("status", { enum: SHIPMENT_STATUSES }).notNull().default("geplant"),
    /** Wo ist die Sendung gerade (letzte Meldung, z. B. „Im Depot Nürnberg“) – auch für den Kunden sichtbar. */
    location: text("location"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Interne Notiz – nie im Kunden-Link. */
    note: text("note"),
    /** Automatische Sendungsverfolgung (DHL) – letzter Abruf und Fehler. */
    trackedAt: timestamp("tracked_at", { withTimezone: true }),
    trackError: text("track_error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pallet_shipments_tenant_idx").on(t.tenantId, t.status, t.plannedDate)],
);

export const SHIPMENT_EVENT_KINDS = ["angelegt", "termin", "status", "standort", "foto", "link", "notiz", "geaendert", "automatisch", "ueberfaellig"] as const;
export type ShipmentEventKind = (typeof SHIPMENT_EVENT_KINDS)[number];

/**
 * Verlauf je Sendung. `notice` = Meldung für alle mit Zugriff aufs Palettenlager (Termin verschoben,
 * angekommen, Problem …); `internal` = nie im Kunden-Link (Notizen, Links, Änderungen).
 */
export const palletShipmentEvents = pgTable(
  "pallet_shipment_events",
  {
    id: id(),
    tenantId: tenantId(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => palletShipments.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SHIPMENT_EVENT_KINDS }).notNull(),
    text: text("text").notNull(),
    oldDate: date("old_date"),
    newDate: date("new_date"),
    status: text("status", { enum: SHIPMENT_STATUSES }),
    notice: boolean("notice").notNull().default(false),
    internal: boolean("internal").notNull().default(false),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name"),
    createdAt: createdAt(),
  },
  (t) => [index("pallet_shipment_events_idx").on(t.shipmentId, t.createdAt), index("pallet_shipment_notices_idx").on(t.tenantId, t.notice, t.createdAt)],
);

/** Fotos zur Sendung (verladene Paletten, Lieferschein, Schaden). `shared` = im Kunden-Link sichtbar. */
export const palletShipmentPhotos = pgTable(
  "pallet_shipment_photos",
  {
    id: id(),
    tenantId: tenantId(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => palletShipments.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    shared: boolean("shared").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("pallet_shipment_photos_idx").on(t.shipmentId)],
);

/**
 * Befristete Links für Kunden (ohne Anmeldung). Gesucht wird über den Hash; der Link selbst liegt
 * verschlüsselt, damit man ihn später noch einmal kopieren kann.
 */
export const palletShipmentLinks = pgTable(
  "pallet_shipment_links",
  {
    id: id(),
    tenantId: tenantId(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => palletShipments.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    token: encryptedText("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    showPhotos: boolean("show_photos").notNull().default(true),
    views: integer("views").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pallet_shipment_links_hash_uq").on(t.tokenHash), index("pallet_shipment_links_ship_idx").on(t.shipmentId)],
);
