import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, money, tenantId, updatedAt } from "./core";

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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pallet_statements_uq").on(t.tenantId, sql`lower(${t.customer})`, t.month)],
);
