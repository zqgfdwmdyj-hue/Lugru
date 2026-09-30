import { boolean, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { brands, ideas } from "./brands";
import { createdAt, files, id, money, products, tenantId, updatedAt } from "./core";

// Artikelstamm für eigene Produkte (z. B. Grulu-Boxen): alles an einem Ort – Stammdaten, Bilder,
// Listing-Texte, Pflichtangaben (Lebensmittel, GPSR) und der Stand je Kanal (Amazon, eBay …).

export const ARTICLE_STATUSES = ["entwurf", "aktiv", "archiv"] as const;

/** Hersteller bzw. verantwortliche Person (GPSR) – Pflicht für Angebote in der EU. */
export type Contact = { companyName?: string; addressLine1?: string; postalCode?: string; city?: string; country?: string; email?: string; phone?: string };

export type FoodInfo = { ingredients?: string; allergens?: string; nutrition?: string; storage?: string; bestBefore?: string; countryOfOrigin?: string; netQuantity?: string };

export type ChannelIssue = { severity: string; message: string; attributes?: string[] };

export type AmazonChannel = {
  /** Welches Verkäuferkonto: das Hauptkonto oder das zweite (z. B. GmbH der Marke). */
  account?: "haupt" | "zweit";
  productType?: string;
  fulfillment?: "FBA" | "FBM";
  quantity?: number;
  /** Zusätzliche Amazon-Attribute als JSON (für Sonderfälle, die das Formular nicht abdeckt). */
  extraAttributes?: string;
  lastCheck?: { at: string; mode: "pruefen" | "senden"; status: string; issues: ChannelIssue[] };
  status?: string;
  /** Das Listing wurde von hier angelegt (eigene Marke) – dann werden auch Texte/Bilder aktualisiert, nicht nur das Angebot. */
  ownListing?: boolean;
};

export type EbayChannel = { categoryId?: string; categoryName?: string; attemptId?: number; lastError?: string; sentAt?: string };

export const articles = pgTable(
  "articles",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ARTICLE_STATUSES }).notNull().default("entwurf"),
    ean: text("ean"),
    /** Kein EAN (Markeninhaber mit GTIN-Befreiung bei Amazon). */
    gtinExempt: boolean("gtin_exempt").notNull().default(false),
    asin: text("asin"),
    costPrice: money("cost_price"),
    price: money("price"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("19"),
    weightGrams: integer("weight_grams"),
    lengthCm: numeric("length_cm", { precision: 8, scale: 1 }),
    widthCm: numeric("width_cm", { precision: 8, scale: 1 }),
    heightCm: numeric("height_cm", { precision: 8, scale: 1 }),
    bullets: jsonb("bullets").$type<string[]>().notNull().default([]),
    description: text("description"),
    keywords: text("keywords"),
    /** Inhalt/Stückliste (z. B. „4× Airheads Blue Raspberry“). */
    contents: jsonb("contents").$type<string[]>().notNull().default([]),
    /** Artikelmerkmale „Name: Wert“ (für eBay-Merkmale und Amazon). */
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    food: jsonb("food").$type<FoodInfo>().notNull().default({}),
    manufacturer: jsonb("manufacturer").$type<Contact>().notNull().default({}),
    amazon: jsonb("amazon").$type<AmazonChannel>().notNull().default({}),
    ebay: jsonb("ebay").$type<EbayChannel>().notNull().default({}),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("articles_sku_uq").on(t.tenantId, t.sku), uniqueIndex("articles_idea_uq").on(t.ideaId), index("articles_brand_idx").on(t.tenantId, t.brandId)],
);

export const articleImages = pgTable(
  "article_images",
  {
    id: id(),
    tenantId: tenantId(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Zufallskennung für den öffentlichen Bild-Link (Amazon lädt Bilder per URL). */
    publicToken: text("public_token").notNull(),
    /** Von eBay gehostete Kopie (EPS), sobald einmal zu eBay geschickt. */
    ebayUrl: text("ebay_url"),
    createdAt: createdAt(),
  },
  (t) => [index("article_images_idx").on(t.articleId, t.position), uniqueIndex("article_images_token_uq").on(t.publicToken)],
);
