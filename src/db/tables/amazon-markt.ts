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
