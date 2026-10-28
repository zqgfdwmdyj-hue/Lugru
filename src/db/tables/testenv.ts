import { index, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId } from "./core";
import { encryptedText } from "./encrypted";

/**
 * Testumgebung (TESTUMGEBUNG=1): Mails, die das System verschicken würde, landen hier statt beim Empfänger.
 * Im normalen Betrieb bleibt die Tabelle leer.
 */
export const testMails = pgTable(
  "test_mails",
  {
    id: id(),
    tenantId: tenantId(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    /** Inhalt (verschlüsselt wie andere Mail-Inhalte). */
    text: encryptedText("text"),
    attachments: text("attachments"),
    createdAt: createdAt(),
  },
  (t) => [index("test_mails_idx").on(t.tenantId, t.createdAt)],
);
