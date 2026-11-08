import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** B31.6: seit wann die SKU diese Regel in BQool hat (beim Import gesetzt, wenn sich die Regel ändert). */
    regelSeit: timestamp("regel_seit", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.marktplatz, t.sku] }), index("bqool_asin_idx").on(t.tenantId, t.asin)],
);

/**
 * Feste Regel je Land und SKU für die BQool-Dateien aus dem System: aus Ludwigs Vorlagen (Liquidation mit fester
 * Untergrenze, Abverkauf), von Hand oder als Vorschlag der Kapital-Ampel (gilt erst nach Freigabe).
 */
export const bqoolZuweisungen = pgTable(
  "bqool_zuweisungen",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    regel: text("regel").notNull(),
    /** Feste Untergrenze (Liquidation) = Min Price; null = Break-even rechnen. */
    untergrenze: numeric("untergrenze", { precision: 12, scale: 2, mode: "number" }),
    quelle: text("quelle", { enum: ["vorlage", "hand", "kapital", "leiter"] }).notNull(),
    freigegeben: boolean("freigegeben").notNull().default(true),
    grund: text("grund"),
    datei: text("datei"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

export type BqoolExportZeile = { land: string; sku: string; cost: number; zusatz: number; regel: string; min: number; max: number };

/** Erzeugte BQool-Dateien (Inhalt je Land) – für den Download, den Vergleich „nur Änderungen“ und das Protokoll. */
export const bqoolExporte = pgTable(
  "bqool_exporte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid("user_id"),
    laender: jsonb("laender").$type<string[]>().notNull(),
    nurAenderungen: boolean("nur_aenderungen").notNull(),
    zeilen: jsonb("zeilen").$type<BqoolExportZeile[]>().notNull(),
    anzahl: jsonb("anzahl").$type<Record<string, number>>().notNull().default({}),
    /** Übertragung zu BQool (Browser-Automatik) – null = nur Download. */
    uebertragung: text("uebertragung", { enum: ["laeuft", "fertig", "teilweise", "fehler", "pruefen"] }),
    /** Je Upload ein Eintrag mit Land; `unklar` = keine Bestätigung erkannt; `vonHand` = später als hochgeladen bestätigt. */
    protokoll: jsonb("protokoll").$type<{ zeit: string; text: string; land?: string; datei?: string; zeilen?: number; ok?: boolean; unklar?: boolean; vonHand?: { von: string; am: string } }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bqool_exporte_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** B31.2: Ergebnis je Land beim Holen des BQool-Ist (Download „Repricing Central File – Full Template“ bzw. „Manage Listings“). */
export type BqoolIstLand = { land: string; ok: boolean; datei?: string; skus?: number; text: string; bild?: string };
/** B31.2: Rückmeldung von BQool je Land nach dem Upload. */
export type BqoolUploadLand = { land: string; ok: boolean; zeilen: number; uebernommen: number | null; fehler: number | null; fehlerZeilen: { sku: string; text: string }[]; text: string; unklar?: boolean };
/** B31.2: Zusammenfassung des Soll-Exports für Freigabe-Push und Anzeige. */
export type BqoolLaufZusammenfassung = { jeLand: Record<string, number>; gesamt: number; regelWechsel: number; warnungen: number; unterBreakEven: number; /** B31.6: davon Regelwechsel auf Liquidation (Min unter Marge). */ liquidation?: number };
/** B31.2: Nachkontrolle – Abweichungen zwischen hochgeladener Datei und BQool-Ist 30 Minuten später. */
export type BqoolKontrolle = { geprueft: number; ok: number; abweichungen: { land: string; sku: string; text: string }[]; text: string };

/**
 * B31.2 Täglicher BQool-Kreislauf (06:00): Ist holen → Soll erzeugen → Freigabe (Push) → Upload je Land → Nachkontrolle.
 * Ein Eintrag je Tag und Mandant (Knopf „Jetzt starten“ legt einen weiteren an). Hochgeladen wird nur nach Freigabe
 * bzw. – wenn eingeschaltet – automatisch ohne Regelwechsel und ohne Min unter Break-even.
 */
export const bqoolLaeufe = pgTable(
  "bqool_laeufe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** Tag (Berlin, JJJJ-MM-TT), an dem der Lauf begann. */
    tag: text("tag").notNull(),
    ausloeser: text("ausloeser", { enum: ["zeitplan", "knopf"] }).notNull(),
    phase: text("phase", { enum: ["ist", "soll", "freigabe", "upload", "kontrolle", "fertig", "abgebrochen", "verfallen"] }).notNull().default("ist"),
    ist: jsonb("ist").$type<BqoolIstLand[]>().notNull().default([]),
    istAm: timestamp("ist_am", { withTimezone: true }),
    exportId: uuid("export_id"),
    zusammenfassung: jsonb("zusammenfassung").$type<BqoolLaufZusammenfassung>(),
    freigabe: text("freigabe", { enum: ["offen", "freigegeben", "automatisch", "verfallen", "nicht_noetig", "abgelehnt"] }),
    freigabeVon: text("freigabe_von"),
    freigabeAm: timestamp("freigabe_am", { withTimezone: true }),
    erinnertAm: timestamp("erinnert_am", { withTimezone: true }),
    upload: jsonb("upload").$type<BqoolUploadLand[]>(),
    uploadStatus: text("upload_status", { enum: ["laeuft", "fertig", "teilweise", "fehler", "pruefen"] }),
    uploadAm: timestamp("upload_am", { withTimezone: true }),
    kontrolleFaelligAm: timestamp("kontrolle_faellig_am", { withTimezone: true }),
    kontrolleAm: timestamp("kontrolle_am", { withTimezone: true }),
    kontrolle: jsonb("kontrolle").$type<BqoolKontrolle>(),
    protokoll: jsonb("protokoll").$type<{ zeit: string; text: string; bildId?: string }[]>().notNull().default([]),
    fehler: text("fehler"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bqool_laeufe_tenant_idx").on(t.tenantId, t.createdAt)],
);

const geld = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/**
 * B31.5 Eingelesene BQool-Berichte: „Listing Performance“ je Land, Zeitraum (7/30 Tage) und Stichtag bzw. „Daily Sales“
 * je Land (zeitraum_tage 0). Protokoll und Summen (Buy-Box-Anteil, Umsatz) für Wochenreihe, Morgenbericht, Land der
 * Daily-Sales-Datei. Derselbe Bericht am selben Tag noch einmal ersetzt den alten.
 */
export const bqoolBerichte = pgTable(
  "bqool_berichte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    art: text("art", { enum: ["listing_performance", "daily_sales"] }).notNull(),
    land: text("land").notNull(),
    zeitraumTage: integer("zeitraum_tage").notNull().default(0),
    /** Listing Performance: Tag des Downloads (Ende des Zeitraums); Daily Sales: letzter Tag der Datei. */
    stichtag: text("stichtag").notNull(),
    von: text("von"),
    bis: text("bis"),
    zeilen: integer("zeilen").notNull().default(0),
    buyboxAnteil: numeric("buybox_anteil", { precision: 6, scale: 2, mode: "number" }),
    sales: geld("sales"),
    profit: geld("profit"),
    datei: text("datei"),
    via: text("via", { enum: ["upload", "automatik", "claude"] }).notNull().default("upload"),
    /** Wie das Land bestimmt wurde (Regelname, Abgleich, von Hand, Automatik). */
    landQuelle: text("land_quelle"),
    eingelesenAm: timestamp("eingelesen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bqool_berichte_uq").on(t.tenantId, t.art, t.land, t.zeitraumTage, t.stichtag), index("bqool_berichte_tenant_idx").on(t.tenantId, t.eingelesenAm)],
);

/** B31.5 Listing Performance je SKU (Land, Zeitraum, Stichtag). Prozentwerte als Zahl 0–100, Beträge in €. */
export const bqoolLeistung = pgTable(
  "bqool_leistung",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    zeitraumTage: integer("zeitraum_tage").notNull(),
    stichtag: text("stichtag").notNull(),
    asin: text("asin"),
    titel: text("titel"),
    regel: text("regel"),
    sales: geld("sales"),
    orders: geld("orders"),
    units: geld("units"),
    profit: geld("profit"),
    bbWins: geld("bb_wins"),
    lowestWin: geld("lowest_win"),
    atMin: geld("at_min"),
    atMax: geld("at_max"),
    belowMin: geld("below_min"),
    avgOffers: geld("avg_offers"),
    avgPosition: geld("avg_position"),
    reprice: geld("reprice"),
    priceUp: geld("price_up"),
    priceDown: geld("price_down"),
    priceChanges: geld("price_changes"),
    bbLostAmazon: geld("bb_lost_amazon"),
    bbLostFba: geld("bb_lost_fba"),
    bbLostFbm: geld("bb_lost_fbm"),
    zusatz: jsonb("zusatz").$type<Record<string, string>>().notNull().default({}),
    eingelesenAm: timestamp("eingelesen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku, t.zeitraumTage, t.stichtag] }), index("bqool_leistung_stichtag_idx").on(t.tenantId, t.stichtag)],
);

/** B31.5 Daily Sales je Land und Tag (BQool) – Vergleichsspalte auf der Gewinn-Seite, Buy-Box-Anteil je Tag. */
export const bqoolTageswerte = pgTable(
  "bqool_tageswerte",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    tag: text("tag").notNull(),
    sales: geld("sales"),
    salesFba: geld("sales_fba"),
    salesFbm: geld("sales_fbm"),
    orders: geld("orders"),
    units: geld("units"),
    profit: geld("profit"),
    bbWins: geld("bb_wins"),
    zusatz: jsonb("zusatz").$type<Record<string, string>>().notNull().default({}),
    datei: text("datei"),
    eingelesenAm: timestamp("eingelesen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.tag] })],
);

/** B31.5 Bericht ohne eindeutiges Land: gelesene Zeilen warten auf „Welches Land?“ (Knopf beim Upload). 7 Tage. */
export const bqoolBerichteOffen = pgTable(
  "bqool_berichte_offen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    art: text("art", { enum: ["listing_performance", "daily_sales"] }).notNull(),
    datei: text("datei").notNull(),
    zeitraumTage: integer("zeitraum_tage").notNull().default(0),
    stichtag: text("stichtag").notNull(),
    daten: jsonb("daten").$type<{ zeilen?: unknown[]; tage?: unknown[]; summe?: unknown }>().notNull(),
    vorschlag: text("vorschlag"),
    begruendung: text("begruendung"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bqool_berichte_offen_tenant_idx").on(t.tenantId, t.createdAt)],
);

/**
 * B31.6: SKUs, die wegen „Min unter Mindestmarge“ auf Liquidation gehen (Regel vor Liquidation gemerkt) sowie die
 * Freigabe „Abverkauf mit Verlust bis x € je Stück“ für Liquidation-SKUs. Rückkehr-Vorschlag, wenn die Buy Box 14 Tage
 * über dem effektiven Min der ursprünglichen Regel + 3 % liegt.
 */
export const bqoolLiquidationen = pgTable(
  "bqool_liquidationen",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    /** min_unter_marge = vom System wegen Min unter effektivem Min · hand = nur Verlust-Freigabe für eine bestehende Liquidation. */
    grund: text("grund", { enum: ["min_unter_marge", "hand", "leiter"] }).notNull(),
    regelVorher: text("regel_vorher"),
    minGewuenscht: numeric("min_gewuenscht", { precision: 12, scale: 2, mode: "number" }),
    minGesetzt: numeric("min_gesetzt", { precision: 12, scale: 2, mode: "number" }),
    effMinVorher: numeric("eff_min_vorher", { precision: 12, scale: 2, mode: "number" }),
    breakEven: numeric("break_even", { precision: 12, scale: 2, mode: "number" }),
    /** „Mindest-Verlust akzeptiert bis x €“ je Stück – nur damit darf der Min unter Break-even liegen. */
    verlustBis: numeric("verlust_bis", { precision: 12, scale: 2, mode: "number" }),
    status: text("status", { enum: ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen", "beendet"] }).notNull().default("vorgeschlagen"),
    /** Erstmals im BQool-Ist mit Liquidation und dem gesetzten Min gesehen. */
    aktivSeit: timestamp("aktiv_seit", { withTimezone: true }),
    /** Buy Box seit diesem Tag über effektivem Min (ursprüngliche Regel) + 3 %. */
    ueberSeit: date("ueber_seit", { mode: "string" }),
    zurueckVorgeschlagenAm: timestamp("zurueck_vorgeschlagen_am", { withTimezone: true }),
    /** Grund des Rückkehr-Vorschlags (Bestand 0, Margen-Min nicht mehr über der Buy Box, Buy Box 14 Tage darüber, Ablauf). */
    rueckkehrGrund: text("rueckkehr_grund"),
    /** B31.6b: Ziel der Rückkehr (Stufe 2 „Abverkauf“, Stufe 1 nur mit frischem Nachschub). */
    rueckkehrRegel: text("rueckkehr_regel"),
    beendetAm: timestamp("beendet_am", { withTimezone: true }),
    /** B31.6a: „Liquidation bis“ (Standard 45 Tage ab Regelwechsel), dauerhaft = ohne Enddatum. */
    bis: date("bis", { mode: "string" }),
    dauerhaft: boolean("dauerhaft").notNull().default(false),
    verlaengert: integer("verlaengert").notNull().default(0),
    /** Vorwarnung 7 Tage vor „bis“ verschickt (Push/Aufgabe mit drei Knöpfen). */
    ablaufGemeldetAm: timestamp("ablauf_gemeldet_am", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/** B31.6b/B31.8: täglicher Pflege-Stand je SKU und Land (Leiter-Zähler, Schnelldreher-Schutz). */
export const bqoolSkuPflege = pgTable(
  "bqool_sku_pflege",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    /** Effektiver Min der aktuellen Regel liegt seit diesem Tag über der Buy Box. */
    ueberSeit: date("ueber_seit", { mode: "string" }),
    /** Eigenes Angebot ohne Buy Box seit (Schnelldreher-Ende nach 21 Tagen). */
    ohneBuyboxSeit: date("ohne_buybox_seit", { mode: "string" }),
    schnelldreher: boolean("schnelldreher").notNull().default(false),
    schnellQuelle: text("schnell_quelle", { enum: ["auto", "hand"] }),
    schnellSeit: timestamp("schnell_seit", { withTimezone: true }),
    /** Sperre der Leiter bis (Schutz verlängern 14 Tage). */
    schnellBis: date("schnell_bis", { mode: "string" }),
    /** B31.7c: pausiertes Angebot nach Freigabe aktivieren (Enable Repricing = 1 in der nächsten Datei). */
    aktivieren: boolean("aktivieren").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/** B31.7: Zustand der Ware je SKU (land „*“ = alle Marktplätze), von Hand oder erkannt. */
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
 * B31.6b/B31.7/B31.8/B32: Vorschläge je SKU und Land (Stufenwechsel, Schnelldreher, Listing-Check). Wirksam erst nach
 * Freigabe – dann als Soll-Regel bzw. Min im nächsten BQool-Upload (B31.2), nie direkt in BQool.
 */
export const bqoolVorschlaege = pgTable(
  "bqool_vorschlaege",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    art: text("art").notNull(),
    vonRegel: text("von_regel"),
    nachRegel: text("nach_regel"),
    min: numeric("min", { precision: 12, scale: 2, mode: "number" }),
    gruende: jsonb("gruende").$type<string[]>().notNull().default([]),
    daten: jsonb("daten").$type<Record<string, unknown>>().notNull().default({}),
    /** B32: geschätztes Euro-Potenzial (fehlende Verkäufe × Marge) zum Sortieren. */
    potenzial: numeric("potenzial", { precision: 12, scale: 2, mode: "number" }),
    status: text("status", { enum: ["offen", "spaeter", "freigegeben", "abgelehnt", "erledigt", "veraltet"] }).notNull().default("offen"),
    spaeterBis: date("spaeter_bis", { mode: "string" }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    entschiedenVon: uuid("entschieden_von"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bqool_vorschlaege_offen_idx").on(t.tenantId, t.status, t.art), index("bqool_vorschlaege_sku_idx").on(t.tenantId, t.land, t.sku, t.art)],
);
