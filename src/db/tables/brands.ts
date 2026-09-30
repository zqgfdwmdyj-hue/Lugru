import { date, index, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt, users } from "./core";

// Eigene Marken (z. B. Grulu: Schultüten, US-Süßigkeiten, Themenboxen · Zeitlux: Uhren-Zubehör),
// Ideen bis zum Launch und Content-Planung (TikTok, YouTube, Instagram).

export const brands = pgTable(
  "brands",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** Was die Marke verkauft und wofür sie steht – Grundlage für die KI-Ideen. */
    description: text("description"),
    audience: text("audience"),
    priceRange: text("price_range"),
    /** Tonalität für Content, z. B. „frech, bunt, Familien“. */
    tone: text("tone"),
    /** Shop, TikTok, YouTube, Instagram … (eine Adresse pro Zeile). */
    links: text("links"),
    /** Welche Anlässe passen, mit Vorlauf in Wochen. */
    occasions: jsonb("occasions").$type<Record<string, number>>().notNull().default({}),
    /** Suchbegriffe für aktuelle Trends (Google News), eine pro Zeile. */
    trendTopics: text("trend_topics"),
    color: text("color"),
    /** Umsatzsteuer der Produkte in Prozent (Lebensmittel 7, sonst 19) – für die Kalkulation. */
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("19"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("brands_name_uq").on(t.tenantId, t.name)],
);

export const IDEA_STATUSES = ["idea", "review", "planned", "in_progress", "live", "rejected"] as const;
export const IDEA_KINDS = ["box", "product", "other"] as const;

export type ChecklistItem = { text: string; done: boolean };

export type MarketProduct = { asin: string; title: string; price: number | null; fbaFee: number | null; referralPct: number | null; monthlySold: number | null; salesRank: number | null; reviews: number | null };
export type MarketData = { source: "keepa" | "helium10"; term: string; fetchedAt: string; products: MarketProduct[] };

export const ideas = pgTable(
  "ideas",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: IDEA_KINDS }).notNull().default("box"),
    /** Anlass-Schlüssel (halloween, weihnachten …) oder leer für ganzjährig. */
    occasion: text("occasion"),
    title: text("title").notNull(),
    concept: text("concept"),
    /** Inhalt der Box bzw. Produktmerkmale. */
    contents: jsonb("contents").$type<string[]>().notNull().default([]),
    targetPrice: numeric("target_price", { precision: 10, scale: 2 }),
    costEstimate: numeric("cost_estimate", { precision: 10, scale: 2 }),
    /** Warum jetzt / Trend-Bezug (bei KI-Ideen). */
    why: text("why"),
    sourcing: text("sourcing"),
    status: text("status", { enum: IDEA_STATUSES }).notNull().default("idea"),
    launchDate: date("launch_date", { mode: "string" }),
    checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
    /** Vergleichsprodukte (Keepa oder Helium-10-Export) für die Kalkulation. */
    market: jsonb("market").$type<MarketData | null>(),
    notes: text("notes"),
    source: text("source", { enum: ["ai", "manual"] }).notNull().default("manual"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ideas_brand_idx").on(t.tenantId, t.brandId, t.status)],
);

export const CONTENT_STATUSES = ["idea", "filmed", "edited", "scheduled", "published"] as const;
export const CONTENT_PLATFORMS = ["tiktok", "youtube", "instagram"] as const;

export const contentPosts = pgTable(
  "content_posts",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    platform: text("platform", { enum: CONTENT_PLATFORMS }).notNull().default("tiktok"),
    format: text("format"),
    hook: text("hook").notNull(),
    script: text("script"),
    shots: jsonb("shots").$type<string[]>().notNull().default([]),
    caption: text("caption"),
    hashtags: text("hashtags"),
    soundIdea: text("sound_idea"),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("idea"),
    plannedFor: date("planned_for", { mode: "string" }),
    publishedUrl: text("published_url"),
    source: text("source", { enum: ["ai", "manual"] }).notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("content_brand_idx").on(t.tenantId, t.brandId, t.status)],
);

/** Eigene Produkte einer Marke (Amazon), täglich per Keepa aktualisiert. */
export type OwnProductData = MarketProduct & { rating: number | null; hasBuyBox: boolean; features: string[]; imageUrl: string | null };

export const brandProducts = pgTable(
  "brand_products",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    asin: text("asin").notNull(),
    data: jsonb("data").$type<OwnProductData | null>(),
    lastError: text("last_error"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    /** Letzter KI-Vorschlag für Titel und Stichpunkte. */
    aiListing: text("ai_listing"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brand_products_asin_uq").on(t.tenantId, t.asin)],
);

/** Tageswerte je eigenem Produkt – für Verläufe (Rang, Preis, Bewertungen). */
export const productSnapshots = pgTable(
  "product_snapshots",
  {
    tenantId: tenantId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => brandProducts.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    price: numeric("price", { precision: 10, scale: 2 }),
    salesRank: numeric("sales_rank", { precision: 12, scale: 0 }),
    monthlySold: numeric("monthly_sold", { precision: 12, scale: 0 }),
    reviews: numeric("reviews", { precision: 12, scale: 0 }),
    rating: numeric("rating", { precision: 3, scale: 1 }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.day] })],
);

export type TikTokMarketItem = { title: string; shop: string | null; price: number | null; sales: number | null; revenue: number | null; rating: number | null; reviews: number | null; videos: number | null; creators: number | null; url: string | null };

/** Importe aus Helium 10 (TikTok-Erweiterung), je Marke – Grundlage für Ideen und Shop-Optimierung. */
export const marketImports = pgTable(
  "market_imports",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    fileName: text("file_name"),
    items: jsonb("items").$type<TikTokMarketItem[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("market_imports_brand_idx").on(t.tenantId, t.brandId, t.createdAt)],
);
