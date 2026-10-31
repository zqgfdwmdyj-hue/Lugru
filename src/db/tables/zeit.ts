import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

// Zeitblöcke: feste freie Zeiten (Sperrzeit mit höchster Priorität – geschäftliche Aufgaben weichen aus) und
// reservierte Kapazität (z. B. Retouren-Prüfung in der Retourenwelle) – wiederkehrend je Wochentag, optional befristet.

export const zeitbloecke = pgTable(
  "zeitbloecke",
  {
    id: id(),
    tenantId: tenantId(),
    /** Wessen Zeit (freie Zeiten sind persönlich); leer = für alle. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    art: text("art", { enum: ["frei", "reserviert"] }).notNull(),
    titel: text("titel").notNull(),
    /** Wochentage 1 = Montag … 7 = Sonntag. */
    wochentage: jsonb("wochentage").$type<number[]>().notNull().default([]),
    ganztags: boolean("ganztags").notNull().default(true),
    /** Uhrzeit „HH:MM“ (Berlin), wenn nicht ganztags. */
    vonZeit: text("von_zeit"),
    bisZeit: text("bis_zeit"),
    gueltigVon: date("gueltig_von", { mode: "string" }),
    gueltigBis: date("gueltig_bis", { mode: "string" }),
    /** Reservierte Stunden je Tag (nur „reserviert“). */
    stunden: numeric("stunden", { precision: 4, scale: 1, mode: "number" }),
    link: text("link"),
    aktiv: boolean("aktiv").notNull().default(true),
    sortierung: integer("sortierung").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("zeitbloecke_tenant_idx").on(t.tenantId, t.art)],
);
