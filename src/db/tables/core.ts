import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Grundsatz: Jede fachliche Tabelle hat eine tenant_id. Heute gibt es nur einen
// Mandanten, das Datenmodell ist aber von Anfang an für mehrere ausgelegt.

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Beträge als Zahl in JS, numeric in der Datenbank. */
export const money = (name: string) =>
  customType<{ data: number; driverData: string }>({
    dataType: () => "numeric(14, 4)",
    fromDriver: (v) => Number(v),
    toDriver: (v) => String(v),
  })(name);

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const CLAIM_TYPES = [
  "inbound_shortage",
  "lost_warehouse",
  "damaged_warehouse",
  "reimbursed_below_cost",
  "return_not_received",
  "disposed_without_order",
  "removal_incomplete",
  "return_damaged",
  "return_wrong_item",
  "refund_too_high",
  "fbm_safet",
  "other",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export type Address = {
  name1?: string;
  name2?: string;
  street?: string;
  houseNo?: string;
  zip?: string;
  city?: string;
  country?: string; // ISO-3, z. B. DEU
  email?: string;
  phone?: string;
};

export type TenantSettings = {
  /** MwSt-Satz, mit dem Brutto-EK aus SKUs in Netto umgerechnet wird. */
  vatRate?: number;
  /** Nach so vielen Tagen ohne Einkaufs-Import erscheint eine Erinnerung. */
  importReminderDays?: number;
  claims?: {
    /** Wie viele Fälle Amazon pro Tag annimmt. */
    dailyLimit?: number;
    /** Stunde (deutsche Zeit), zu der das Tageslimit zurückgesetzt wird. */
    resetHour?: number;
    /** Frist in Tagen ab Ereignis, je Anspruchsart. */
    windowDays?: Partial<Record<ClaimType, number>>;
    /** Ab welchem Betrag ein Anspruch angelegt wird (Cent-Beträge ignorieren). */
    minAmount?: number;
  };
  shipper?: Address;
  dhl?: {
    sandbox?: boolean;
    billingNumberPaket?: string;
    billingNumberKleinpaket?: string;
    productKleinpaket?: string;
    labelFormat?: string;
    kleinpaketMaxKg?: number;
  };
  pricing?: {
    referralRate?: number;
    minProfit?: number;
    maxPriceFactor?: number;
    defaultFbaFee?: number;
  };
  aging?: {
    unsellableWarnDays?: number;
    noSaleWarnDays?: number;
  };
  drive?: { folderId?: string };
  /** Retouren-Abgleich: Wartezeiten in Tagen. */
  returns?: { graceFba?: number; claimFba?: number; graceFbm?: number; marketplace?: string };
  cash?: { startBalance?: number; asOf?: string };
  /** Zustand des Kalender-Abgleichs (vom System gepflegt). */
  calendar?: { href?: string; lastSync?: string; lastError?: string | null; calendars?: string[]; read?: { name: string; events: number; error?: string }[] };
  /** E-Mail-Versand: Standard-Absenderpostfach (Rechnungen, Nachrichten). */
  mail?: { defaultSenderId?: string };
  /** Themen-Recherche für die Wissensdatenbank. */
  research?: { topics?: string[]; feeds?: string[]; intervalDays?: number; lastRun?: string | null; lastError?: string | null };
};

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  settings: jsonb("settings").$type<TenantSettings>().notNull().default({}),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "staff"] }).notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const sessions = pgTable("sessions", {
  /** SHA-256 des Tokens aus dem Cookie – das Token selbst wird nie gespeichert. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Zugangsdaten für Anbindungen (Amazon, eBay, DHL, Postfächer …), verschlüsselt. */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    tenantId: tenantId(),
    provider: text("provider").notNull(),
    label: text("label"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    secretEncrypted: text("secret_encrypted"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("integrations_tenant_idx").on(t.tenantId, t.provider)],
);

/** Shops/Lieferanten, erkannt am Kürzel in der SKU (z. B. AMZDE, WMF, SMY). */
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppliers_tenant_code_uq").on(t.tenantId, t.code)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    tenantId: tenantId(),
    asin: text("asin").notNull(),
    title: text("title"),
    ean: text("ean"),
    weightGrams: integer("weight_grams"),
    lengthCm: numeric("length_cm", { precision: 8, scale: 1 }),
    widthCm: numeric("width_cm", { precision: 8, scale: 1 }),
    heightCm: numeric("height_cm", { precision: 8, scale: 1 }),
    prepInstructions: text("prep_instructions"),
    isHazmat: boolean("is_hazmat").notNull().default(false),
    /** Geschätzte FBA-Gebühr je Einheit (aus Report oder von Hand). */
    fbaFee: numeric("fba_fee", { precision: 10, scale: 2 }),
    /** Verkaufsprovision als Anteil, z. B. 0.15. Leer = Standard aus den Einstellungen. */
    referralRate: numeric("referral_rate", { precision: 5, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_tenant_asin_uq").on(t.tenantId, t.asin)],
);

/** Hochgeladene Dateien (Rechnungs-PDFs, Versandlabels, Nachweise). */
export const files = pgTable(
  "files",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_tenant_sha_idx").on(t.tenantId, t.sha256)],
);

export const importRuns = pgTable("import_runs", {
  id: id(),
  tenantId: tenantId(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  source: text("source").notNull(),
  fileName: text("file_name"),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/**
 * Charge = ein Einkauf eines Artikels (bei dir: eine SKU). Retouren, die neu gelistet
 * werden, sind eigene Chargen und zeigen über parent_lot_id auf die Ursprungs-Charge.
 */
export const lots = pgTable(
  "lots",
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    kind: text("kind", { enum: ["purchase", "return", "unknown"] }).notNull(),
    skuSchema: text("sku_schema").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    fnsku: text("fnsku"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    purchaseDateEstimated: boolean("purchase_date_estimated").notNull().default(false),
    quantity: integer("quantity"),
    currency: text("currency").notNull().default("EUR"),
    /** Gültiger Netto-EK je Einheit – die eine Wahrheit für alle Exporte. */
    unitCostNet: numeric("unit_cost_net", { precision: 12, scale: 4 }),
    unitCostSource: text("unit_cost_source", {
      enum: ["template", "accountone", "sellerboard", "inherited", "manual"],
    }),
    /** Werte, die in der SKU selbst stehen (nur zur Kontrolle). */
    skuCostNet: numeric("sku_cost_net", { precision: 12, scale: 4 }),
    skuCostGross: numeric("sku_cost_gross", { precision: 12, scale: 4 }),
    skuTargetPrice: numeric("sku_target_price", { precision: 12, scale: 4 }),
    returnLpn: text("return_lpn"),
    returnCode: text("return_code"),
    returnChannel: text("return_channel"),
    returnDate: date("return_date", { mode: "string" }),
    parentLotId: uuid("parent_lot_id").references((): AnyPgColumn => lots.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lots_tenant_sku_uq").on(t.tenantId, t.sku),
    index("lots_tenant_product_idx").on(t.tenantId, t.productId),
  ],
);

/** Jeder EK-Wert, den eine Quelle je geliefert hat – so fallen Abweichungen auf. */
export const costObservations = pgTable(
  "cost_observations",
  {
    id: id(),
    tenantId: tenantId(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    valueNet: numeric("value_net", { precision: 12, scale: 4 }).notNull(),
    importRunId: uuid("import_run_id").references(() => importRuns.id, { onDelete: "set null" }),
    observedAt: createdAt(),
  },
  (t) => [uniqueIndex("cost_obs_lot_source_uq").on(t.lotId, t.source)],
);

export const TASK_CATEGORIES = [
  "amazon",
  "ebay",
  "versand",
  "einkauf",
  "geld",
  "support",
  "eigene",
  "system",
] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: date("due_date", { mode: "string" }),
    priority: text("priority", { enum: ["critical", "normal", "low"] }).notNull().default("normal"),
    category: text("category", { enum: TASK_CATEGORIES }).notNull().default("eigene"),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    /** Vom System erzeugte Aufgaben tragen einen Schlüssel, damit sie nicht doppelt entstehen. */
    systemKey: text("system_key"),
    link: text("link"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("tasks_tenant_system_key_uq").on(t.tenantId, t.systemKey),
  ],
);

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: id(),
    tenantId: tenantId(),
    kind: text("kind", { enum: ["article", "snippet"] }).notNull().default("article"),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("knowledge_tenant_idx").on(t.tenantId, t.category),
    index("knowledge_search_idx").using(
      "gin",
      sql`to_tsvector('german', ${t.title} || ' ' || ${t.body})`,
    ),
  ],
);
