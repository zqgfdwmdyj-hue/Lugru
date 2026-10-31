import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt, users } from "./core";
import { encryptedJson } from "./encrypted";

/**
 * Bereich „Privat“: Paar-Kalender, Kinderzeit, Therapie-Aufgaben und -Termine, ADHS-Tagebuch,
 * Einstellungen. Der Inhalt (auch Datum und Uhrzeit) liegt komplett verschlüsselt in `data` –
 * in der Datenbank und in Sicherungen steht nur Chiffretext. Gefiltert wird nach dem Entschlüsseln.
 */
export const privateEntries = pgTable(
  "private_entries",
  {
    id: id(),
    tenantId: tenantId(),
    /** Wer den Eintrag angelegt hat (Tagebuch: wessen Tagebuch). */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** intim | paarzeit | kinder | ausschlafen | aufgabe | termin | tagebuch | beobachtung | gespraech | einstellungen */
    kind: text("kind").notNull(),
    data: encryptedJson<Record<string, unknown>>("data").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("private_entries_kind_idx").on(t.tenantId, t.kind)],
);
