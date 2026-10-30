import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bankUmsaetze } from "./bank";
import { createdAt, id, money, tenantId, users } from "./core";
import { invoices } from "./invoices";

// Buchhaltung (Modul 5): Uploads mit Saldo-Kontrolle, Zuordnung Zahlung ↔ Beleg, Buchungen (SKR04) mit
// Festschreibung, gelernte Kontierungsregeln, Exporte und ein unveränderbares Protokoll (GoBD). Je Firma.

export const buchhaltungImporte = pgTable(
  "buchhaltung_importe",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    art: text("art", { enum: ["sparkasse", "amex"] }).notNull(),
    dateiname: text("dateiname").notNull(),
    von: date("von", { mode: "string" }),
    bis: date("bis", { mode: "string" }),
    neu: integer("neu").notNull().default(0),
    doppelt: integer("doppelt").notNull().default(0),
    /** Summe aller Umsätze der Datei (Bank: Saldo-Veränderung; Amex: Belastungen − Gutschriften). */
    summe: money("summe"),
    anfangssaldo: money("anfangssaldo"),
    endsaldo: money("endsaldo"),
    userId: uuid("user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("bh_importe_idx").on(t.tenantId, t.firma, t.createdAt)],
);

export const ZUORDNUNG_ARTEN = ["beleg", "amex_sammel", "marktplatz", "ohne_beleg"] as const;

export const belegZuordnungen = pgTable(
  "beleg_zuordnungen",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    umsatzId: uuid("umsatz_id")
      .notNull()
      .references(() => bankUmsaetze.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "restrict" }),
    art: text("art", { enum: ZUORDNUNG_ARTEN }).notNull(),
    betrag: money("betrag").notNull(),
    sicherheit: text("sicherheit", { enum: ["hoch", "mittel", "niedrig"] }).notNull(),
    regel: text("regel").notNull(),
    status: text("status", { enum: ["vorschlag", "bestaetigt", "abgelehnt"] }).notNull(),
    /** Amex-Sammelabbuchung: die Kartenumsätze; Marktplatz: Abrechnungs-ID. */
    details: jsonb("details").$type<{ kartenUmsaetze?: string[]; abrechnungId?: string; automatisch?: boolean }>().notNull().default({}),
    bestaetigtVon: uuid("bestaetigt_von").references(() => users.id, { onDelete: "set null" }),
    bestaetigtAm: timestamp("bestaetigt_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("bh_zuordnung_umsatz_idx").on(t.tenantId, t.umsatzId), index("bh_zuordnung_beleg_idx").on(t.tenantId, t.invoiceId)],
);

export const buchungen = pgTable(
  "buchungen",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    /** JJJJ-MM des Buchungsdatums (Festschreibung je Monat). */
    monat: text("monat").notNull(),
    datum: date("datum", { mode: "string" }).notNull(),
    /** Immer positiv; Richtung über `sollHaben` (bezogen auf `konto`). */
    betrag: money("betrag").notNull(),
    sollHaben: text("soll_haben", { enum: ["S", "H"] }).notNull(),
    konto: text("konto").notNull(),
    gegenkonto: text("gegenkonto").notNull(),
    buSchluessel: text("bu_schluessel"),
    belegfeld1: text("belegfeld1").notNull().default(""),
    buchungstext: text("buchungstext").notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "restrict" }),
    umsatzId: uuid("umsatz_id").references(() => bankUmsaetze.id, { onDelete: "restrict" }),
    zuordnungId: uuid("zuordnung_id"),
    quelle: text("quelle", { enum: ["regel", "vorschlag", "hand", "storno"] }).notNull(),
    hinweis: text("hinweis"),
    status: text("status", { enum: ["vorschlag", "bestaetigt", "festgeschrieben"] }).notNull(),
    /** Storno-Buchung verweist auf die stornierte Buchung. */
    stornoVon: uuid("storno_von"),
    festgeschriebenAm: timestamp("festgeschrieben_am", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("buchungen_monat_idx").on(t.tenantId, t.firma, t.monat), index("buchungen_beleg_idx").on(t.tenantId, t.invoiceId)],
);

/** Gelernt aus Bestätigungen: Lieferant → Konto/Steuerschlüssel. */
export const kontierungsRegeln = pgTable(
  "kontierungs_regeln",
  {
    id: id(),
    tenantId: tenantId(),
    schluessel: text("schluessel").notNull(),
    konto: text("konto").notNull(),
    buSchluessel: text("bu_schluessel"),
    anzahl: integer("anzahl").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kontierungs_regeln_uq").on(t.tenantId, t.schluessel)],
);

export const buchhaltungExporte = pgTable(
  "buchhaltung_exporte",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    monat: text("monat").notNull(),
    art: text("art", { enum: ["datev", "csv_zip"] }).notNull(),
    buchungen: integer("buchungen").notNull(),
    belege: integer("belege").notNull().default(0),
    summe: money("summe"),
    festgeschrieben: boolean("festgeschrieben").notNull().default(false),
    userId: uuid("user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("bh_exporte_idx").on(t.tenantId, t.firma, t.monat)],
);

/** Amazon-Umsatzsteuerbericht je Monat, aufbereitet (Summen je Land; keine Einzelzeilen). */
export const ustAuswertungen = pgTable(
  "ust_auswertungen",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    monat: text("monat").notNull(),
    daten: jsonb("daten").notNull(),
    dateiname: text("dateiname").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ust_auswertungen_uq").on(t.tenantId, t.firma, t.monat)],
);

/** Wer hat was wann geändert – nur Anhängen; Ändern/Löschen verhindert ein Trigger in der Datenbank. */
export const buchhaltungProtokoll = pgTable(
  "buchhaltung_protokoll",
  {
    id: id(),
    tenantId: tenantId(),
    objekt: text("objekt").notNull(),
    objektId: text("objekt_id"),
    aktion: text("aktion").notNull(),
    vorher: jsonb("vorher"),
    nachher: jsonb("nachher"),
    userId: uuid("user_id"),
    userName: text("user_name"),
    createdAt: createdAt(),
  },
  (t) => [index("bh_protokoll_idx").on(t.tenantId, t.createdAt)],
);
