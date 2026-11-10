import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { encryptedBytea } from "./encrypted";

/**
 * Druckagent im Lager (Bauauftrag 08.11.): Geräte mit Token (nur Prüfsumme gespeichert, einmal angezeigt, widerrufbar),
 * Heartbeat alle 30 s mit Gerät, Betriebssystem, Version und Druckerliste. Umzug = neuer Agent, alter wird deaktiviert.
 */
export const druckAgenten = pgTable(
  "druck_agenten",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenAnfang: text("token_anfang").notNull(),
    angelegtVon: uuid("angelegt_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** Widerrufen bzw. durch Umzug deaktiviert – der Agent bekommt „abgemeldet“. */
    deaktiviertAm: timestamp("deaktiviert_am", { withTimezone: true }),
    deaktiviertGrund: text("deaktiviert_grund"),
    letzterKontakt: timestamp("letzter_kontakt", { withTimezone: true }),
    geraet: text("geraet"),
    os: text("os"),
    version: text("version"),
    systemStart: timestamp("system_start", { withTimezone: true }),
    letzterDruck: timestamp("letzter_druck", { withTimezone: true }),
    /** Druckerliste aus dem Heartbeat: Modell, Seriennummer, Medienbreite, Zustand (bereit/papier_leer/deckel_offen/aus …). */
    drucker: jsonb("drucker").$type<{ name: string; modell: string | null; seriennummer: string | null; medienBreite: number | null; zustand: string; fehler: string[]; shelly: boolean; autoAusAus: boolean | null }[]>().notNull().default([]),
    /** Weitere Medien aus der Agent-Konfiguration. */
    medien: jsonb("medien").$type<unknown[]>().notNull().default([]),
    /** Shelly-Steckdose je Drucker (nur Inhaber sieht/ändert sie), überwachter Ordner, Leerlauf bis Steckdose aus. */
    einstellungen: jsonb("einstellungen").$type<{ shelly?: Record<string, { typ: "gen1" | "gen2"; ip: string }>; ordner?: { pfad: string; intervallSek: number } | null; leerlaufAusMin?: number; /** B34.2 Download-Ordner → Beleg-Ablage */ belege?: { pfad: string; ablage: string } | null }>().notNull().default({}),
    /** Update-Protokoll des Agenten (letzte 20). */
    updates: jsonb("updates").$type<{ am: string; von: string; nach: string; ergebnis: string }[]>().notNull().default([]),
    /** Push „wartet seit 15 Minuten“ bzw. „offline“ bereits gemeldet. */
    offlineGemeldetAm: timestamp("offline_gemeldet_am", { withTimezone: true }),
  },
  (t) => [index("druck_agenten_tenant_idx").on(t.tenantId), index("druck_agenten_token_idx").on(t.tokenHash)],
);

/**
 * Druckaufträge (Warteschlange 7 Tage, Protokoll 90 Tage): wer, was, wie viele, welcher Drucker, Ergebnis.
 * Die Druckdaten (Brother-Raster) und die Vorschau liegen verschlüsselt in der Datenbank (Adressen auf DHL-Labels).
 */
export const druckAuftraege = pgTable(
  "druck_auftraege",
  {
    id: id(),
    tenantId: tenantId(),
    vorlage: text("vorlage").notNull(),
    titel: text("titel").notNull(),
    drucker: text("drucker").notNull(),
    medium: text("medium").notNull(),
    anzahl: integer("anzahl").notNull().default(1),
    seiten: integer("seiten").notNull().default(1),
    /** Seite im Seller-System, von der gedruckt wurde (Pfad). */
    seite: text("seite"),
    status: text("status", { enum: ["wartet", "abgeholt", "gedruckt", "fehler", "abgelaufen", "abgebrochen"] }).notNull().default("wartet"),
    meldung: text("meldung"),
    erstelltVon: uuid("erstellt_von").references(() => users.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => druckAgenten.id, { onDelete: "set null" }),
    daten: encryptedBytea("daten"),
    vorschau: encryptedBytea("vorschau"),
    sha256: text("sha256"),
    /** Eingabe der Vorlage (zum erneuten Drucken), ohne Druckbild. */
    eingabe: jsonb("eingabe").$type<Record<string, unknown>>().notNull().default({}),
    erneutVon: uuid("erneut_von"),
    dateiId: uuid("datei_id"),
    createdAt: createdAt(),
    abgeholtAm: timestamp("abgeholt_am", { withTimezone: true }),
    gedrucktAm: timestamp("gedruckt_am", { withTimezone: true }),
    pushGemeldetAm: timestamp("push_gemeldet_am", { withTimezone: true }),
    versuche: integer("versuche").notNull().default(0),
  },
  (t) => [index("druck_auftraege_tenant_idx").on(t.tenantId, t.status, t.createdAt)],
);

/** Hochgeladene Druck-PDFs (Seller Central: FBA-Kartonlabels, FNSKU-Bögen) mit Zuordnung zur FBA-Sendung. */
export const druckDateien = pgTable(
  "druck_dateien",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    art: text("art", { enum: ["kartonlabel", "fnsku_bogen", "label_102", "unbekannt"] }).notNull(),
    seiten: integer("seiten").notNull().default(0),
    etiketten: integer("etiketten").notNull().default(0),
    raster: text("raster"),
    sendungsnummer: text("sendungsnummer"),
    inboundShipmentId: uuid("inbound_shipment_id"),
    inhalt: encryptedBytea("inhalt"),
    hochgeladenVon: uuid("hochgeladen_von").references(() => users.id, { onDelete: "set null" }),
    ueberAgent: boolean("ueber_agent").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("druck_dateien_tenant_idx").on(t.tenantId, t.createdAt), index("druck_dateien_sendung_idx").on(t.tenantId, t.sendungsnummer)],
);
