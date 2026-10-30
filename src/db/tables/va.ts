import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tasks, tenantId, tenants } from "./core";

// VA über Discord: ein Thread je zugewiesener Aufgabe (bzw. je Anfrage der VA), alle Nachrichten der VA mit
// Einordnung und Antwort, Lesestand des Kanals.

export const vaThreads = pgTable(
  "va_threads",
  {
    id: id(),
    tenantId: tenantId(),
    /** aufgabe = Ludwig → VA; vom_va = Anfrage der VA im Kanal (Thread aus ihrer Nachricht). */
    art: text("art", { enum: ["aufgabe", "vom_va"] }).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    threadId: text("thread_id").notNull(),
    /** Aufgaben-Nachricht des Bots (✅/❓-Reaktionen) bzw. Nachricht der VA. */
    startNachrichtId: text("start_nachricht_id"),
    /** Zuletzt gelesene Nachricht im Thread. */
    cursor: text("cursor"),
    status: text("status", { enum: ["offen", "rueckfrage", "erledigt"] }).notNull().default("offen"),
    frageReaktion: boolean("frage_reaktion").notNull().default(false),
    letzteErinnerung: date("letzte_erinnerung", { mode: "string" }),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("va_threads_thread_uq").on(t.tenantId, t.threadId), index("va_threads_status_idx").on(t.tenantId, t.status), index("va_threads_task_idx").on(t.tenantId, t.taskId)],
);

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
});
