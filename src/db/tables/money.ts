import { sql } from "drizzle-orm";
import { date, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, money, tenantId } from "./core";

/** Geplante Ein- und Ausgaben für die Cash-Flow-Vorschau. */
export const cashItems = pgTable(
  "cash_items",
  {
    id: id(),
    tenantId: tenantId(),
    date: date("date", { mode: "string" }).notNull(),
    /** Positiv = Einnahme, negativ = Ausgabe. */
    amount: money("amount").notNull(),
    category: text("category").notNull().default("sonstiges"),
    description: text("description").notNull(),
    recurrence: text("recurrence", { enum: ["none", "weekly", "monthly"] }).notNull().default("none"),
    endDate: date("end_date", { mode: "string" }),
    /** Von außen übernommen (z. B. „sellerboard:<id>“) – wird beim Abgleich aktualisiert; eigene Posten haben keinen. */
    externalRef: text("external_ref"),
    createdAt: createdAt(),
  },
  (t) => [index("cash_items_date_idx").on(t.tenantId, t.date), uniqueIndex("cash_items_ext_uq").on(t.tenantId, t.externalRef).where(sql`${t.externalRef} is not null`)],
);
