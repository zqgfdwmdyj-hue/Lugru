import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { encryptedText } from "./encrypted";

// Push-Meldungen für die installierte App (Web Push ohne Inhalt: der Service Worker holt die Meldung selbst ab,
// so liegt nichts Vertrauliches beim Push-Dienst) und Systemschlüssel (VAPID, verschlüsselt).

export const pushAbos = pgTable(
  "push_abos",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    geraet: text("geraet"),
    createdAt: createdAt(),
    fehlerAm: timestamp("fehler_am", { withTimezone: true }),
  },
  (t) => [uniqueIndex("push_abos_endpoint_uq").on(t.endpoint), index("push_abos_user_idx").on(t.tenantId, t.userId)],
);

export const meldungen = pgTable(
  "meldungen",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    titel: text("titel").notNull(),
    text: text("text").notNull(),
    link: text("link"),
    /** Knöpfe in der Benachrichtigung (z. B. „Zum Angebot“, „Gekauft“) – je Knopf ein Link. */
    aktionen: jsonb("aktionen").$type<{ aktion: string; titel: string; link: string }[] | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("meldungen_user_idx").on(t.tenantId, t.userId, t.createdAt)],
);

/** Schlüssel des Systems (z. B. VAPID für Web Push) – verschlüsselt gespeichert. */
export const systemWerte = pgTable("system_werte", {
  schluessel: text("schluessel").primaryKey(),
  wert: encryptedText("wert").notNull(),
  createdAt: createdAt(),
});
