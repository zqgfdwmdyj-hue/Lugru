import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

// EK-Import (ArbitrageOne-Liste für sellerboard): erst Vorschau, dann übernehmen, dann zu sellerboard übertragen
// (Datei bzw. Browser-Automatik) und am Folgetag gegenprüfen.

export type EkImportZeile = {
  sku: string;
  asin: string;
  ekNeu: number | null;
  ekAlt: number | null;
  quelleAlt: string | null;
  art: "neu" | "geaendert" | "gleich" | "unbekannt";
  abweichungProzent: number | null;
  warnungen: string[];
};

export const ekImporte = pgTable(
  "ek_importe",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    dateiname: text("dateiname").notNull(),
    quelle: text("quelle", { enum: ["sellerboard", "accountone", "template"] }).notNull(),
    /** Gelesene Zeilen wie aus der Datei (für das Übernehmen ohne erneuten Upload). */
    roh: jsonb("roh").$type<{ line: number; asin: string; sku: string; costNet: number | null; fnsku?: string | null; title?: string | null; purchaseDate?: string | null; quantity?: number | null; currency?: string | null }[]>().notNull(),
    zeilen: jsonb("zeilen").$type<EkImportZeile[]>().notNull(),
    anzahl: jsonb("anzahl").$type<Record<string, number>>().notNull().default({}),
    status: text("status", { enum: ["vorschau", "uebernommen", "verworfen"] }).notNull().default("vorschau"),
    uebernommenAm: timestamp("uebernommen_am", { withTimezone: true }),
    /** Übertragung zu sellerboard: Datei heruntergeladen, Automatik ok/Fehler. */
    sellerboard: text("sellerboard", { enum: ["offen", "datei", "automatik_ok", "automatik_fehler"] }).notNull().default("offen"),
    sellerboardProtokoll: jsonb("sellerboard_protokoll").$type<{ zeit: string; text: string }[]>().notNull().default([]),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
    pruefung: jsonb("pruefung").$type<{ geprueft: number; abweichend: { sku: string; system: number | null; sellerboard: number | null }[] } | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("ek_importe_tenant_idx").on(t.tenantId, t.createdAt)],
);
