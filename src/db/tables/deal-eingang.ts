import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { encryptedText } from "./encrypted";

// Deal-Eingang: Angebote, die Ludwig aus WhatsApp (oder Mail, Kurzbefehl, von Hand) teilt. Rohtext verschlüsselt,
// weil WhatsApp-Texte Namen und Telefonnummern Dritter enthalten können; nach der Aufbewahrungsfrist gelöscht.
// Nicht im Wissen ablegen.

/** Erkanntes Angebot (so wie es in der Nachricht stand). */
export type DealAngebot = {
  asin: string | null;
  ean: string | null;
  name: string | null;
  marke: string | null;
  ek: number | null;
  /** true = netto, false = brutto, null = unklar */
  ekNetto: boolean | null;
  waehrung: string;
  menge: number | null;
  moq: number | null;
  staffel: string | null;
  versand: string | null;
  lieferzeit: string | null;
  zahlung: string | null;
  gueltigBis: string | null;
  zustand: string | null;
  packung: number | null;
};

export type DealLandZeile = { land: string; vkEur: number | null; vk90Eur: number | null; tief12Eur: number | null; verkaeufeMonat: number | null; angebote: number | null; amazonProzent: number | null; gewinn: number | null; gewinnAktuell: number | null; roi: number | null; marge: number | null; maxEk: number | null; fehler: string | null };

/** Eine geprüfte Zeile (ein Angebot) mit Ampel, höchstens drei Gründen, Länder-Tabelle und eigener Lage. */
export type DealEingangZeile = {
  nr: number;
  angebot: DealAngebot;
  asin: string | null;
  /** Wie die ASIN gefunden wurde. */
  zuordnung: "asin" | "ean" | "titel" | "keine";
  /** Weitere Treffer (EAN mit mehreren ASINs, Titelsuche) – zum Auswählen. */
  vorschlaege: { asin: string; titel: string; packung: number | null }[];
  titel: string | null;
  ampel: "gruen" | "gelb" | "rot";
  gruende: string[];
  bestesLand: string | null;
  ekNetto: number | null;
  gewinn: number | null;
  roi: number | null;
  marge: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  verkaeufeMonat: number | null;
  empfohlen: number | null;
  kapitalbedarf: number | null;
  maxEk: { land: string; ek: number }[];
  laender: DealLandZeile[];
  eigen: { bestand: number; unterwegs: number; proTag: number | null; reichweite: number | null; kapitalAmpel: "gruen" | "gelb" | "rot" | null; letzterEk: number | null; letzterEkQuelle: string | null; verlustStopp: string | null; bestellvorschlag: boolean } | null;
  risiken: string[];
  hinweise: string[];
  fehler: string | null;
  geprueftAm: string;
};

export const dealEingaenge = pgTable(
  "deal_eingaenge",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    weg: text("weg", { enum: ["manuell", "teilen", "kurzbefehl", "mail", "claude", "profitpath"] }).notNull(),
    /** Herkunft für Dubletten: „mail:<Message-ID>“, „pp:<Discord-Nachricht>“. */
    quelleRef: text("quelle_ref"),
    /** Schon strukturiert gelieferte Angebote (ProfitPath, Claude) – dann ohne KI-Erkennung. */
    angebote: jsonb("angebote").$type<DealAngebot[] | null>(),
    /** Geräte-Schlüssel, über den der Eingang kam (Kurzbefehl) – für Rate-Limit und Widerruf. */
    tokenId: uuid("token_id"),
    /** Absender/Quelle (z. B. „Konrad“) – von Hand oder aus dem Text erraten. */
    quelle: text("quelle"),
    rohtext: encryptedText("rohtext").notNull(),
    /** Dateien (Screenshot, PDF, Tabelle) in der Tabelle files. */
    dateiIds: jsonb("datei_ids").$type<string[]>().notNull().default([]),
    dateiNamen: jsonb("datei_namen").$type<string[]>().notNull().default([]),
    /** Prüfsumme über Text + Dateien – derselbe Eingang zweimal geteilt wird nicht doppelt geprüft. */
    inhaltKennung: text("inhalt_kennung").notNull(),
    pruefung: text("pruefung", { enum: ["offen", "laeuft", "fertig", "fehler"] }).notNull().default("offen"),
    fehler: text("fehler"),
    /** Entscheidung: neu → gekauft / Bestellvorschlag / B2B-Deal / verworfen; „preisliste“ = an den Preislisten-Scanner. */
    status: text("status", { enum: ["neu", "gekauft", "bestellvorschlag", "b2b", "verworfen", "preisliste"] }).notNull().default("neu"),
    grund: text("grund"),
    ampel: text("ampel", { enum: ["gruen", "gelb", "rot"] }),
    /** Kurztext wie in der Push-Nachricht. */
    zusammenfassung: text("zusammenfassung"),
    zeilen: jsonb("zeilen").$type<DealEingangZeile[]>().notNull().default([]),
    /** Erkannt ohne KI (Regeln) – Hinweis auf der Seite. */
    ohneKi: boolean("ohne_ki").notNull().default(false),
    preislisteId: uuid("preisliste_id"),
    b2bDealId: uuid("b2b_deal_id"),
    bestellungId: uuid("bestellung_id"),
    pushAm: timestamp("push_am", { withTimezone: true }),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("deal_eingaenge_tenant_idx").on(t.tenantId, t.createdAt), index("deal_eingaenge_quelle_idx").on(t.tenantId, t.quelle), index("deal_eingaenge_kennung_idx").on(t.tenantId, t.inhaltKennung), uniqueIndex("deal_eingaenge_ref_uq").on(t.tenantId, t.quelleRef)],
);

/**
 * Persönliche API-Schlüssel je Gerät (iPhone-Kurzbefehl „Deal prüfen“, später Schnellerfassung). Gespeichert wird
 * nur die Prüfsumme; der Schlüssel wird einmal beim Anlegen angezeigt. Widerrufen = sofort ungültig.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    zweck: text("zweck", { enum: ["deal_eingang"] }).notNull().default("deal_eingang"),
    tokenHash: text("token_hash").notNull(),
    /** Die ersten Zeichen zum Wiedererkennen („dk_Ab3x…“). */
    anfang: text("anfang").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.tenantId, t.userId)],
);

/** ProfitPath über Discord: gelesene Kanäle (Modul/Alarmgruppe) mit Lesestand. */
export const dealEingangKanaele = pgTable(
  "deal_eingang_kanaele",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: text("kanal_id").notNull(),
    name: text("name"),
    cursor: text("cursor"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deal_eingang_kanaele_uq").on(t.tenantId, t.kanalId)],
);
