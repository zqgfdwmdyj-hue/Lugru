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
    /** Fingerabdruck zum Wiedererkennen desselben Fotos (auch verkleinert/neu gespeichert), siehe lib/image-hash.ts. */
    phash: text("phash"),
    /**
     * Preis, der schon auf dem Foto steht (z. B. alte Collage-Bilder mit „60 Cent“). Dann druckt die Collage
     * keinen zweiten Preis darüber – bei abweichendem Preis wird der alte an dieser Stelle überdeckt.
     */
    printedStatus: text("printed_status", { enum: PRINTED_STATUSES }),
    printedPrice: money("printed_price"),
    printedPriceText: text("printed_price_text"),
    printedPriceBox: jsonb("printed_price_box").$type<PriceBox>(),
    printedScannedAt: timestamp("printed_scanned_at", { withTimezone: true }),
    /** Jemand hat „Erkennung falsch“ gewählt – auch „Alle neu lesen“ liest dieses Foto nicht erneut. */
    printedRejected: boolean("printed_rejected").notNull().default(false),
    /** Womit gelesen: 1 = erste Version, 2 = verbesserter Leser, 9 = von Hand eingetragen (siehe lib/photo-price.ts). */
    printedReader: integer("printed_reader"),
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
    /** Ist dieser Preis von einem Menschen eingetragen/bestätigt? (Fotoerkennung/KI-Stapel: nein) */
    priceConfirmed: boolean("price_confirmed").notNull().default(true),
    imageFileId: uuid("image_file_id").references(() => files.id, { onDelete: "set null" }),
    /** Lage und Farbe des Preises auf der Collage (siehe TileStyle in lib/layout.ts). */
    collageStyle: jsonb("collage_style").$type<{ pos?: string; color?: string; name?: boolean; price?: boolean; caption?: boolean }>().notNull().default({}),
    note: text("note"),
    /** Von der KI eingetragen und noch nicht von einem Menschen bestätigt (z. B. „Name von der KI · Packungsgröße unsicher“). null = bestätigt. */
    reviewNote: text("review_note"),
    /** Ist ein MHD nötig? null = nach Kategorie (Lebensmittel, Getränke, Babyprodukte), "ja" / "nein" = festgelegt. */
    mhdMode: text("mhd_mode", { enum: ["ja", "nein"] }),
    /** Kategorie von einem Menschen geprüft („Kategorie stimmt“ oder selbst gewählt) – dann keine Auffälligkeit mehr. */
    categoryChecked: boolean("category_checked").notNull().default(false),
    /** Produkte, die ausdrücklich NICHT dasselbe sind (z. B. „Sind verschiedene Produkte“ bei möglicher Rückseite). */
    distinctFrom: jsonb("distinct_from").$type<string[]>().notNull().default([]),
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
    /** Ausgewählte Highlights für Social Media (IDs der Verteilungs-Einträge, in dieser Reihenfolge). */
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
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
    /** Steht vor dem Preis, z. B. „je“ oder „3er Packung“ – freier Text, überschreibt die Anzeige der Abgabeeinheit. */
    priceNote: text("price_note"),
    /** Worauf sich die Spendenempfehlung bezieht: Einzelstück, Mehrfachpackung oder Karton (siehe lib/price-logic.ts). */
    unit: text("unit", { enum: ["stueck", "packung", "karton"] }),
    /** Stück je Packung bzw. Karton, z. B. 6 beim 6er-Pack. */
    unitCount: integer("unit_count"),
    /** Abgabeeinheit von einem Menschen festgelegt/bestätigt – getrennt vom Preis. */
    unitConfirmed: boolean("unit_confirmed").notNull().default(false),
    /** Woher der Preis kommt: manuell, foto (aus dem Foto gelesen), ki (KI-Vorschlag), vorlage (aus früherer Verteilung). */
    priceSource: text("price_source", { enum: ["manuell", "foto", "ki", "vorlage"] }),
    /** Von einem Menschen eingetragen oder bestätigt – unbestätigte Werte erscheinen unter „Prüfen“. */
    priceConfirmed: boolean("price_confirmed").notNull().default(false),
    /**
     * Preiswiderspruch mit dem Foto bewusst gelöst: „eingetragener Preis gilt“ für dieses Foto (Datei-ID). Die Collage
     * klebt den eingetragenen Preis dann über den alten. Ein neues Foto bringt die Frage wieder.
     */
    priceOverPhotoFileId: uuid("price_over_photo_file_id"),
    /** Zusätzliche Spendenempfehlung für eine ganze Packung, z. B. „ganzer Karton“ für 5 €. */
    packNote: text("pack_note"),
    packPrice: money("pack_price"),
    /** Art der ganzen Packung: Karton, Kasten (Getränke), Packung, Tray, Palette – siehe lib/price-logic.ts PACK_KINDS. */
    packKind: text("pack_kind", { enum: ["karton", "kasten", "packung", "tray", "palette"] }),
    /** Stück bzw. Flaschen in der ganzen Packung, z. B. 12 Flaschen im Kasten. */
    packCount: integer("pack_count"),
    /** Weitere Varianten neben Einzelpreis und ganzer Packung, z. B. „Packung (6 St.) 2 €“ und „Karton (24 St.) 5 €“. */
    morePacks: jsonb("more_packs").$type<MorePack[]>().notNull().default([]),
    /** Wie viel ist ungefähr da? (Palette, halbe/viertel Palette, mehrere Kartons, Einzelprodukt, wenige/Reste) */
    stock: text("stock", { enum: ["palette", "halbe-palette", "viertel-palette", "kartons", "einzeln", "reste"] }),
    /** Wie lief es? Nach der Verteilung erfasst – Grundlage der Statistik. */
    outcome: text("outcome", { enum: ["weg", "wenig", "viel"] }),
    /** Woher das MHD kommt: „foto-ki“ = automatisch von einem Foto gelesen (bitte kurz prüfen). */
    bestBeforeSource: text("best_before_source"),
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

