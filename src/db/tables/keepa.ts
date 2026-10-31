import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { KeepaStand } from "../../lib/keepa/auswertung";
import { tenantId } from "./core";

/**
 * Zwischenspeicher für Keepa-Abfragen der Claude-Werkzeuge (keepa_produkt, keepa_vergleich): je ASIN und Marktplatz
 * der ausgewertete Stand (aktuelle Werte, Kennzahlen, ein Wert je Tag für 365 Tage, Buy-Box-Verlauf). Jüngere Stände
 * als 6 Stunden werden wiederverwendet – jede Keepa-Abfrage kostet Tokens. `gefunden = false`: Keepa kennt die ASIN dort nicht.
 */
export const keepaCache = pgTable(
  "keepa_cache",
  {
    tenantId: tenantId(),
    asin: text("asin").notNull(),
    marktplatz: text("marktplatz").notNull(),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull(),
    gefunden: boolean("gefunden").notNull(),
    stand: jsonb("stand").$type<KeepaStand>(),
    tokensUebrig: integer("tokens_uebrig"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.asin, t.marktplatz] })],
);
