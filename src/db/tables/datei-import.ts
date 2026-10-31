import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

// Datei-Import über den Claude-Konnektor (Bauauftrag Datei-Import): „import_link“ legt einen Auftrag mit
// Einmal-Adresse an (Token nur als Hash), die Datei kommt per PUT, die Verarbeitung läuft über denselben Code wie der
// Upload in der Oberfläche. Die Datei liegt verschlüsselt in der Ablage und wird nach 90 Tagen gelöscht – das Ergebnis bleibt.

export const DATEI_IMPORT_STATUS = ["wartet_auf_datei", "verarbeitet", "fertig", "fehler"] as const;

export const dateiImporte = pgTable(
  "datei_importe",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    art: text("art").notNull(),
    dateiname: text("dateiname").notNull(),
    hinweis: text("hinweis"),
    tokenHash: text("token_hash").notNull(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    benutztAm: timestamp("benutzt_am", { withTimezone: true }),
    status: text("status", { enum: DATEI_IMPORT_STATUS }).notNull().default("wartet_auf_datei"),
    fortschritt: integer("fortschritt").notNull().default(0),
    groesse: bigint("groesse", { mode: "number" }),
    sha256: text("sha256"),
    /** Schlüssel in der verschlüsselten Ablage (null nach dem Löschen). */
    ablage: text("ablage"),
    /** Gleiche Datei schon importiert → Verweis auf den ersten Import. */
    bereitsImportId: uuid("bereits_import_id"),
    hochgeladenAm: timestamp("hochgeladen_am", { withTimezone: true }),
    fertigAm: timestamp("fertig_am", { withTimezone: true }),
    fehlerText: text("fehler_text"),
    ergebnis: jsonb("ergebnis").$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("datei_importe_token_uq").on(t.tokenHash), index("datei_importe_tenant_idx").on(t.tenantId, t.createdAt), index("datei_importe_hash_idx").on(t.tenantId, t.sha256)],
);
