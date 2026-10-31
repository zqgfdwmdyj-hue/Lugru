import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, tasks, tenantId, updatedAt } from "./core";
import { emails } from "./inbox";

// Amazon-Fall-Zentrale: Vorgänge (Freischaltung, Fall, Erstattung, Marke, Angebot, Konto …) aus Amazon-Mails, mit
// Verlauf, Frist, Dringlichkeit, vorbereitetem Paket und Übergabe an die VA. Die Amazon-ToDos bleiben die Liste der
// einzelnen Aufforderungen; ein Vorgang fasst zusammengehörige Mails (gleiche Fall-ID bzw. ASIN) zusammen.

export type FallPaket = {
  art: "freischaltung" | "fall_antwort" | "wieder_oeffnen" | "marke" | "angebot" | "allgemein";
  texte: { de: string; en: string };
  checkliste: string[];
  belege: { id: string; name: string; fileId: string | null }[];
  fehlt: string[];
  erstellt: string;
};

export const amazonVorgaenge = pgTable(
  "amazon_vorgaenge",
  {
    id: id(),
    tenantId: tenantId(),
    bereich: text("bereich").notNull(),
    phase: text("phase").notNull(),
    /** offen / erledigt / info */
    status: text("status", { enum: ["offen", "erledigt", "info"] }).notNull().default("offen"),
    dringlichkeit: text("dringlichkeit", { enum: ["rot", "gelb", "grau"] }).notNull().default("grau"),
    /** Unsichere Einordnung – „bitte prüfen“, ein Klick ordnet zu (und das System lernt). */
    unsicher: boolean("unsicher").notNull().default(false),
    titel: text("titel").notNull(),
    fallnummer: text("fallnummer"),
    marktplatz: text("marktplatz"),
    marke: text("marke"),
    asins: jsonb("asins").$type<string[]>().notNull().default([]),
    skus: jsonb("skus").$type<string[]>().notNull().default([]),
    bestellnummer: text("bestellnummer"),
    shipmentId: text("shipment_id"),
    betrag: money("betrag"),
    frist: date("frist", { mode: "string" }),
    ablehnungsgruende: jsonb("ablehnungsgruende").$type<string[]>().notNull().default([]),
    verlangt: jsonb("verlangt").$type<string[]>().notNull().default([]),
    /** va / ludwig – wer einreicht. */
    zustaendig: text("zustaendig"),
    /** Aufgabe (und damit der VA-Thread) zum Vorgang. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    paket: jsonb("paket").$type<FallPaket | null>(),
    /** Erfolglose Runden (geschlossen ohne Lösung) – ab 2 an Ludwig. */
    runden: integer("runden").notNull().default(0),
    ersteMailAm: timestamp("erste_mail_am", { withTimezone: true }).notNull(),
    letzteMailAm: timestamp("letzte_mail_am", { withTimezone: true }).notNull(),
    /** Push an Ludwig schon geschickt (Entzug, Markenbeschwerde). */
    gemeldetAm: timestamp("gemeldet_am", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("amazon_vorgaenge_status_idx").on(t.tenantId, t.status, t.frist), index("amazon_vorgaenge_fall_idx").on(t.tenantId, t.fallnummer)],
);

/** Verlauf je Vorgang: Mails (Original über emailId), Statuswechsel, VA-Antworten, Notizen. */
export const amazonVorgangEintraege = pgTable(
  "amazon_vorgang_eintraege",
  {
    id: id(),
    tenantId: tenantId(),
    vorgangId: uuid("vorgang_id")
      .notNull()
      .references(() => amazonVorgaenge.id, { onDelete: "cascade" }),
    emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
    art: text("art", { enum: ["mail", "status", "va", "notiz", "paket"] }).notNull(),
    phase: text("phase"),
    text: text("text").notNull(),
    von: text("von"),
    am: timestamp("am", { withTimezone: true }).notNull(),
  },
  (t) => [index("amazon_vorgang_eintraege_idx").on(t.tenantId, t.vorgangId, t.am), uniqueIndex("amazon_vorgang_mail_uq").on(t.tenantId, t.emailId)],
);

/** Von Hand korrigierte Einordnung (Muster aus dem Betreff) – gilt für künftige Mails. */
export const amazonEinordnungRegeln = pgTable(
  "amazon_einordnung_regeln",
  {
    tenantId: tenantId(),
    muster: text("muster").notNull(),
    bereich: text("bereich").notNull(),
    phase: text("phase").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.muster] })],
);

/** Amazon-Mails, die geprüft wurden, aber kein Vorgang sind (Bestellung/Versand/Zahlung, Newsletter) – damit sie nicht bei jedem Lauf erneut gelesen werden. */
export const amazonMailUebersprungen = pgTable(
  "amazon_mail_uebersprungen",
  {
    tenantId: tenantId(),
    emailId: uuid("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    grund: text("grund").notNull(),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.emailId] })],
);
