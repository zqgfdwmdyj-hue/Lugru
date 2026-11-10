import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

/**
 * B34.3 B2B-Abverkauf von Ladenhütern: Preisliste (Break-even + Aufschlag, Staffeln), Händler-Leads aus CSV (das
 * Seller-System scrapt nicht), Sperrliste, Anschreiben je Händler (KI-Entwurf, nie automatischer Versand) in Chargen
 * bis 20, Erfolgskontrolle je Charge. Adresse und E-Mail der Leads verschlüsselt (pii).
 */
export type AbverkaufPosition = { sku: string; asin: string | null; titel: string; menge: number; preis: number; staffel: { ab: number; preis: number }[] };

export const abverkaufPreislisten = pgTable(
  "abverkauf_preislisten",
  {
    id: id(),
    tenantId: tenantId(),
    aufschlagProzent: numeric("aufschlag_prozent", { precision: 6, scale: 2, mode: "number" }).notNull(),
    staffeln: jsonb("staffeln").$type<{ ab: number; rabattProzent: number }[]>().notNull().default([]),
    positionen: jsonb("positionen").$type<AbverkaufPosition[]>().notNull().default([]),
    erstelltVon: uuid("erstellt_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("abverkauf_preislisten_idx").on(t.tenantId, t.createdAt)],
);

export const abverkaufLeads = pgTable(
  "abverkauf_leads",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    /** verschlüsselt */
    strasse: text("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    land: text("land").notNull().default("DE"),
    kategorie: text("kategorie"),
    /** verschlüsselt; nur wenn im Impressum öffentlich (Spalte E-Mail-Quelle) */
    email: text("email"),
    emailQuelle: text("email_quelle"),
    website: text("website"),
    quelle: text("quelle").notNull(),
    quelleDatum: text("quelle_datum").notNull(),
    status: text("status", { enum: ["neu", "angeschrieben", "geantwortet", "kunde", "kein_interesse", "gesperrt"] }).notNull().default("neu"),
    kontaktweg: text("kontaktweg", { enum: ["brief", "email"] }).notNull().default("brief"),
    rechtsgrundlage: text("rechtsgrundlage").notNull(),
    zweck: text("zweck").notNull(),
    /** Nachweis einer Einwilligung (Datum, Weg) – ohne Nachweis keine E-Mail an Fremdkontakte. */
    einwilligung: text("einwilligung"),
    bestandskunde: boolean("bestandskunde").notNull().default(false),
    loeschenAm: text("loeschen_am").notNull(),
    schluessel: text("schluessel").notNull(),
    importName: text("import_name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("abverkauf_leads_schluessel").on(t.tenantId, t.schluessel), index("abverkauf_leads_status").on(t.tenantId, t.status)],
);

/** Sperrliste: nur Prüfsummen (Firma+PLZ bzw. E-Mail) – auch nach dem Löschen des Leads kein erneuter Import. */
export const abverkaufSperrliste = pgTable(
  "abverkauf_sperrliste",
  {
    id: id(),
    tenantId: tenantId(),
    schluessel: text("schluessel").notNull(),
    grund: text("grund"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("abverkauf_sperrliste_key").on(t.tenantId, t.schluessel)],
);

export const abverkaufChargen = pgTable(
  "abverkauf_chargen",
  {
    id: id(),
    tenantId: tenantId(),
    nr: integer("nr").notNull(),
    kanal: text("kanal", { enum: ["brief", "email"] }).notNull(),
    preislisteId: uuid("preisliste_id"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }).notNull().defaultNow(),
    freigegebenVon: uuid("freigegeben_von").references(() => users.id, { onDelete: "set null" }),
    versendetAm: timestamp("versendet_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("abverkauf_chargen_idx").on(t.tenantId, t.nr)],
);

export const abverkaufAnschreiben = pgTable(
  "abverkauf_anschreiben",
  {
    id: id(),
    tenantId: tenantId(),
    leadId: uuid("lead_id").notNull(),
    chargeId: uuid("charge_id"),
    preislisteId: uuid("preisliste_id"),
    kanal: text("kanal", { enum: ["brief", "email"] }).notNull(),
    /** Bezug „AV-…“ in Betreff/Brief – ordnet Antworten zu. */
    code: text("code").notNull(),
    betreff: text("betreff").notNull(),
    text: text("text").notNull(),
    ki: boolean("ki").notNull().default(false),
    status: text("status", { enum: ["entwurf", "freigegeben", "versendet", "beantwortet", "gesperrt"] }).notNull().default("entwurf"),
    fehler: text("fehler"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    versendetAm: timestamp("versendet_am", { withTimezone: true }),
    antwortAm: timestamp("antwort_am", { withTimezone: true }),
    umsatz: numeric("umsatz", { precision: 12, scale: 2, mode: "number" }),
    marge: numeric("marge", { precision: 12, scale: 2, mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("abverkauf_anschreiben_code").on(t.tenantId, t.code), index("abverkauf_anschreiben_lead").on(t.tenantId, t.leadId)],
);
