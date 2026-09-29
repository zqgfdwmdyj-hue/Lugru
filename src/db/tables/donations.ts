import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, files, id, money, tenantId, updatedAt } from "./core";

// Spenden & Verteilung (Foodsharing): wiederkehrende Produkte mit Foto und Preis,
// Verteilungs-Aktionen mit ihren Produkten. Daraus entstehen Collagen und der Aushang.

export type CollageSettings = {
  perPage: number;
  format: "4:5" | "9:16" | "1:1" | "a4";
  fit: "contain" | "cover";
  showName: boolean;
  header: boolean;
};

export const donationProducts = pgTable(
  "donation_products",
  {
    id: id(),
    tenantId: tenantId(),
    /** z. B. „Getrocknete Tomaten“ – gleicher Name + Variante = gleiches Produkt. */
    name: text("name").notNull(),
    /** z. B. „5kg“, „8er Pack“, „Hot Winter 1,5kg“ – im Aushang als Unterpunkt. */
    variant: text("variant"),
    category: text("category").notNull().default("Lebensmittel"),
    /** Üblicher Spendenpreis; bei jeder Aktion überschreibbar. */
    price: money("price"),
    imageFileId: uuid("image_file_id").references(() => files.id, { onDelete: "set null" }),
    note: text("note"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("donation_products_name_idx").on(t.tenantId, t.name)],
);

export const donationEvents = pgTable(
  "donation_events",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull().default("Unsere Spendenempfehlungen"),
    subtitle: text("subtitle"),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    /** Freitext, z. B. „11 Uhr“. */
    eventTime: text("event_time"),
    location: text("location"),
    note: text("note"),
    collage: jsonb("collage").$type<Partial<CollageSettings>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("donation_events_date_idx").on(t.tenantId, t.eventDate)],
);

export const donationEventItems = pgTable(
  "donation_event_items",
  {
    id: id(),
    tenantId: tenantId(),
    eventId: uuid("event_id").notNull().references(() => donationEvents.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => donationProducts.id, { onDelete: "cascade" }),
    /** Preis bei dieser Aktion – bleibt für den Verlauf erhalten, auch wenn sich der Standardpreis ändert. */
    price: money("price"),
    /** Steht vor dem Preis, z. B. „je“ oder „3er Packung“. */
    priceNote: text("price_note"),
    /** Zusatztext auf der Collage, z. B. „Packung ohne Beschriftung“. */
    caption: text("caption"),
    /** Wie viel da ist (optional, für den Rückblick). */
    quantity: integer("quantity"),
    inCollage: boolean("in_collage").notNull().default(true),
    inFlyer: boolean("in_flyer").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("donation_event_items_uq").on(t.eventId, t.productId),
    index("donation_event_items_product_idx").on(t.tenantId, t.productId),
  ],
);
