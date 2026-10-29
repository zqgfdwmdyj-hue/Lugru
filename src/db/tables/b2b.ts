import { boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, suppliers, tenantId, updatedAt, users } from "./core";
import { encryptedText } from "./encrypted";

// B2B-Deals für Prep-Center-Kunden: Großhandelsware, die wir (Firma laut Einstellungen, z. B. Wittmann & Grunert
// GmbH / AdelPrep) an Amazon-Händler weiterverkaufen. Kunden haben einen eigenen Zugang zum Kundenportal (/portal),
// getrennt von den Konten des Seller-Systems – sie sehen nur Deals und ihre eigenen Vorgänge.

const geld = (name: string) => numeric(name, { precision: 12, scale: 4, mode: "number" });

export const B2B_ZAHLUNGSARTEN = ["vorkasse", "rechnung"] as const;

/** Firmenkunden (Amazon-Händler) für Deals. Ansprechpartner, Adresse und E-Mail verschlüsselt. */
export const b2bKunden = pgTable(
  "b2b_kunden",
  {
    id: id(),
    tenantId: tenantId(),
    firma: text("firma").notNull(),
    ansprechpartner: encryptedText("ansprechpartner"),
    email: encryptedText("email"),
    strasse: encryptedText("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    land: text("land").notNull().default("DE"),
    /** USt-IdNr. wie eingegeben (z. B. „FR12345678901“). */
    ustId: text("ust_id"),
    /** Ergebnis der VIES-Prüfung: nur `true` erlaubt Reverse Charge. */
    ustGueltig: boolean("ust_gueltig"),
    ustGeprueftAm: timestamp("ust_geprueft_am", { withTimezone: true }),
    ustPruefName: text("ust_pruef_name"),
    /** Kennung der qualifizierten Abfrage (Nachweis gegenüber dem Finanzamt). */
    ustPruefKennung: text("ust_pruef_kennung"),
    amazonName: text("amazon_name"),
    zahlungsart: text("zahlungsart", { enum: B2B_ZAHLUNGSARTEN }).notNull().default("vorkasse"),
    lexofficeKontaktId: text("lexoffice_kontakt_id"),
    /** Benachrichtigung bei neuen Deals: alle oder nur bestimmte Marken/Kategorien. */
    abo: jsonb("abo").$type<{ alle?: boolean; marken?: string[]; kategorien?: string[] }>().notNull().default({ alle: true }),
    aktiv: boolean("aktiv").notNull().default(true),
    notiz: text("notiz"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("b2b_kunden_firma_uq").on(t.tenantId, t.firma)],
);

/** Zugang zum Kundenportal (E-Mail nur als Prüfwert gespeichert; Passwort per Einladungs-Link gesetzt). */
export const b2bZugaenge = pgTable(
  "b2b_zugaenge",
  {
    id: id(),
    tenantId: tenantId(),
    kundeId: uuid("kunde_id")
      .notNull()
      .references(() => b2bKunden.id, { onDelete: "cascade" }),
    /** sha256(kleingeschriebene E-Mail) – zum Anmelden, ohne die Adresse im Klartext. */
    emailHash: text("email_hash").notNull(),
    passwortHash: text("passwort_hash"),
    einladungHash: text("einladung_hash"),
    einladungBis: timestamp("einladung_bis", { withTimezone: true }),
    letzterLogin: timestamp("letzter_login", { withTimezone: true }),
    gesperrt: boolean("gesperrt").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("b2b_zugaenge_email_uq").on(t.emailHash)],
);

export const b2bSitzungen = pgTable("b2b_sitzungen", {
  /** sha256 des Cookies */
  id: text("id").primaryKey(),
  zugangId: uuid("zugang_id")
    .notNull()
    .references(() => b2bZugaenge.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  kundeId: uuid("kunde_id")
    .notNull()
    .references(() => b2bKunden.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Profil eines Lieferanten (Großhändler): Konditionen, Bewertung, Marken und Vertriebsfreigaben. */
export const lieferantenProfile = pgTable(
  "lieferanten_profile",
  {
    tenantId: tenantId(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    email: text("email"),
    mindestbestellwert: geld("mindestbestellwert"),
    versandkosten: geld("versandkosten"),
    zahlungszielTage: integer("zahlungsziel_tage"),
    lieferzeitTage: integer("lieferzeit_tage"),
    marken: jsonb("marken").$type<string[]>().notNull().default([]),
    /** Bewertung 1–5 (null = noch keine) – Antwortzeit, Liefertreue, Fehlmengen, Rechnungsqualität. */
    bewertung: jsonb("bewertung").$type<{ antwortzeit?: number; liefertreue?: number; fehlmengen?: number; rechnungsqualitaet?: number }>().notNull().default({}),
    /** Pflicht vor Deal-Freischaltung (selektiver Vertrieb): null = ungeklärt. */
    wiederverkaufErlaubt: boolean("wiederverkauf_erlaubt"),
    marktplatzErlaubt: boolean("marktplatz_erlaubt"),
    vertriebNotiz: text("vertrieb_notiz"),
    vertriebQuelle: text("vertrieb_quelle"),
    vertriebGeprueftAm: timestamp("vertrieb_geprueft_am", { withTimezone: true }),
    vertriebGeprueftVon: uuid("vertrieb_geprueft_von").references(() => users.id, { onDelete: "set null" }),
    notiz: text("notiz"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.supplierId] })],
);

export const DEAL_STATUS = ["entwurf", "aktiv", "geschlossen", "bestellt", "angekommen", "verteilt", "erledigt", "verfallen"] as const;
export type DealStatus = (typeof DEAL_STATUS)[number];

/** Prognose je Marktplatz zum Zeitpunkt des Deals (für Deal-Blatt und Erfolgskontrolle). */
export type DealPrognose = Record<
  string,
  {
    vk: number | null;
    vk90: number | null;
    tief12: number | null;
    verkaeufeMonat: number | null;
    angeboteFba: number | null;
    angeboteFbm: number | null;
    amazonProzent: number | null;
    gebuehren: number | null;
    mwstSatz: number;
    waehrung: "EUR" | "GBP";
    /** Gewinn/ROI für den Kunden beim Kundenpreis (Prognose, ohne Garantie). */
    gewinnKunde: number | null;
    roiKunde: number | null;
    aktionsmuster?: string | null;
  }
>;

export const deals = pgTable(
  "deals",
  {
    id: id(),
    tenantId: tenantId(),
    nr: integer("nr").notNull(),
    status: text("status", { enum: DEAL_STATUS }).notNull().default("entwurf"),
    asin: text("asin").notNull(),
    ean: text("ean"),
    titel: text("titel").notNull(),
    bildUrl: text("bild_url"),
    marke: text("marke"),
    kategorie: text("kategorie"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** Herkunft aus dem Preislisten-Scanner (Angebot des Lieferanten), optional. */
    angebotId: uuid("angebot_id"),
    ekNetto: geld("ek_netto").notNull(),
    staffel: jsonb("staffel").$type<{ ab: number; preis: number }[]>().notNull().default([]),
    moqLieferant: integer("moq_lieferant").notNull().default(1),
    lieferzeitTage: integer("lieferzeit_tage"),
    angebotGueltigBis: date("angebot_gueltig_bis", { mode: "string" }),
    /** Bis wann Kunden reservieren können. */
    frist: date("frist", { mode: "string" }),
    /** Kundenpreis netto je Stück – je Deal frei festgelegt (abweichend je Kunde: deal_kundenpreise). */
    kundenpreisNetto: geld("kundenpreis_netto"),
    mindestmengeKunde: integer("mindestmenge_kunde").notNull().default(1),
    maxGesamt: integer("max_gesamt"),
    maxProKunde: integer("max_pro_kunde"),
    maxKunden: integer("max_kunden"),
    /** Wir führen die ASIN selbst – nur die Restmenge abgeben. */
    nurRestmenge: boolean("nur_restmenge").notNull().default(false),
    eigenerBestand: integer("eigener_bestand").notNull().default(0),
    versandAnteil: geld("versand_anteil"),
    prepGebuehr: geld("prep_gebuehr"),
    prognose: jsonb("prognose").$type<DealPrognose>().notNull().default({}),
    hinweis: text("hinweis"),
    discord: jsonb("discord").$type<{ neu?: string; fastWeg?: string; geschlossen?: string }>().notNull().default({}),
    freigeschaltetAm: timestamp("freigeschaltet_am", { withTimezone: true }),
    freigeschaltetVon: uuid("freigeschaltet_von").references(() => users.id, { onDelete: "set null" }),
    geschlossenAm: timestamp("geschlossen_am", { withTimezone: true }),
    angekommenAm: timestamp("angekommen_am", { withTimezone: true }),
    angelegtVon: uuid("angelegt_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("deals_nr_uq").on(t.tenantId, t.nr), index("deals_status_idx").on(t.tenantId, t.status), index("deals_asin_idx").on(t.tenantId, t.asin)],
);

/** Abweichender Kundenpreis für einen Kunden. */
export const dealKundenpreise = pgTable(
  "deal_kundenpreise",
  {
    tenantId: tenantId(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    kundeId: uuid("kunde_id")
      .notNull()
      .references(() => b2bKunden.id, { onDelete: "cascade" }),
    preisNetto: geld("preis_netto").notNull(),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.kundeId] })],
);

export const RESERVIERUNG_STATUS = ["reserviert", "vorkasse_offen", "bezahlt", "bestellt", "angekommen", "an_prep", "erledigt", "storniert", "erstattet"] as const;
export type ReservierungStatus = (typeof RESERVIERUNG_STATUS)[number];

export const dealReservierungen = pgTable(
  "deal_reservierungen",
  {
    id: id(),
    tenantId: tenantId(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    kundeId: uuid("kunde_id")
      .notNull()
      .references(() => b2bKunden.id, { onDelete: "cascade" }),
    menge: integer("menge").notNull(),
    preisNetto: geld("preis_netto").notNull(),
    status: text("status", { enum: RESERVIERUNG_STATUS }).notNull().default("reserviert"),
    bedingungenAm: timestamp("bedingungen_am", { withTimezone: true }).notNull(),
    /** Nach dem Wareneingang zugeteilte Menge (kann bei Fehlmenge kleiner sein). */
    zugeteilt: integer("zugeteilt"),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    rechnungId: text("rechnung_id"),
    rechnungNr: text("rechnung_nr"),
    rechnungBrutto: geld("rechnung_brutto"),
    bezahltAm: timestamp("bezahlt_am", { withTimezone: true }),
    gutschriftId: text("gutschrift_id"),
    gutschriftBetrag: geld("gutschrift_betrag"),
    exportiertAm: timestamp("exportiert_am", { withTimezone: true }),
    notiz: text("notiz"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("deal_reservierungen_uq").on(t.dealId, t.kundeId), index("deal_reservierungen_kunde_idx").on(t.tenantId, t.kundeId)],
);

export const BESTELLUNG_STATUS = ["entwurf", "freigegeben", "bestellt", "angekommen"] as const;

/** Sammelbestellung beim Großhändler (eine je Deal). */
export const dealBestellungen = pgTable("deal_bestellungen", {
  dealId: uuid("deal_id")
    .primaryKey()
    .references(() => deals.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  menge: integer("menge").notNull(),
  /** Davon für uns selbst (Restmenge übernommen). */
  eigeneMenge: integer("eigene_menge").notNull().default(0),
  status: text("status", { enum: BESTELLUNG_STATUS }).notNull().default("entwurf"),
  mailAn: text("mail_an"),
  mailBetreff: text("mail_betreff"),
  mailText: text("mail_text"),
  freigegebenVon: uuid("freigegeben_von").references(() => users.id, { onDelete: "set null" }),
  freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
  bestelltAm: timestamp("bestellt_am", { withTimezone: true }),
  /** Rechnung des Großhändlers (Rechnungskette): Nummer und Verweis in den Rechnungsbereich. */
  grosshaendlerRechnungNr: text("grosshaendler_rechnung_nr"),
  grosshaendlerRechnungId: integer("grosshaendler_rechnung_id"),
  eingangMenge: integer("eingang_menge"),
  eingangAm: timestamp("eingang_am", { withTimezone: true }),
  reklamation: text("reklamation"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Erfolgskontrolle 30/60 Tage nach Wareneingang je Marktplatz. */
export const dealKontrollen = pgTable(
  "deal_kontrollen",
  {
    tenantId: tenantId(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    tag: integer("tag").notNull(),
    land: text("land").notNull(),
    prognoseVk: geld("prognose_vk"),
    bbSchnitt: geld("bb_schnitt"),
    angebote: integer("angebote"),
    abweichungProzent: numeric("abweichung_prozent", { precision: 8, scale: 2, mode: "number" }),
    bewertung: text("bewertung", { enum: ["wie_prognostiziert", "besser", "schlechter", "keine_daten"] }).notNull(),
    erstelltAm: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.tag, t.land] })],
);
