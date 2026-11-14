import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantId } from "./core";

// Repricing ohne festen Anbieter: Soll-Strategie je SKU und Land (Seller-System) und Ist-Stand aus ProfitGuard
// (ProfitPath) per Datei-Import. Die früheren BQool-Tabellen liegen schreibgeschützt als „archiv_bqool_*“ in der
// Datenbank (Migration 0158) und werden vom Code nicht mehr gelesen.

const geld = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

/**
 * Letzter ProfitGuard-Export je Marktplatz und SKU (Repricer → „ProfitGuard-Export einlesen“). Ein neuer Export eines
 * Marktplatzes ersetzt dessen Zeilen komplett. `strategie` ist der Name in ProfitGuard, wie er in der Datei steht.
 */
export const profitguardListings = pgTable(
  "profitguard_listings",
  {
    tenantId: tenantId(),
    marktplatz: text("marktplatz").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    titel: text("titel"),
    preis: geld("preis"),
    min: geld("min"),
    max: geld("max"),
    strategie: text("strategie"),
    /** true = ProfitGuard bepreist die SKU, false = nicht im Repricing / pausiert, null = nicht in der Datei. */
    imRepricing: boolean("im_repricing"),
    buyboxPreis: geld("buybox_preis"),
    eigeneBuybox: boolean("eigene_buybox"),
    /** Buy-Box-Anteil in % (0–100), wenn die Datei ihn enthält. */
    buyboxAnteil: numeric("buybox_anteil", { precision: 6, scale: 2, mode: "number" }),
    bestand: numeric("bestand", { precision: 12, scale: 0, mode: "number" }),
    /** Alle übrigen Spalten der Datei – für den Export im selben Format (Round-Trip) und zur Anzeige. */
    zusatz: jsonb("zusatz").$type<Record<string, string>>().notNull().default({}),
    datei: text("datei"),
    eingelesenAm: timestamp("eingelesen_am", { withTimezone: true }).notNull(),
    /** Seit wann die SKU diese Strategie in ProfitGuard hat (beim Import gesetzt, wenn sich die Strategie ändert). */
    strategieSeit: timestamp("strategie_seit", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.marktplatz, t.sku] }), index("profitguard_asin_idx").on(t.tenantId, t.asin)],
);

/** Zeile einer erzeugten ProfitGuard-Importdatei (Soll je SKU und Land). */
export type ProfitguardExportZeile = { land: string; sku: string; strategie: string; strategieName: string; min: number; max: number; aktiv: boolean; minVorher?: number | null };

/** Erzeugte ProfitGuard-Importdateien (Min/Max/Strategie je Land) – Download, Vergleich „nur Änderungen“, Protokoll. */
export const profitguardExporte = pgTable(
  "profitguard_exporte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid("user_id"),
    laender: jsonb("laender").$type<string[]>().notNull(),
    nurAenderungen: boolean("nur_aenderungen").notNull(),
    zeilen: jsonb("zeilen").$type<ProfitguardExportZeile[]>().notNull(),
    anzahl: jsonb("anzahl").$type<Record<string, number>>().notNull().default({}),
    /** Von Hand bestätigt: Datei in ProfitGuard importiert (das System lädt nichts selbst hoch). */
    importiertAm: timestamp("importiert_am", { withTimezone: true }),
    importiertVon: text("importiert_von"),
    protokoll: jsonb("protokoll").$type<{ zeit: string; text: string }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("profitguard_exporte_tenant_idx").on(t.tenantId, t.createdAt)],
);

/**
 * Gebühren je Land und SKU (FBA-Gebühr, Provisionssatz) je Quelle – „liste“ aus einer Repricer-Liste (früher BQool
 * „Download listings“, jetzt ProfitGuard-Export, wenn er Gebührenspalten hat), „amazon“ aus der Amazon-Gebührenvorschau
 * des Landes. Vorrang beim Rechnen: Liste vor Amazon vor Produkt (DE).
 */
export const repricingGebuehren = pgTable(
  "repricing_gebuehren",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    quelle: text("quelle", { enum: ["liste", "amazon"] }).notNull(),
    asin: text("asin"),
    fba: geld("fba"),
    provisionSatz: numeric("provision_satz", { precision: 6, scale: 4, mode: "number" }),
    /** Preis, bei dem die Provision gerechnet wurde (für Preisstufen). */
    preis: geld("preis"),
    kategorie: text("kategorie"),
    stand: timestamp("stand", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku, t.quelle] })],
);

/**
 * Feste Soll-Strategie je Land und SKU: von Hand, aus der Regel-Leiter oder als Vorschlag der Kapital-Ampel (gilt erst
 * nach Freigabe). `regel` ist der neutrale Strategiename (Standard, Abverkauf, Liquidation, Schnelldreher).
 */
