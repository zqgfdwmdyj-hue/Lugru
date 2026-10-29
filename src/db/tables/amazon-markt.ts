import { index, jsonb, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { tenantId } from "./core";

// Amazon je Land (über die Schnittstelle abgerufen, je Land und Bericht komplett ersetzt):
// Buy-Box-Anteil und Kaufquote (Sales and Traffic, 30 Tage), Listung (Alle Angebote), Lageralter/Aufschlag (Bestandsplanung).

const n = (name: string, scale = 2) => numeric(name, { precision: 14, scale, mode: "number" });

export const amazonBuybox = pgTable(
  "amazon_buybox",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    asin: text("asin").notNull(),
    elternAsin: text("eltern_asin"),
    sku: text("sku"),
    von: text("von"),
    bis: text("bis"),
    sitzungen: n("sitzungen", 0),
    seitenaufrufe: n("seitenaufrufe", 0),
    buyboxProzent: n("buybox_prozent"),
    kaufquoteProzent: n("kaufquote_prozent"),
    einheiten: n("einheiten", 0),
    umsatz: n("umsatz"),
    waehrung: text("waehrung"),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.asin] })],
);

export const amazonListungen = pgTable(
  "amazon_listungen",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    titel: text("titel"),
    preis: n("preis"),
    menge: n("menge", 0),
    status: text("status"),
    versand: text("versand"),
    erstellt: text("erstellt"),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] }), index("amazon_listungen_asin_idx").on(t.tenantId, t.asin)],
);

export const amazonLageralter = pgTable(
  "amazon_lageralter",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    fnsku: text("fnsku"),
    titel: text("titel"),
    verfuegbar: n("verfuegbar", 0),
    alter: jsonb("alter").$type<Record<string, number>>().notNull().default({}),
    stueckMitAufschlag: n("stueck_mit_aufschlag", 0),
    aufschlagGeschaetzt: n("aufschlag_geschaetzt"),
    lagerkostenNaechsterMonat: n("lagerkosten_naechster_monat"),
    empfehlung: text("empfehlung"),
    gesundheit: text("gesundheit"),
    waehrung: text("waehrung"),
    stichtag: text("stichtag"),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);

/**
 * Amazon Business: Werte je ASIN und Zeitraum (gesamt und B2B) – aus dem Bericht „Sales and Traffic“ (SP-API, 30 Tage)
 * oder dem hochgeladenen Geschäftsbericht. Je Land und Zeitraum ersetzt; ältere Zeiträume bleiben für den Vergleich.
 */
export const amazonB2bPerioden = pgTable(
  "amazon_b2b_perioden",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    von: text("von").notNull(),
    bis: text("bis").notNull(),
    asin: text("asin").notNull(),
    sku: text("sku"),
    titel: text("titel"),
    sitzungen: n("sitzungen", 0),
    sitzungenB2b: n("sitzungen_b2b", 0),
    einheiten: n("einheiten", 0),
    einheitenB2b: n("einheiten_b2b", 0),
    umsatz: n("umsatz"),
    umsatzB2b: n("umsatz_b2b"),
    buybox: n("buybox"),
    buyboxB2b: n("buybox_b2b"),
    quelle: text("quelle", { enum: ["api", "upload"] }).notNull(),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.von, t.bis, t.asin] }), index("amazon_b2b_perioden_bis_idx").on(t.tenantId, t.bis)],
);

export type StaffelStufe = { ab: number; preis: number; gewinn: number; marge: number; ok: boolean; hinweis: string | null };

/**
 * Staffelpreise (Amazon Business) je Land und SKU: Vorschlag → Freigabe (Inhaber) → Upload-Datei oder Übertragung
 * über die Schnittstelle. Übertragen wird nur, was freigegeben ist.
 */
export const amazonStaffelpreise = pgTable(
  "amazon_staffelpreise",
  {
    tenantId: tenantId(),
    land: text("land").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    titel: text("titel"),
    businessPreis: n("business_preis"),
    stufen: jsonb("stufen").$type<StaffelStufe[]>().notNull().default([]),
    mindestPreis: n("mindest_preis"),
    status: text("status", { enum: ["vorschlag", "freigegeben", "uebertragen", "fehler"] }).notNull().default("vorschlag"),
    fehler: text("fehler"),
    freigegebenVon: text("freigegeben_von"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    uebertragenAm: timestamp("uebertragen_am", { withTimezone: true }),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.land, t.sku] })],
);
