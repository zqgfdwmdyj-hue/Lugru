import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { invoices } from "./invoices";

// Echtheits-Ordner je Marke: Welche Rechnungen belegen den Einkauf der Marke? Abdeckung gekauft/verkauft, Lücken,
// Audit-Paket für Amazon (Echtheits- oder Rechteinhaber-Beschwerden).

export const echtheitMarken = pgTable(
  "echtheit_marken",
  {
    id: id(),
    tenantId: tenantId(),
    marke: text("marke").notNull(),
    markeKey: text("marke_key").notNull(),
    /** Weitere Schreibweisen (z. B. „Rösle“ / „Roesle“). */
    aliase: jsonb("aliase").$type<string[]>().notNull().default([]),
    notiz: text("notiz"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("echtheit_marken_uq").on(t.tenantId, t.markeKey)],
);

/** Entscheidung je Marke + Rechnung: „stimmt“ (auch von Hand zugeordnet) oder „falsch“ (Fehltreffer). */
export const echtheitBelege = pgTable(
  "echtheit_belege",
  {
    tenantId: tenantId(),
    markeId: uuid("marke_id")
      .notNull()
      .references(() => echtheitMarken.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    urteil: text("urteil", { enum: ["stimmt", "falsch"] }).notNull(),
    /** Von Hand zugeordnet (Marke steht nicht im Rechnungstext). */
    manuell: boolean("manuell").notNull().default(false),
    geprueftVon: uuid("geprueft_von").references(() => users.id, { onDelete: "set null" }),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.markeId, t.invoiceId] }), index("echtheit_belege_tenant_idx").on(t.tenantId)],
);
