import { date, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantId } from "./core";

// Verlust-Stopp: bewusst mit Verlust verkaufte Artikel (Abverkauf, Liquidation, Ranking) – keine Aufgabe, aber
// in der Ausnahme-Liste mit Wochensumme sichtbar.

export const verlustAusnahmen = pgTable(
  "verlust_ausnahmen",
  {
    tenantId: tenantId(),
    sku: text("sku").notNull(),
    grund: text("grund").notNull(),
    /** Gilt bis einschließlich; leer = bis auf Widerruf. */
    bis: date("bis", { mode: "string" }),
    angelegtVon: uuid("angelegt_von"),
    angelegtAm: timestamp("angelegt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.sku] })],
);
