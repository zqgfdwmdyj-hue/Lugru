import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Fehlversuche in Folge – ab 3 gilt das Abo als abgelaufen (wird beim nächsten Öffnen der App neu angefordert). */
    fehlerAnzahl: integer("fehler_anzahl").notNull().default(0),
    abgelaufenAm: timestamp("abgelaufen_am", { withTimezone: true }),
    /** Letzte erfolgreiche Übergabe an den Push-Dienst. */
    okAm: timestamp("ok_am", { withTimezone: true }),
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
    /** Worauf sich die Meldung bezieht (Apple Watch „Erledigt“ schließt genau das; 24 Std. gemerkt). */
    bezug: jsonb("bezug").$type<{ art: "aufgabe" | "amazon_todo"; id: string; titel: string } | null>(),
    /** Art der Meldung (Einstellungen → Benachrichtigungen, je Art an/aus) und ob sie in der Ruhezeit durchkommt. */
    art: text("art").notNull().default("sonstiges"),
    kritisch: boolean("kritisch").notNull().default(false),
    /**
     * Protokoll: gesendet | fehlgeschlagen | kein_geraet | zurueckgehalten (Ruhezeit, kommt morgens) | ausgeschaltet
     * (Art aus) | ausgeliefert (morgens nachgereicht).
     */
    zustand: text("zustand").notNull().default("gesendet"),
    pushGesendet: integer("push_gesendet").notNull().default(0),
    pushFehler: integer("push_fehler").notNull().default(0),
    /** Discord parallel: true = gesendet, false = nicht gesendet (Fehler/nicht eingerichtet), null = nicht vorgesehen (privat). */
    discord: boolean("discord"),
    /** Das Gerät hat die Meldung abgeholt (Service Worker nach dem Anstoß) = zugestellt. */
    zugestelltAm: timestamp("zugestellt_am", { withTimezone: true }),
    /** Nur für den Test-Push: genau dieses Abo. */
    nurAboId: uuid("nur_abo_id"),
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
