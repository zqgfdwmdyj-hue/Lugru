import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId } from "./core";

// ArbitrageOne-Anbindung (Bauauftrag Datei-Import, Ergänzung 01.11.): Exporte nachts abholen und über den Datei-Import
// verarbeiten. Einkäufe je Zeile (für Lugru „gekauft“, Monatsrahmen, Liquidität), Lagerbestand je Stichtag,
// AccountOne COG je Monat (Monatsdatei für den Steuerberater) und ein Protokoll je Abruf-Lauf.

export const aoEinkaeufe = pgTable(
  "ao_einkaeufe",
  {
    id: id(),
    tenantId: tenantId(),
    /** ASIN|SKU|Datum|Menge|EK|Lieferant|Rechnung – dieselbe Zeile aus einer zweiten Datei wird übersprungen. */
    schluessel: text("schluessel").notNull(),
    asin: text("asin").notNull(),
    sku: text("sku"),
    titel: text("titel"),
    kaufdatum: date("kaufdatum", { mode: "string" }).notNull(),
    menge: integer("menge").notNull(),
    ekNetto: numeric("ek_netto", { precision: 12, scale: 2 }),
    waehrung: text("waehrung"),
    lieferant: text("lieferant"),
    rechnung: text("rechnung"),
    dateiImportId: uuid("datei_import_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ao_einkaeufe_uq").on(t.tenantId, t.schluessel), index("ao_einkaeufe_asin_idx").on(t.tenantId, t.asin, t.kaufdatum), index("ao_einkaeufe_tag_idx").on(t.tenantId, t.kaufdatum)],
);

export const aoLagerbestand = pgTable(
  "ao_lagerbestand",
  {
    id: id(),
    tenantId: tenantId(),
    stichtag: date("stichtag", { mode: "string" }).notNull(),
    sku: text("sku"),
    asin: text("asin"),
    titel: text("titel"),
    menge: integer("menge").notNull(),
    ekNetto: numeric("ek_netto", { precision: 12, scale: 2 }),
    wert: numeric("wert", { precision: 14, scale: 2 }),
    lagerort: text("lagerort"),
    dateiImportId: uuid("datei_import_id"),
    createdAt: createdAt(),
  },
  (t) => [index("ao_lagerbestand_tag_idx").on(t.tenantId, t.stichtag), index("ao_lagerbestand_sku_idx").on(t.tenantId, t.sku)],
);

export const aoAccountoneCog = pgTable(
  "ao_accountone_cog",
  {
    id: id(),
    tenantId: tenantId(),
    /** Monat, für den die Datei gilt (am 1. geholt = Stand Ende Vormonat). */
    monat: text("monat").notNull(),
    zeilen: jsonb("zeilen").$type<{ asin: string; sku: string; ekNetto: number | null }[]>().notNull().default([]),
    spalten: jsonb("spalten").$type<string[]>().notNull().default([]),
    dateiname: text("dateiname"),
    dateiImportId: uuid("datei_import_id"),
    createdAt: createdAt(),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ao_accountone_cog_uq").on(t.tenantId, t.monat)],
);

export type AoLaufErgebnis = {
  key: string;
  titel: string;
  ok: boolean;
  datei?: string;
  importId?: string;
  text: string;
  /** B27.2/B27.6: bei Fehlern Bildschirmfoto, Seite, Seitentitel und die Rohmeldung (nur im Detail). */
  bild?: string;
  seite?: string;
  seitentitel?: string;
  roh?: string;
  /** B27.3: Export bewusst nicht ausgeführt (z. B. nicht eingerichtet) – kein Fehler. */
  uebersprungen?: boolean;
  /** B31.1: Export wird nicht mehr abgeholt (BQool) – nur Hinweiszeile. */
  entfaellt?: boolean;
};

export const aoLaeufe = pgTable(
  "ao_laeufe",
  {
    id: id(),
    tenantId: tenantId(),
    /** zeitplan = Nachtlauf 05:30, knopf = „Jetzt abholen“. */
    ausloeser: text("ausloeser", { enum: ["zeitplan", "knopf"] }).notNull(),
    status: text("status", { enum: ["laeuft", "ok", "teilweise", "fehler"] }).notNull().default("laeuft"),
    ergebnis: jsonb("ergebnis").$type<AoLaufErgebnis[]>().notNull().default([]),
    protokoll: jsonb("protokoll").$type<{ zeit: string; text: string; bildId?: string }[]>().notNull().default([]),
    fehler: text("fehler"),
    endeAm: timestamp("ende_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("ao_laeufe_tenant_idx").on(t.tenantId, t.createdAt)],
);
