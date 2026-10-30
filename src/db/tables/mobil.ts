import { index, pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { apiTokens } from "./deal-eingang";
import { encryptedJson } from "./encrypted";

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
