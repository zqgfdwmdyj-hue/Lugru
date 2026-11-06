import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt, users } from "./core";

// Bauauftrag Abholung DHL/UPS: je gebuchter (oder versuchter) Abholung eine Zeile – Protokoll mit Dienst, Datum,
// Fenster, Paketen, Bestätigungsnummer und wer gebucht bzw. storniert hat. Stornieren über denselben Weg.

export const ABHOL_DIENSTE = ["dhl", "ups"] as const;
export type AbholDienst = (typeof ABHOL_DIENSTE)[number];

export const abholungen = pgTable(
  "abholungen",
  {
    id: id(),
    tenantId: tenantId(),
    dienst: text("dienst", { enum: ABHOL_DIENSTE }).notNull(),
    /** Schlüssel des Abholorts aus den Stammdaten (Einstellungen → Abholung). */
    ort: text("ort").notNull(),
    /** Name des Abholorts zum Zeitpunkt der Buchung (für das Protokoll). */
    ortName: text("ort_name").notNull(),
    datum: date("datum", { mode: "string" }).notNull(),
    zeitVon: text("zeit_von"),
    zeitBis: text("zeit_bis"),
    pakete: integer("pakete").notNull(),
    paletten: integer("paletten").notNull().default(0),
    gewichtKg: numeric("gewicht_kg"),
    hinweis: text("hinweis"),
    /** gebucht | angefragt (DHL einmalige Abholung, Bestätigung per Mail) | storniert | fehler */
    status: text("status").notNull(),
    /** DHL: orderID (32 Zeichen), UPS: PRN. */
    bestaetigung: text("bestaetigung"),
    /** DHL: BDA/EZA/EMA laut Antwort. */
    abholArt: text("abhol_art"),
    kostenpflichtig: boolean("kostenpflichtig"),
    fehler: text("fehler"),
    /** seite | claude | vorschlag */
    quelle: text("quelle").notNull().default("seite"),
    gebuchtVon: uuid("gebucht_von").references(() => users.id, { onDelete: "set null" }),
    gebuchtVonName: text("gebucht_von_name"),
    storniertAm: timestamp("storniert_am", { withTimezone: true }),
    storniertVonName: text("storniert_von_name"),
    /** Antwort der Schnittstelle (gekürzt) – zum Nachvollziehen. */
    antwort: jsonb("antwort").$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("abholungen_datum_idx").on(t.tenantId, t.datum)],
);
