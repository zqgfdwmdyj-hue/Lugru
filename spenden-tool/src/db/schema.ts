import { boolean, customType, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Spenden-Tool: wiederkehrende Produkte mit Foto und Preis, Verteilungen mit ihren Produkten,
// daraus Collagen, Aushang und Messenger-Text. Dazu KI-Preisrecherche im Internet.

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Beträge als Zahl in JS, numeric in der Datenbank. */
export const money = (name: string) =>
  customType<{ data: number; driverData: string }>({
    dataType: () => "numeric(12, 2)",
    fromDriver: (v) => Number(v),
    toDriver: (v) => String(v),
  })(name);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Lage eines aufgedruckten Preises im Foto, als Anteil von Breite/Höhe (0–1). */
export type PriceBox = { x: number; y: number; w: number; h: number };
export const PRINTED_STATUSES = ["pending", "done", "error"] as const;

export type CollageSettings = {
  perPage: number;
  format: "4:5" | "9:16" | "1:1" | "a4";
  fit: "contain" | "cover";
  showName: boolean;
  header: boolean;
};

/** Hochgeladene Fotos – in der Datenbank, damit eine Sicherung alles enthält. */
export const files = pgTable(
  "files",
  {
    id: id(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    /**
     * Preis, der schon auf dem Foto steht (z. B. alte Collage-Bilder mit „60 Cent“). Dann druckt die Collage
     * keinen zweiten Preis darüber – bei abweichendem Preis wird der alte an dieser Stelle überdeckt.
     */
    printedStatus: text("printed_status", { enum: PRINTED_STATUSES }),
    printedPrice: money("printed_price"),
    printedPriceText: text("printed_price_text"),
    printedPriceBox: jsonb("printed_price_box").$type<PriceBox>(),
    printedScannedAt: timestamp("printed_scanned_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("files_sha_idx").on(t.sha256)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    /** z. B. „Getrocknete Tomaten“ */
    name: text("name").notNull(),
    /** z. B. „5kg“, „8er Pack“ – im Aushang als Unterpunkt. */
    variant: text("variant"),
    category: text("category").notNull().default("Lebensmittel"),
    /** Zuletzt verwendeter Spendenpreis – Vorschlag für die nächste Verteilung. */
    price: money("price"),
    imageFileId: uuid("image_file_id").references(() => files.id, { onDelete: "set null" }),
    note: text("note"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_name_idx").on(t.name)],
);

export const events = pgTable(
  "events",
  {
    id: id(),
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
  (t) => [index("events_date_idx").on(t.eventDate)],
);

export const eventItems = pgTable(
  "event_items",
  {
    id: id(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** Preis bei dieser Verteilung – bleibt für den Rückblick erhalten. */
    price: money("price"),
    /** Steht vor dem Preis, z. B. „je“ oder „3er Packung“. */
    priceNote: text("price_note"),
    /** Zusatztext auf der Collage. */
    caption: text("caption"),
    quantity: integer("quantity"),
    /** Mindesthaltbarkeitsdatum dieser Charge – steht im Aushang, nicht auf der Collage. */
    bestBefore: date("best_before", { mode: "string" }),
    /** Foto vom aufgedruckten MHD – nur zum Ablesen, erscheint nie auf Collage oder Social Media. */
    bestBeforeFileId: uuid("best_before_file_id").references(() => files.id, { onDelete: "set null" }),
    inCollage: boolean("in_collage").notNull().default(true),
    inFlyer: boolean("in_flyer").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("event_items_uq").on(t.eventId, t.productId), index("event_items_product_idx").on(t.productId)],
);

export type ShopOffer = { shop: string; title: string; price: number; url: string; unit?: string | null };
export const PRICE_CHECK_STATUSES = ["pending", "running", "done", "error"] as const;

/** KI-Preisrecherche: Was ist das Produkt, und was kostet es im Handel? */
export const priceChecks = pgTable(
  "price_checks",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    status: text("status", { enum: PRICE_CHECK_STATUSES }).notNull().default("pending"),
    /** erkennen | sparsam | genau – siehe src/lib/ai-modes.ts */
    mode: text("mode").notNull().default("genau"),
    /** Was die KI auf dem Foto erkannt hat. */
    recognizedName: text("recognized_name"),
    recognizedVariant: text("recognized_variant"),
    recognizedCategory: text("recognized_category"),
    offers: jsonb("offers").$type<ShopOffer[]>().notNull().default([]),
    lowestPrice: money("lowest_price"),
    /** Vorschlag für den Spendenpreis. */
    suggestedPrice: money("suggested_price"),
    summary: text("summary"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    searches: integer("searches"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("price_checks_product_idx").on(t.productId, t.createdAt)],
);
