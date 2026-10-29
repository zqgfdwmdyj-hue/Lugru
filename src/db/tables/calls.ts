import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tasks, tenantId } from "./core";
import { encryptedText } from "./encrypted";

// Call-Archiv (Calls mit dem Amazon-Consultant): Transkript (verschlüsselt), daraus von der KI gezogene Punkte
// (Vereinbarungen, Aufgaben, Entscheidungen, offene Fragen) – Aufgaben erst nach Bestätigung.

export const calls = pgTable(
  "calls",
  {
    id: id(),
    tenantId: tenantId(),
    titel: text("titel").notNull(),
    datum: date("datum", { mode: "string" }).notNull(),
    quelle: text("quelle", { enum: ["text", "google_doc", "discord"] }).notNull(),
    /** Google-Doc-ID bzw. Discord-Nachricht – gegen doppelten Import. */
    quelleRef: text("quelle_ref"),
    transkript: encryptedText("transkript").notNull(),
    auswertung: text("auswertung", { enum: ["offen", "fertig", "fehler", "ohne_ki"] }).notNull().default("offen"),
    auswertungFehler: text("auswertung_fehler"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calls_quelle_uq").on(t.tenantId, t.quelleRef), index("calls_datum_idx").on(t.tenantId, t.datum)],
);

export const CALL_PUNKT_ARTEN = ["vereinbarung", "aufgabe", "entscheidung", "frage"] as const;

export const callPunkte = pgTable(
  "call_punkte",
  {
    id: id(),
    tenantId: tenantId(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    art: text("art", { enum: CALL_PUNKT_ARTEN }).notNull(),
    text: text("text").notNull(),
    /** „ich“, „consultant“ oder ein Name. */
    verantwortlich: text("verantwortlich"),
    frist: date("frist", { mode: "string" }),
    /** Fundstelle im Transkript (kurzer Ausschnitt) und Position (Zeichen). */
    zitat: text("zitat"),
    position: integer("position"),
    status: text("status", { enum: ["vorschlag", "uebernommen", "verworfen", "geklaert"] }).notNull().default("vorschlag"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }),
  },
  (t) => [index("call_punkte_call_idx").on(t.tenantId, t.callId)],
);
