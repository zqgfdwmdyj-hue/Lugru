import { date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, tenantId } from "./core";
import { encryptedText } from "./encrypted";

// Kontoauszüge: Geschäftskonto (Liquidität) und Privatkonto (Privat → Geld) getrennt über „bereich“. Namen und
// Verwendungszweck verschlüsselt; „gruppe“ ist ein Prüfwert zum Zusammenfassen wiederkehrender Abbuchungen.

/** „kreditkarte“ = Einzelumsätze der Firmen-Kreditkarte (Amex) – nie in Liquidität/Kontostand eingerechnet. */
export const BANK_BEREICHE = ["geschaeft", "privat", "kreditkarte"] as const;

export const bankUmsaetze = pgTable(
  "bank_umsaetze",
  {
    id: id(),
    tenantId: tenantId(),
    bereich: text("bereich", { enum: BANK_BEREICHE }).notNull(),
    /** Beim Privatkonto: wem es gehört (Privatbereich ist personenbezogen). */
    userId: uuid("user_id"),
    schluessel: text("schluessel").notNull(),
    konto: text("konto"),
    buchungstag: date("buchungstag", { mode: "string" }).notNull(),
    valuta: date("valuta", { mode: "string" }),
    betrag: money("betrag").notNull(),
    waehrung: text("waehrung").notNull().default("EUR"),
    gegenpartei: encryptedText("gegenpartei"),
    zweck: encryptedText("zweck"),
    /** IBAN der Gegenpartei (für den Abgleich mit Belegen). */
    gegenIban: encryptedText("gegen_iban"),
    /** Firma (Buchhaltung je Firma); leer = Hauptfirma. */
    firma: text("firma"),
    buchungstext: text("buchungstext"),
    glaeubigerId: text("glaeubiger_id"),
    mandat: text("mandat"),
    /** sha256 der Gruppe (Lastschrift-Mandat bzw. Name) – ohne Klartext. */
    gruppe: text("gruppe").notNull(),
    /** Von Hand gesetzte Kategorie (privat: Haushalt, Kinder …; geschäftlich: Fixkosten, Steuer …). */
    kategorie: text("kategorie"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bank_umsaetze_uq").on(t.tenantId, t.bereich, t.schluessel), index("bank_umsaetze_tag_idx").on(t.tenantId, t.bereich, t.buchungstag)],
);

/** Bekannte Kontostände (aus CAMT, Saldo-Spalte oder von Hand zum letzten Buchungstag). */
export const bankSalden = pgTable(
  "bank_salden",
  {
    id: id(),
    tenantId: tenantId(),
    bereich: text("bereich", { enum: BANK_BEREICHE }).notNull(),
    userId: uuid("user_id"),
    konto: text("konto").notNull().default(""),
    datum: date("datum", { mode: "string" }).notNull(),
    saldo: money("saldo").notNull(),
    quelle: text("quelle", { enum: ["camt", "csv", "pdf", "hand"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bank_salden_uq").on(t.tenantId, t.bereich, t.konto, t.datum)],
);
