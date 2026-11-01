import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tasks, tenantId, users } from "./core";

// Apple Watch (Bauauftrag Handy-Tesla §10): Rückfragen per Nummer („welche? 1 … 2 … 3 …“ → „Nummer 2“) und
// Nachrichten an die VA, die im Modus „Vorschlag“ erst nach Ludwigs Freigabe in den VA-Kanal gehen.

export type WatchOption = { id: string; titel: string; art?: "aufgabe" | "amazon_todo"; sku?: string; alt?: number | null };

export const watchRueckfragen = pgTable(
  "watch_rueckfragen",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** erledigt / bestand */
    art: text("art", { enum: ["erledigt", "bestand"] }).notNull(),
    optionen: jsonb("optionen").$type<WatchOption[]>().notNull(),
    /** Bei „bestand“: die genannte Menge. */
    menge: integer("menge"),
    createdAt: createdAt(),
  },
  (t) => [index("watch_rueckfragen_user_idx").on(t.tenantId, t.userId, t.art, t.createdAt)],
);

export const vaEntwuerfe = pgTable(
  "va_entwuerfe",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    textDe: text("text_de").notNull(),
    /** So ginge es an die VA (bei englischsprachiger VA übersetzt). */
    textVa: text("text_va").notNull(),
    sprache: text("sprache").notNull().default("en"),
    herkunft: text("herkunft").notNull().default("watch"),
    status: text("status", { enum: ["offen", "gesendet", "verworfen", "fehler"] }).notNull().default("offen"),
    fehler: text("fehler"),
    /** Aufgabe „VA-Nachricht freigeben“ für Ludwig – wird beim Senden/Verwerfen erledigt. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
  },
  (t) => [index("va_entwuerfe_status_idx").on(t.tenantId, t.status, t.createdAt)],
);
