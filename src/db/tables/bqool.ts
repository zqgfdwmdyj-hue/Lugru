import { boolean, index, jsonb, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { tenantId } from "./core";

/**
 * Letzter BQool-Export „Manage Listings“ je Marktplatz und SKU (hochgeladen unter Repricer). Ein neuer Export
 * eines Marktplatzes ersetzt dessen Zeilen komplett. Geld als numeric, Mengen als numeric (BQool liefert teils Kommazahlen).
 */
export const bqoolListings = pgTable(
  "bqool_listings",
  {
    tenantId: tenantId(),
    marktplatz: text("marktplatz").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    titel: text("titel"),
    versand: text("versand"),
    preis: numeric("preis", { precision: 12, scale: 2, mode: "number" }),
    min: numeric("min", { precision: 12, scale: 2, mode: "number" }),
    max: numeric("max", { precision: 12, scale: 2, mode: "number" }),
    regel: text("regel"),
    status: text("status"),
    buyboxPreis: numeric("buybox_preis", { precision: 12, scale: 2, mode: "number" }),
    buyboxGewinner: text("buybox_gewinner"),
    eigeneBuybox: boolean("eigene_buybox"),
    niedrigsterPreis: numeric("niedrigster_preis", { precision: 12, scale: 2, mode: "number" }),
    angebote: numeric("angebote", { precision: 10, scale: 0, mode: "number" }),
    bestand: numeric("bestand", { precision: 12, scale: 0, mode: "number" }),
    zusatz: jsonb("zusatz").$type<Record<string, string>>().notNull().default({}),
    datei: text("datei"),
    eingelesenAm: timestamp("eingelesen_am", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.marktplatz, t.sku] }), index("bqool_asin_idx").on(t.tenantId, t.asin)],
);
