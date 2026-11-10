import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

/**
 * B34.2 Drive-Rechnungsordner (Anbindung „Google Drive (Rechnungsordner)“): je neuer Datei im Ordner ein Vorschlag –
 * umbenennen nach JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr und nach Monat/Lieferant ablegen, Kontoauszug in
 * „Kontoauszüge/JJJJ-MM“ (importiert, keine Rechnung), Dublette in „Dubletten“. Ausgeführt wird erst nach Freigabe
 * (Charge) und nur mit Schreibrecht; in den Papierkorb kommt eine Dublette nur nach eigener Freigabe.
 */
export const driveAblage = pgTable(
  "drive_ablage",
  {
    id: id(),
    tenantId: tenantId(),
    dateiId: text("datei_id").notNull(),
    dateiname: text("dateiname").notNull(),
    hash: text("hash"),
    art: text("art", { enum: ["rechnung", "beleg", "kontoauszug", "sonstiges"] }).notNull(),
    vorschlag: text("vorschlag", { enum: ["ablegen", "dublette", "kontoauszug", "liegen_lassen"] }).notNull(),
    zustand: text("zustand", { enum: ["vorschlag", "erledigt", "fehler", "verworfen"] }).notNull().default("vorschlag"),
    invoiceId: uuid("invoice_id"),
    dubletteVon: text("dublette_von"),
    dubletteGrund: text("dublette_grund"),
    lieferant: text("lieferant"),
    datum: text("datum"),
    betrag: numeric("betrag", { precision: 12, scale: 2, mode: "number" }),
    nummer: text("nummer"),
    zielOrdner: text("ziel_ordner"),
    zielName: text("ziel_name"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    freigegebenVon: uuid("freigegeben_von").references(() => users.id, { onDelete: "set null" }),
    ausgefuehrtAm: timestamp("ausgefuehrt_am", { withTimezone: true }),
    loeschenFreigegebenAm: timestamp("loeschen_freigegeben_am", { withTimezone: true }),
    loeschenFreigegebenVon: uuid("loeschen_freigegeben_von").references(() => users.id, { onDelete: "set null" }),
    /** In den Drive-Papierkorb verschoben (30 Tage wiederherstellbar) – nur nach Freigabe. */
    papierkorbAm: timestamp("papierkorb_am", { withTimezone: true }),
    meldung: text("meldung"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("drive_ablage_datei").on(t.tenantId, t.dateiId), index("drive_ablage_zustand").on(t.tenantId, t.zustand), index("drive_ablage_hash").on(t.tenantId, t.hash)],
);
