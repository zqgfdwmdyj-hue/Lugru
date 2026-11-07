import { boolean, index, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    quelle: text("quelle", { enum: ["vorlage", "hand", "kapital"] }).notNull(),
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
export type BqoolLaufZusammenfassung = { jeLand: Record<string, number>; gesamt: number; regelWechsel: number; warnungen: number; unterBreakEven: number };
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
