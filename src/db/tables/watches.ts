import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { brands } from "./brands";
import { createdAt, id, tenantId, updatedAt, users } from "./core";

// Uhren Buy & Flip (Marke Zeitlux): Deals vom Beobachten bis zum Verkauf, eigene Marktpreis-Notizen und der
// Lernfortschritt je Person. Beträge in Euro, wie bezahlt (brutto).

export const watchDeals = pgTable(
  "watch_deals",
  {
    id: id(),
    tenantId: tenantId(),
    /** Marke im System (Zeitlux) – für die Marken-Freigabe von Mitarbeitern. */
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    /** Nur auf dem Papier (Übung): zählt getrennt von echten Deals. */
    practice: boolean("practice").notNull().default(false),
    condition: text("condition", { enum: ["gebraucht", "neu"] }).notNull().default("gebraucht"),
    /** Uhrenmarke, Modell, Referenz, Baujahr. */
    maker: text("maker").notNull(),
    model: text("model"),
    reference: text("reference"),
    year: integer("year"),
    watchSet: text("watch_set", { enum: ["komplett", "box", "papiere", "ohne"] }).notNull().default("ohne"),
    status: text("status", { enum: ["beobachtet", "verhandlung", "gekauft", "inserat", "verkauft", "verworfen"] }).notNull().default("beobachtet"),
    taxMode: text("tax_mode", { enum: ["privat", "differenz", "regel"] }).notNull().default("privat"),
    source: text("source"),
    url: text("url"),
    /** Angebotspreis des Verkäufers (beim Beobachten). */
    askPrice: numeric("ask_price", { precision: 12, scale: 2, mode: "number" }),
    buyPrice: numeric("buy_price", { precision: 12, scale: 2, mode: "number" }),
    buyDate: date("buy_date", { mode: "string" }),
    /** Nebenkosten (Revision, Aufbereitung, Prüfung, Anreise …) als Liste. */
    costs: jsonb("costs").$type<{ label: string; amount: number }[]>().notNull().default([]),
    targetSell: numeric("target_sell", { precision: 12, scale: 2, mode: "number" }),
    sellPrice: numeric("sell_price", { precision: 12, scale: 2, mode: "number" }),
    sellDate: date("sell_date", { mode: "string" }),
    channel: text("channel"),
    feePct: numeric("fee_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    feeFixed: numeric("fee_fixed", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    shipping: numeric("shipping", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    checklist: jsonb("checklist").$type<{ text: string; done: boolean }[]>().notNull().default([]),
    notes: text("notes"),
    /** „Was habe ich gelernt?“ */
    lessons: text("lessons"),
    /** Warum verworfen (Lernen aus Nein-Entscheidungen). */
    rejectReason: text("reject_reason"),
    aiFeedback: text("ai_feedback"),
    aiAt: timestamp("ai_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("watch_deals_tenant_idx").on(t.tenantId, t.status)],
);

export const watchPrices = pgTable(
  "watch_prices",
  {
    id: id(),
    tenantId: tenantId(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    /** Referenz wie eingegeben; verglichen wird ohne Leerzeichen, groß geschrieben. */
    reference: text("reference").notNull(),
    refKey: text("ref_key").notNull(),
    label: text("label"),
    kind: text("kind", { enum: ["verkauft", "angeboten", "ankauf"] }).notNull(),
    price: numeric("price", { precision: 12, scale: 2, mode: "number" }).notNull(),
    day: date("day", { mode: "string" }).notNull(),
    condition: text("condition", { enum: ["gebraucht", "neu"] }).notNull().default("gebraucht"),
    fullSet: boolean("full_set").notNull().default(false),
    source: text("source"),
    url: text("url"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("watch_prices_ref_idx").on(t.tenantId, t.refKey, t.day)],
);

/** Lernfortschritt je Person und Lektion. */
export const watchLearn = pgTable(
  "watch_learn",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lesson: text("lesson").notNull(),
    done: boolean("done").notNull().default(false),
    bestCorrect: integer("best_correct").notNull().default(0),
    total: integer("total").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.lesson] })],
);
