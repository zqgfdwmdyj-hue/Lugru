import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { apiTokens } from "./deal-eingang";
import { encryptedJson, encryptedText } from "./encrypted";

// Handy-Endpunkte (/api/mobil/*): Protokoll je Aufruf (für Rate-Limit und Nachvollziehbarkeit) und die
// Eingangsliste der Schnellerfassung (Diktate, die bestätigt werden müssen). Diktate können Privates enthalten –
// daher verschlüsselt und nur für die Person sichtbar, die sie diktiert hat.

export const mobilProtokoll = pgTable(
  "mobil_protokoll",
  {
    id: id(),
    tenantId: tenantId(),
    tokenId: uuid("token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    endpunkt: text("endpunkt").notNull(),
    status: integer("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("mobil_protokoll_token_idx").on(t.tokenId, t.createdAt), index("mobil_protokoll_tenant_idx").on(t.tenantId, t.createdAt)],
);

export type SchnellDaten = {
  text: string;
  /** Einordnung (Regeln bzw. KI) – siehe src/lib/schnell/logic.ts. */
  einordnung: { art: string; titel: string; tag: string | null; uhrzeit: string | null; zustaendigId: string | null; privatArt: string | null; ean: string | null; preis: number | null; grund: string };
  /** Was angelegt wurde (zum Nachsehen). */
  ergebnis?: string;
};

export const schnellEingaenge = pgTable(
  "schnell_eingaenge",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    daten: encryptedJson<SchnellDaten>("daten").notNull(),
    /** offen = wartet auf Bestätigung; angelegt; verworfen. */
    status: text("status", { enum: ["offen", "angelegt", "verworfen"] }).notNull().default("offen"),
    /** Art des Angelegten (aufgabe, termin, notiz …) – ohne Inhalt. */
    art: text("art"),
    /** ID des angelegten Datensatzes (Aufgabe, Privat-Eintrag, Wissen, Deal-Eingang). */
    zielId: text("ziel_id"),
    erledigtAt: timestamp("erledigt_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("schnell_eingaenge_user_idx").on(t.tenantId, t.userId, t.status)],
);

/**
 * Wichtige Meldungen per SMS (B13): nur an Ludwigs Nummer, kurz und vorlesbar, mit Kurz-Code [F12] für die Antwort
 * (VA / SPÄTER / OK / KAUFEN n). Keine Kunden- oder Privatdaten. Antworten lösen nur Aufgaben oder Entwürfe aus.
 */
export const smsMeldungen = pgTable(
  "sms_meldungen",
  {
    id: id(),
    tenantId: tenantId(),
    /** Kurz-Code, z. B. „F12“ (je Mandant fortlaufend). */
    ref: text("ref").notNull(),
    art: text("art", { enum: ["konto", "frist", "deal", "va", "test"] }).notNull(),
    text: encryptedText("text").notNull(),
    /** Bezug: Aufgabe, Deal-Eingang oder Amazon-Vorgang (typ:id). */
    bezug: text("bezug"),
    /** Eindeutiger Schlüssel gegen doppelte SMS (z. B. „deal:<id>“). */
    schluessel: text("schluessel").notNull(),
    status: text("status", { enum: ["gesendet", "unterdrueckt", "fehler", "beantwortet"] }).notNull(),
    grund: text("grund"),
    antwort: encryptedText("antwort"),
    ergebnis: text("ergebnis"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sms_meldungen_key_uq").on(t.tenantId, t.schluessel), index("sms_meldungen_ref_idx").on(t.tenantId, t.ref)],
);

/**
 * Fahrtenbuch (B13): Fahrten aus der Tesla Fleet API. Vorschlag geschäftlich/privat aus Orten und Kalender, Ludwig
 * bestätigt je Fahrt. Adressen verschlüsselt; private Fahrten zeigen im Geschäftsbereich nur „privat“.
 */
export const fahrten = pgTable(
  "fahrten",
  {
    id: id(),
    tenantId: tenantId(),
    /** Kennung der Fahrt beim Fahrzeug (gegen Dubletten). */
    quelleId: text("quelle_id").notNull(),
    beginn: timestamp("beginn", { withTimezone: true }).notNull(),
    ende: timestamp("ende", { withTimezone: true }),
    start: encryptedText("start"),
    ziel: encryptedText("ziel"),
    km: numeric("km", { precision: 8, scale: 1, mode: "number" }).notNull(),
    vorschlag: text("vorschlag", { enum: ["geschaeftlich", "privat"] }).notNull(),
    art: text("art", { enum: ["geschaeftlich", "privat"] }),
    zweck: encryptedText("zweck"),
    bestaetigtAt: timestamp("bestaetigt_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fahrten_quelle_uq").on(t.tenantId, t.quelleId), index("fahrten_beginn_idx").on(t.tenantId, t.beginn)],
);