export const repricingZuweisungen = pgTable(
  "repricing_zuweisungen",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    regel: text("regel").notNull(),
    /** Feste Untergrenze (Liquidation) = Min; null = rechnen. */
    untergrenze: geld("untergrenze"),
    quelle: text("quelle", { enum: ["vorlage", "hand", "kapital", "leiter"] }).notNull(),
    freigegeben: boolean("freigegeben").notNull().default(true),
    grund: text("grund"),
    datei: text("datei"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/**
 * Liquidationen je SKU und Land (Min unter Marge, Regel-Leiter Stufe 3, Verlust-Freigabe von Hand): Strategie vor der
 * Liquidation, „Verlust akzeptiert bis x € je Stück“, Laufzeit und Rückkehr-Vorschlag.
 */
export const repricingLiquidationen = pgTable(
  "repricing_liquidationen",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    /** min_unter_marge = vom System wegen Min unter Marge · leiter = Regel-Leiter Stufe 3 · hand = nur Verlust-Freigabe. */
    grund: text("grund", { enum: ["min_unter_marge", "hand", "leiter"] }).notNull(),
    regelVorher: text("regel_vorher"),
    minGewuenscht: geld("min_gewuenscht"),
    minGesetzt: geld("min_gesetzt"),
    effMinVorher: geld("eff_min_vorher"),
    breakEven: geld("break_even"),
    /** „Mindest-Verlust akzeptiert bis x €“ je Stück – nur damit darf der Min unter Break-even liegen. */
    verlustBis: geld("verlust_bis"),
    status: text("status", { enum: ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen", "beendet"] }).notNull().default("vorgeschlagen"),
    /** Erstmals im Repricer-Ist (ProfitGuard) mit Liquidation und dem gesetzten Min gesehen. */
    aktivSeit: timestamp("aktiv_seit", { withTimezone: true }),
    /** Buy Box seit diesem Tag über effektivem Min (ursprüngliche Strategie) + 3 %. */
    ueberSeit: date("ueber_seit", { mode: "string" }),
    zurueckVorgeschlagenAm: timestamp("zurueck_vorgeschlagen_am", { withTimezone: true }),
    rueckkehrGrund: text("rueckkehr_grund"),
    /** Ziel der Rückkehr (Stufe 2 „Abverkauf“, Stufe 1 nur mit frischem Nachschub). */
    rueckkehrRegel: text("rueckkehr_regel"),
    beendetAm: timestamp("beendet_am", { withTimezone: true }),
    /** „Liquidation bis“ (Standard 45 Tage ab Wechsel), dauerhaft = ohne Enddatum. */
    bis: date("bis", { mode: "string" }),
    dauerhaft: boolean("dauerhaft").notNull().default(false),
    verlaengert: integer("verlaengert").notNull().default(0),
    /** Vorwarnung 7 Tage vor „bis“ verschickt. */
    ablaufGemeldetAm: timestamp("ablauf_gemeldet_am", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/** Täglicher Pflege-Stand je SKU und Land (Leiter-Zähler, Schnelldreher-Schutz, Listing-Check). */
export const repricingSkuPflege = pgTable(
  "repricing_sku_pflege",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    /** Effektiver Min der aktuellen Strategie liegt seit diesem Tag über der Buy Box. */
    ueberSeit: date("ueber_seit", { mode: "string" }),
    /** Eigenes Angebot ohne Buy Box seit (Schnelldreher-Ende nach 21 Tagen). */
    ohneBuyboxSeit: date("ohne_buybox_seit", { mode: "string" }),
    schnelldreher: boolean("schnelldreher").notNull().default(false),
    schnellQuelle: text("schnell_quelle", { enum: ["auto", "hand"] }),
    schnellSeit: timestamp("schnell_seit", { withTimezone: true }),
    /** Sperre der Leiter bis (Schutz verlängern 14 Tage). */
    schnellBis: date("schnell_bis", { mode: "string" }),
    /** Nicht im Repricing → nach Freigabe aktivieren (in der nächsten ProfitGuard-Datei „aktiv“). */
    aktivieren: boolean("aktivieren").notNull().default(false),
    /** Buy Box liegt seit diesem Tag über dem Max; Max nach Freigabe; zuletzt im Listing-Check geprüft. */
    bbUeberMaxSeit: date("bb_ueber_max_seit", { mode: "string" }),
    maxSoll: geld("max_soll"),
    checkZuletzt: date("check_zuletzt", { mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/** Zustand der Ware je SKU (land „*“ = alle Marktplätze), von Hand oder erkannt. */
export const artikelZustand = pgTable(
  "artikel_zustand",
  {
    tenantId: tenantId(),
    land: text("land").notNull().default("*"),
    sku: text("sku").notNull(),
    zustand: text("zustand", { enum: ["neu", "neu_sonstige", "wie_neu", "sehr_gut", "gut", "akzeptabel", "gebraucht", "unbekannt"] }).notNull(),
    quelle: text("quelle", { enum: ["hand", "sku_muster", "arbitrageone", "amazon", "retouren_station", "einkauf", "keine"] }).notNull(),
    gesetztVon: uuid("gesetzt_von"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/**
 * Vorschläge je SKU und Land (Stufenwechsel, Schnelldreher, Listing-Check). Wirksam erst nach Freigabe – dann als
 * Soll-Strategie bzw. Min in der nächsten ProfitGuard-Datei, nie direkt in ProfitGuard.
 */
export const repricingVorschlaege = pgTable(
  "repricing_vorschlaege",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    art: text("art").notNull(),
    vonRegel: text("von_regel"),
    nachRegel: text("nach_regel"),
    min: geld("min"),
    gruende: jsonb("gruende").$type<string[]>().notNull().default([]),
    daten: jsonb("daten").$type<Record<string, unknown>>().notNull().default({}),
    /** Geschätztes Euro-Potenzial (fehlende Verkäufe × Marge) zum Sortieren. */
    potenzial: geld("potenzial"),
    status: text("status", { enum: ["offen", "spaeter", "freigegeben", "abgelehnt", "erledigt", "veraltet"] }).notNull().default("offen"),
    spaeterBis: date("spaeter_bis", { mode: "string" }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    entschiedenVon: uuid("entschieden_von"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repricing_vorschlaege_offen_idx").on(t.tenantId, t.status, t.art), index("repricing_vorschlaege_sku_idx").on(t.tenantId, t.land, t.sku, t.art)],
);
