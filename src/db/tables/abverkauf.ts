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
    /** B34.3.6 Zielgruppe AdelPrep (Lager & Logistik) – Beilage bzw. eigener Brief möglich. */
    adelprep: boolean("adelprep").notNull().default(false),
    /** B34.3b Koordinaten aus der CSV (Umkreis um das Lager), Größe (klein/mittel/groß). */
    lat: numeric("lat", { precision: 9, scale: 6, mode: "number" }),
    lng: numeric("lng", { precision: 9, scale: 6, mode: "number" }),
    groesse: text("groesse"),
    /** B34.3c Herkunft der Datei (apify/lucid/keepa/helium10/csv/manuell) – LUCID erst nach rechtlicher Klärung. */
    quelleTyp: text("quelle_typ"),
    /** B34.3c Stückzahl je Artikel (aus der CSV) – Vorschlag „Zielgruppe AdelPrep“ ab Schwelle. */
    stueckJeArtikel: integer("stueck_je_artikel"),
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
    /** B34.3.6 AdelPrep-Beilage je Brief zu-/abgewählt (eigener Brief der anderen Firma im selben Umschlag). */
    adelprepBeilage: boolean("adelprep_beilage").notNull().default(false),
    kampagneId: uuid("kampagne_id"),
    /** Nachfassen (Aufgabe, kein automatischer Versand) angelegt. */
    nachfassAm: timestamp("nachfass_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("abverkauf_anschreiben_code").on(t.tenantId, t.code), index("abverkauf_anschreiben_lead").on(t.tenantId, t.leadId)],
);

/** B34.3b Position einer Kampagne: aus dem Bestand, mit MHD/Charge (Kosmetik), Preis = Einstand + Aufschlag. */
export type KampagnePosition = { sku: string; asin: string | null; titel: string; marke: string | null; menge: number; mindestmenge: number; einstand: number; preis: number; staffel: { ab: number; preis: number }[]; mhd: string | null; charge: string | null; angeboten: boolean; grund: string | null };
export type KampagneFilter = { branche: string | null; plz: string | null; umkreisKm: number | null; groesse: string | null; status: string[]; nurAdelprep: boolean };

/**
 * B34.3b Kampagne = Zielgruppe + Produktauswahl + Preise + Brieftext + Lead-Filter. QR-Code/Kurzlink mit dem Code
 * führt zur öffentlichen Anfrageseite (/anfrage/<code>). Nachfassen nur als Aufgabe.
 */
export const abverkaufKampagnen = pgTable(
  "abverkauf_kampagnen",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    zielgruppe: text("zielgruppe", { enum: ["amazon_haendler", "friseure", "spielwaren", "adelprep_lager", "sonstige"] }).notNull(),
    code: text("code").notNull(),
    positionen: jsonb("positionen").$type<KampagnePosition[]>().notNull().default([]),
    filter: jsonb("filter").$type<KampagneFilter>().notNull(),
    brieftext: text("brieftext").notNull(),
    aufschlagProzent: numeric("aufschlag_prozent", { precision: 6, scale: 2, mode: "number" }).notNull().default(10),
    mindestRestlaufzeitMonate: integer("mindest_restlaufzeit_monate").notNull().default(6),
    nachfassTage: integer("nachfass_tage"),
    offenePunkte: jsonb("offene_punkte").$type<Record<string, boolean>>().notNull().default({}),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltVon: uuid("erstellt_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("abverkauf_kampagnen_code").on(t.code), index("abverkauf_kampagnen_idx").on(t.tenantId, t.createdAt)],
);

/** Anfrage über die öffentliche Seite (QR-Code im Brief): landet als Aufgabe im Posteingang. Kontaktdaten verschlüsselt. */
export const abverkaufAnfragen = pgTable(
  "abverkauf_anfragen",
  {
    id: id(),
    tenantId: tenantId(),
    kampagneId: uuid("kampagne_id").notNull(),
    anschreibenCode: text("anschreiben_code"),
    firma: text("firma").notNull(),
    ustId: text("ust_id"),
    ustIdOk: boolean("ust_id_ok").notNull().default(false),
    /** verschlüsselt: Name, E-Mail, Telefon */
    kontakt: text("kontakt"),
    wunsch: text("wunsch"),
    menge: text("menge"),
    taskId: uuid("task_id"),
    createdAt: createdAt(),
  },
  (t) => [index("abverkauf_anfragen_idx").on(t.tenantId, t.createdAt)],
);

/**
 * B34.3a Brief über einen Versand-Anbieter (eBrief, LetterXpress, E-POST) – nur nach Freigabe. Testmodus (Sandbox)
 * bzw. live (nur mit AV-Vertrag). Status vom Anbieter, Kosten je Brief für die Erfolgskontrolle.
 */
export const abverkaufBriefe = pgTable(
  "abverkauf_briefe",
  {
    id: id(),
    tenantId: tenantId(),
    anschreibenId: uuid("anschreiben_id"),
    chargeId: uuid("charge_id"),
    anbieter: text("anbieter", { enum: ["ebrief", "letterxpress", "epost"] }).notNull(),
    modus: text("modus", { enum: ["test", "live"] }).notNull(),
    testbrief: boolean("testbrief").notNull().default(false),
    externeId: text("externe_id"),
    status: text("status", { enum: ["uebergeben", "angenommen", "gedruckt", "zugestellt", "fehler", "storniert"] }).notNull(),
    statusText: text("status_text"),
    seiten: integer("seiten").notNull().default(1),
    kostenNetto: numeric("kosten_netto", { precision: 10, scale: 2, mode: "number" }),
    freigegebenVon: uuid("freigegeben_von").references(() => users.id, { onDelete: "set null" }),
    statusAm: timestamp("status_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("abverkauf_briefe_idx").on(t.tenantId, t.createdAt), index("abverkauf_briefe_anschreiben").on(t.tenantId, t.anschreibenId)],
);