/** Eine weitere Abgabe-Variante (Packung, Karton …) mit eigener Spendenempfehlung. */
export type MorePack = { kind: "karton" | "kasten" | "packung" | "tray" | "palette" | null; count: number | null; price: number | null; note: string | null };

/** count: Stück/Flaschen im Angebot (z. B. 12 beim Kasten) – price ist immer der Preis des ganzen Angebots. */
export type ShopOffer = { shop: string; title: string; price: number; url: string; unit?: string | null; count?: number | null };
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
    /** Zeigt das Foto die Vorder- oder Rückseite? (KI) */
    recognizedSide: text("recognized_side"),
    /** Die KI sieht mehrere verschiedene Produkte auf dem Foto (z. B. Bonbons und Kaugummis) – bitte einzeln fotografieren. */
    multipleProducts: boolean("multiple_products").notNull().default(false),
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

/** Eigene Zugänge pro Person. Solange es keinen Admin gibt, gilt das Team-Passwort (APP_PASSWORD). */
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  /** Anmeldename, klein geschrieben */
  login: text("login").notNull().unique(),
  /** Optional – Anmeldung auch mit der E-Mail-Adresse (wie im Seller-Tool) */
  email: text("email").unique(),
  /** scrypt, siehe lib/password.ts */
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Wer hat wann was getan – für Rückfragen im Team. */
export const activity = pgTable(
  "activity",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Name zum Zeitpunkt der Aktion (bleibt auch, wenn der Zugang gelöscht wird) */
    userName: text("user_name").notNull(),
    action: text("action").notNull(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("activity_created_idx").on(t.createdAt), index("activity_event_idx").on(t.eventId, t.createdAt)],
);

export type IdeaPackage = { name: string; beschreibung: string; produkte: string[] };
export type IdeaRecipe = { name: string; aus_der_verteilung: string[]; zusaetzlich: string[]; anleitung: string; dauer?: string | null };
export const POSTER_THEMES = ["winter", "herbst", "halloween", "weihnachten", "fruehling", "ostern", "sommer", "allgemein"] as const;
export type IdeaPoster = {
  thema: (typeof POSTER_THEMES)[number];
  titel: string;
  untertitel: string;
  notiz: string;
  /** Produktnamen für die großen Kacheln */
  hervorgehoben: string[];
  gruppen: { titel: string; text: string; produkte: string[] }[];
  schluss: string;
};
export type IdeaResult = { titel: string; einleitung: string; pakete: IdeaPackage[]; rezepte: IdeaRecipe[]; aktionstext: string; tipps: string[]; plakat?: IdeaPoster | null; verwendung?: { produkt: string; ideen: string[] }[] };

/** KI-Ideen zu einer Verteilung (Themenpakete, Rezepte, Werbetext) – bleiben zum Nachlesen gespeichert. */
export const eventIdeas = pgTable(
  "event_ideas",
  {
    id: id(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    /** Gewählte Themen bzw. eigener Wunsch */
    request: text("request").notNull(),
    result: jsonb("result").$type<IdeaResult>().notNull(),
    userName: text("user_name"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [index("event_ideas_event_idx").on(t.eventId, t.createdAt)],
);

/** Einstellungen fürs ganze Team, z. B. Collage-Vorlage für neue Verteilungen oder Account und Hashtags für Social Media. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/**
 * Weitere Fotos eines Produkts, z. B. die Rückseite mit Zutaten, Gewicht oder MHD. Erscheinen nie auf Collage oder
 * Social Media – nur als Information (und für die KI-Erkennung).
 */
export const productPhotos = pgTable(
  "product_photos",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["rueckseite", "info"] }).notNull().default("rueckseite"),
    createdAt: createdAt(),
  },
  (t) => [index("product_photos_product_idx").on(t.productId), uniqueIndex("product_photos_uq").on(t.productId, t.fileId)],
);
