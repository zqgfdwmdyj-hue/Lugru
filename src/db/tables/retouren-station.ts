import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, lots, tenantId, updatedAt, users } from "./core";
import { claims } from "./claims";

// Retouren-Station: Remissionspakete am festen Arbeitsplatz prüfen (Kamera + Sprache). Ein Paket = eine Prüfung,
// darin die einzelnen Artikel (Positionen) und die Fotos/Videos. Die Dateien selbst liegen verschlüsselt in der
// Medienablage (MEDIA_DIR), hier nur die Verweise.

export const RETOUREN_BEFUNDE = ["ok", "leer", "falsches_produkt", "benutzt", "beschaedigt", "unvollstaendig"] as const;
export type RetourenBefund = (typeof RETOUREN_BEFUNDE)[number];
export const RETOUREN_ENTSCHEIDUNGEN = ["fall", "kein_fall", "zu_klein", "schon_erstattet", "laeuft_schon", "ohne_retoure", "warten"] as const;
export type RetourenEntscheidung = (typeof RETOUREN_ENTSCHEIDUNGEN)[number];
export const RETOUREN_VERBLEIB = ["fba", "b_ware", "ebay", "entsorgen", "hersteller"] as const;
export type RetourenVerbleib = (typeof RETOUREN_VERBLEIB)[number];
export const RETOUREN_MEDIEN_ARTEN = ["etikett", "lieferschein", "produkt_lpn", "inhalt", "video"] as const;
export type RetourenMedienArt = (typeof RETOUREN_MEDIEN_ARTEN)[number];

/** Erwartete Position laut Remissionsauftrag bzw. gelesene Position vom Lieferschein. */
export type RetourenZeile = { sku?: string | null; fnsku?: string | null; titel?: string | null; menge: number };

export const retourenPruefungen = pgTable(
  "retouren_pruefungen",
  {
    id: id(),
    tenantId: tenantId(),
    status: text("status", { enum: ["offen", "abgeschlossen", "abgebrochen"] }).notNull().default("offen"),
    /** Amazon-Remissionsauftrag (z. B. „ZtwgdOGck9“), über das Versandetikett oder von Hand zugeordnet. */
    remissionId: text("remission_id"),
    zuordnung: text("zuordnung", { enum: ["etikett", "lieferschein", "manuell", "artikel"] }),
    sendungsnummer: text("sendungsnummer"),
    versender: text("versender"),
    erwartet: jsonb("erwartet").$type<RetourenZeile[]>(),
    lieferschein: jsonb("lieferschein").$type<RetourenZeile[]>(),
    abweichungen: jsonb("abweichungen").$type<string[]>().notNull().default([]),
    notiz: text("notiz"),
    zusammenfassung: text("zusammenfassung"),
    videoTeile: integer("video_teile").notNull().default(0),
    angelegtVon: uuid("angelegt_von").references(() => users.id, { onDelete: "set null" }),
    angelegtAm: timestamp("angelegt_am", { withTimezone: true }).notNull().defaultNow(),
    abgeschlossenAm: timestamp("abgeschlossen_am", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [index("retouren_pruefungen_tenant_idx").on(t.tenantId, t.angelegtAm), index("retouren_pruefungen_status_idx").on(t.tenantId, t.status)],
);

export const retourenPositionen = pgTable(
  "retouren_positionen",
  {
    id: id(),
    tenantId: tenantId(),
    pruefungId: uuid("pruefung_id")
      .notNull()
      .references(() => retourenPruefungen.id, { onDelete: "cascade" }),
    nr: integer("nr").notNull(),
    /** Wie der Artikel gefunden wurde: LPN (Kundenretoure), FNSKU/EAN/SKU (Bestand) oder gar nicht. */
    zuordnung: text("zuordnung", { enum: ["lpn", "fnsku", "ean", "sku", "unbekannt"] }).notNull().default("unbekannt"),
    lpn: text("lpn"),
    fnsku: text("fnsku"),
    sku: text("sku"),
    asin: text("asin"),
    titel: text("titel"),
    bestellnummer: text("bestellnummer"),
    rueckgabeDatum: date("rueckgabe_datum", { mode: "string" }),
    rueckgabegrund: text("rueckgabegrund"),
    kundenkommentar: text("kundenkommentar"),
    /** Zustand laut Amazon (detailed-disposition), z. B. CUSTOMER_DAMAGED. */
    amazonZustand: text("amazon_zustand"),
    /** An den Kunden erstattet (laut Transaktionen/Abrechnung). */
    erstattetBetrag: numeric("erstattet_betrag", { precision: 12, scale: 2, mode: "number" }),
    /** Von Amazon an dich für diese Bestellung schon gezahlt (Erstattungsbericht). */
    amazonGezahlt: numeric("amazon_gezahlt", { precision: 12, scale: 2, mode: "number" }),
    befund: text("befund", { enum: RETOUREN_BEFUNDE }),
    kiEinschaetzung: jsonb("ki_einschaetzung").$type<Record<string, unknown>>(),
    kiAbweichung: boolean("ki_abweichung").notNull().default(false),
    entscheidung: text("entscheidung", { enum: RETOUREN_ENTSCHEIDUNGEN }),
    verbleib: text("verbleib", { enum: RETOUREN_VERBLEIB }),
    retSku: text("ret_sku"),
    retChargeId: uuid("ret_charge_id").references(() => lots.id, { onDelete: "set null" }),
    /** Schlüssel des Anspruchs in „Ansprüche“ (detection_key) und – sobald angelegt – seine ID. */
    anspruchSchluessel: text("anspruch_schluessel"),
    anspruchId: uuid("anspruch_id").references(() => claims.id, { onDelete: "set null" }),
    fallBetreff: text("fall_betreff"),
    fallTextDe: text("fall_text_de"),
    fallTextEn: text("fall_text_en"),
    notiz: text("notiz"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("retouren_positionen_pruefung_idx").on(t.tenantId, t.pruefungId),
    index("retouren_positionen_lpn_idx").on(t.tenantId, t.lpn),
    index("retouren_positionen_anspruch_idx").on(t.tenantId, t.anspruchId),
  ],
);

export const retourenMedien = pgTable(
  "retouren_medien",
  {
    id: id(),
    tenantId: tenantId(),
    pruefungId: uuid("pruefung_id")
      .notNull()
      .references(() => retourenPruefungen.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").references(() => retourenPositionen.id, { onDelete: "cascade" }),
    art: text("art", { enum: RETOUREN_MEDIEN_ARTEN }).notNull(),
    /** Reihenfolge innerhalb der Art (Inhalt 1, 2, 3 …). */
    nr: integer("nr").notNull().default(1),
    /** Schlüssel in der Medienablage; bei Videos der Stamm, die Teile heißen <pfad>.<n>. */
    pfad: text("pfad").notNull(),
    teile: integer("teile").notNull().default(1),
    mime: text("mime").notNull(),
    groesse: integer("groesse").notNull().default(0),
    /** Von der KI gelesene Angaben (nur die benötigten Felder, keine Empfängeradresse). */
    kiDaten: jsonb("ki_daten").$type<Record<string, unknown>>(),
    aufgenommenAm: timestamp("aufgenommen_am", { withTimezone: true }).notNull().defaultNow(),
    loeschenAb: date("loeschen_ab", { mode: "string" }),
    geloeschtAm: timestamp("geloescht_am", { withTimezone: true }),
  },
  (t) => [index("retouren_medien_pruefung_idx").on(t.tenantId, t.pruefungId), index("retouren_medien_loeschen_idx").on(t.tenantId, t.loeschenAb)],
);
