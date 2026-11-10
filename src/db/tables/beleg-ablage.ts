import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { druckAgenten } from "./druck";

/**
 * B34.2 Beleg-Ablage: jede Datei, die der Agent am Arbeits-PC im Download-Ordner findet. Das Seller-System erkennt
 * Rechnung/Beleg/Kontoauszug, prüft Dubletten und sagt dem Agenten Zielordner und -namen; der Agent verschiebt und
 * meldet den Pfad zurück. Gelöscht wird nur eine Dublette nach Freigabe (loeschenFreigegebenAm) – vom Agenten.
 */
export const belegAblage = pgTable(
  "beleg_ablage",
  {
    id: id(),
    tenantId: tenantId(),
    agentId: uuid("agent_id").references(() => druckAgenten.id, { onDelete: "set null" }),
    hash: text("hash").notNull(),
    dateiname: text("dateiname").notNull(),
    groesse: integer("groesse").notNull().default(0),
    art: text("art", { enum: ["rechnung", "beleg", "kontoauszug", "sonstiges"] }),
    status: text("status", { enum: ["warten", "ablegen", "dublette", "kontoauszug", "liegen_lassen", "fehler"] }).notNull(),
    invoiceId: uuid("invoice_id"),
    dubletteVon: uuid("dublette_von"),
    dubletteGrund: text("dublette_grund"),
    lieferant: text("lieferant"),
    datum: text("datum"),
    betrag: numeric("betrag", { precision: 12, scale: 2, mode: "number" }),
    nummer: text("nummer"),
    ordner: text("ordner"),
    zielname: text("zielname"),
    /** Relativer Pfad in der Ablage nach dem Verschieben (Rückmeldung des Agenten). */
    pfad: text("pfad"),
    verschobenAm: timestamp("verschoben_am", { withTimezone: true }),
    loeschenFreigegebenAm: timestamp("loeschen_freigegeben_am", { withTimezone: true }),
    loeschenFreigegebenVon: uuid("loeschen_freigegeben_von").references(() => users.id, { onDelete: "set null" }),
    geloeschtAm: timestamp("geloescht_am", { withTimezone: true }),
    meldung: text("meldung"),
    createdAt: createdAt(),
  },
  (t) => [index("beleg_ablage_hash_idx").on(t.tenantId, t.hash), index("beleg_ablage_zeit_idx").on(t.tenantId, t.createdAt)],
);
