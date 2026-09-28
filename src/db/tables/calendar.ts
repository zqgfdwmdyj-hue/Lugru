import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, date } from "drizzle-orm/pg-core";
import { createdAt, id, tasks, tenantId, updatedAt } from "./core";

// Kalender-Abgleich (Apple iCloud oder anderer CalDAV-Kalender) und Themen-Recherche.

/** Termine, die das System in den Kalender „Seller-System" schreibt – je Quelle einer. */
export const calendarItems = pgTable(
  "calendar_items",
  {
    id: id(),
    tenantId: tenantId(),
    /** Herkunft, z. B. task:<id>, case:<id>, claims:<Datum>, ship:<Datum>, cash:<id>:<Datum>. */
    sourceKey: text("source_key").notNull(),
    uid: text("uid").notNull(),
    href: text("href").notNull(),
    etag: text("etag"),
    /** Prüfsumme des zuletzt geschriebenen Inhalts – nur bei Änderung neu schreiben. */
    hash: text("hash").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("calendar_items_key_uq").on(t.tenantId, t.sourceKey), uniqueIndex("calendar_items_uid_uq").on(t.tenantId, t.uid)],
);

/** Eigene Termine aus den übrigen Kalendern (nur lesen) – für Startseite und Kalenderansicht. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id(),
    tenantId: tenantId(),
    calendarName: text("calendar_name").notNull(),
    /** Farbe des Kalenders wie in Apple Kalender (#RRGGBB). */
    color: text("color"),
    uid: text("uid").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    /** Bei ganztägigen Terminen das Datum. */
    day: date("day", { mode: "string" }).notNull(),
    location: text("location"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calendar_events_uq").on(t.tenantId, t.uid, t.startsAt), index("calendar_events_day_idx").on(t.tenantId, t.day)],
);

/** Fundstücke der Themen-Recherche (Nachrichten zu den eingestellten Themen). */
export const researchItems = pgTable(
  "research_items",
  {
    id: id(),
    tenantId: tenantId(),
    topic: text("topic").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    titleKey: text("title_key").notNull(),
    source: text("source"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    snippet: text("snippet"),
    knowledgeId: uuid("knowledge_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("research_url_uq").on(t.tenantId, t.url), index("research_title_idx").on(t.tenantId, t.titleKey), index("research_topic_idx").on(t.tenantId, t.topic, t.createdAt)],
);
