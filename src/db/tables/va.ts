import { boolean, date, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, tasks, tenantId, tenants } from "./core";
import { claims } from "./claims";

// VA über Discord: ein Thread je zugewiesener Aufgabe (bzw. je Anfrage der VA), alle Nachrichten der VA mit
// Einordnung und Antwort, Lesestand des Kanals.

export const vaThreads = pgTable(
  "va_threads",
  {
    id: id(),
    tenantId: tenantId(),
    /**
     * aufgabe = Ludwig → VA; vom_va = Anfrage der VA im Kanal (Thread aus ihrer Nachricht); anspruch = Erstattungs-
     * anspruch automatisch an die VA (B18); sammel = Sammel-Thread über der Tagesgrenze.
     */
    art: text("art", { enum: ["aufgabe", "vom_va", "anspruch", "sammel"] }).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    claimId: uuid("claim_id").references(() => claims.id, { onDelete: "set null" }),
    /** Von der Automatik angelegt (zählt zur Tagesgrenze). */
    auto: boolean("auto").notNull().default(false),
    /** Sammel-Thread: Einträge mit Nummer (#1, #2 …). */
    eintraege: jsonb("eintraege").$type<VaSammelEintrag[]>().notNull().default([]),
    threadId: text("thread_id").notNull(),
    /** Aufgaben-Nachricht des Bots (✅/❓-Reaktionen) bzw. Nachricht der VA. */
    startNachrichtId: text("start_nachricht_id"),
    /** Zuletzt gelesene Nachricht im Thread. */
    cursor: text("cursor"),
    status: text("status", { enum: ["offen", "rueckfrage", "erledigt"] }).notNull().default("offen"),
    frageReaktion: boolean("frage_reaktion").notNull().default(false),
    letzteErinnerung: date("letzte_erinnerung", { mode: "string" }),
    /** Anspruch: am Fristtag Info an Ludwig geschickt. */
    ludwigInfoAm: date("ludwig_info_am", { mode: "string" }),
    /** Frist verpasst (Anspruch ohne Einreichung bzw. Aufgabe überfällig) – zählt in „VA heute“. */
    verpasstAm: timestamp("verpasst_am", { withTimezone: true }),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("va_threads_thread_uq").on(t.tenantId, t.threadId), index("va_threads_status_idx").on(t.tenantId, t.status), index("va_threads_task_idx").on(t.tenantId, t.taskId), index("va_threads_claim_idx").on(t.tenantId, t.claimId)],
);

export type VaSammelEintrag = { nr: number; typ: "anspruch" | "fall"; id: string; taskId: string | null; titel: string; kennungen: string[]; erledigt: boolean };

export type VaAnfrage = { typ: "rechnung" | "sendung" | "anspruch" | "auftrag" | "produkt" | "anleitung"; asin: string | null; sku: string | null; marke: string | null; lieferant: string | null; sendung: string | null; auftrag: string | null; suchtext: string | null };

export const vaNachrichten = pgTable(
  "va_nachrichten",
  {
    id: id(),
    tenantId: tenantId(),
    discordId: text("discord_id").notNull(),
    /** Kanal oder Thread, in dem die Nachricht steht. */
    kanalId: text("kanal_id").notNull(),
    threadId: text("thread_id"),
    von: text("von", { enum: ["va", "bot"] }).notNull(),
    text: text("text").notNull(),
    /** Originaltext, wenn die Nachricht übersetzt gespeichert ist (z. B. Englisch der VA → Deutsch). */
    original: text("original"),
    /** Erkannte Sprache des Originals (de/en/…). */
    sprache: text("sprache"),
    art: text("art", { enum: ["erledigt", "rueckfrage", "notiz", "bitte", "frage", "info", "smalltalk", "aufgabe", "antwort", "erinnerung", "auto"] }).notNull(),
    anfrage: jsonb("anfrage").$type<VaAnfrage | null>(),
    /** Aufgabe der VA, zu der die Nachricht gehört. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Für Ludwig angelegte Aufgabe (Rückfrage, Bitte, Frage). */
    ludwigTaskId: uuid("ludwig_task_id").references(() => tasks.id, { onDelete: "set null" }),
    autoBeantwortet: boolean("auto_beantwortet").notNull().default(false),
    /** Antwort des Bots bzw. Ludwigs (aus dem Seller-System). */
    antwort: text("antwort"),
    beantwortetAm: timestamp("beantwortet_am", { withTimezone: true }),
    dateiIds: jsonb("datei_ids").$type<string[]>().notNull().default([]),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("va_nachrichten_discord_uq").on(t.tenantId, t.discordId), index("va_nachrichten_zeit_idx").on(t.tenantId, t.gesendetAm)],
);

export const vaStand = pgTable("va_stand", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  kanalCursor: text("kanal_cursor"),
  letzterAbgleich: timestamp("letzter_abgleich", { withTimezone: true }),
  letzterFehler: text("letzter_fehler"),
  /** Letzte „Daily overview“ (einmal je Tag in VA-Zeit; „neu seit“ zählt ab hier). */
  uebersichtAm: timestamp("uebersicht_am", { withTimezone: true }),
});

/**
 * VA-Automatik (B18): je Anspruch bzw. Fall-Phase eine Entscheidung (an die VA / erst Ludwig / nie) mit Grund und
 * Ergebnis. Im Modus „Vorschlag“ steht hier, was an die VA gegangen wäre.
 */
export const vaAutomatik = pgTable(
  "va_automatik",
  {
    id: id(),
    tenantId: tenantId(),
    /** anspruch:<id> bzw. fall:<id>:<phase> – eine Entscheidung je Anspruch bzw. Fall-Phase. */
    schluessel: text("schluessel").notNull(),
    typ: text("typ", { enum: ["anspruch", "fall"] }).notNull(),
    bezugId: uuid("bezug_id").notNull(),
    kategorie: text("kategorie").notNull(),
    ziel: text("ziel", { enum: ["va", "ludwig", "nie"] }).notNull(),
    grund: text("grund").notNull(),
    modus: text("modus", { enum: ["vorschlag", "automatisch"] }).notNull(),
    /** vorschlag = wäre an die VA gegangen; gesendet = eigener Thread; sammel = im Sammel-Thread; ludwig/nie; uebernommen = Ludwig hat es von Hand an die VA gegeben. */
    status: text("status", { enum: ["vorschlag", "gesendet", "sammel", "ludwig", "nie", "fehler", "uebernommen"] }).notNull(),
    titel: text("titel").notNull(),
    betrag: money("betrag"),
    frist: date("frist", { mode: "string" }),
    threadId: text("thread_id"),
    fehler: text("fehler"),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("va_automatik_schluessel_uq").on(t.tenantId, t.schluessel), index("va_automatik_am_idx").on(t.tenantId, t.am)],
);

/** Übersetzungen zwischenspeichern (gleiche Textbausteine nicht erneut an die KI). */
export const uebersetzungen = pgTable(
  "uebersetzungen",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    nach: text("nach").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.hash, t.nach] })],
);
