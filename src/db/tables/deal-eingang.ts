import { bigint, boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, money, tenantId, users } from "./core";
import { encryptedText } from "./encrypted";

// Deal-Eingang: Angebote, die Ludwig aus WhatsApp (oder Mail, Kurzbefehl, von Hand) teilt. Rohtext verschlüsselt,
// weil WhatsApp-Texte Namen und Telefonnummern Dritter enthalten können; nach der Aufbewahrungsfrist gelöscht.
// Nicht im Wissen ablegen.

/** Erkanntes Angebot (so wie es in der Nachricht stand). */
export type DealAngebot = {
  asin: string | null;
  ean: string | null;
  name: string | null;
  marke: string | null;
  ek: number | null;
  /** true = netto, false = brutto, null = unklar */
  ekNetto: boolean | null;
  waehrung: string;
  menge: number | null;
  moq: number | null;
  staffel: string | null;
  versand: string | null;
  lieferzeit: string | null;
  zahlung: string | null;
  gueltigBis: string | null;
  zustand: string | null;
  packung: number | null;
};

export type DealLandZeile = {
  land: string;
  vkEur: number | null;
  vk90Eur: number | null;
  tief12Eur: number | null;
  verkaeufeMonat: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  gewinn: number | null;
  gewinnAktuell: number | null;
  roi: number | null;
  /** Netto-Marge (Gewinn ÷ VK netto) – Grundlage der Ampel. Angezeigt wird die Marge vom Brutto-VK (B28.1). */
  marge: number | null;
  maxEk: number | null;
  fehler: string | null;
  /** B28.4: Verkäufe/Monat geschätzt aus dem Verkaufsrang, wenn Keepa keine „x+ gekauft“-Angabe hat. */
  verkaeufeGeschaetzt?: number | null;
  /** B28.1/B28.2 (Prüfungen ab 05.11.): VK netto − Gebühren − Prep beim 90-Tage-Mittel, USt, Provision, FBA, Prep. */
  rest?: number | null;
  /** B28.6: erwartete Umschlagszeit (Spanne) und ROI p. a. – geschätzt. */
  umschlag?: import("@/lib/deal-eingang/umschlag-logic").Umschlag | null;
  mwstSatz?: number;
  provision?: number;
  fba?: number;
  prep?: number;
};

/** Eine geprüfte Zeile (ein Angebot) mit Ampel, höchstens drei Gründen, Länder-Tabelle und eigener Lage. */
export type DealEingangZeile = {
  nr: number;
  angebot: DealAngebot;
  asin: string | null;
  /** Wie die ASIN gefunden wurde. */
  zuordnung: "asin" | "ean" | "titel" | "keine";
  /** Weitere Treffer (EAN mit mehreren ASINs, Titelsuche) – zum Auswählen. */
  vorschlaege: { asin: string; titel: string; packung: number | null }[];
  titel: string | null;
  ampel: "gruen" | "gelb" | "rot";
  gruende: string[];
  bestesLand: string | null;
  ekNetto: number | null;
  gewinn: number | null;
  roi: number | null;
  /** Netto-Marge im besten Land (Ampel); angezeigt wird margeBrutto. */
  marge: number | null;
  /** B28.1: Marge vom Brutto-VK im besten Land (Gewinn ÷ Buy Box brutto beim 90-Tage-Mittel). */
  margeBrutto?: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  verkaeufeMonat: number | null;
  empfohlen: number | null;
  kapitalbedarf: number | null;
  maxEk: { land: string; ek: number }[];
  laender: DealLandZeile[];
  eigen: { bestand: number; unterwegs: number; proTag: number | null; reichweite: number | null; kapitalAmpel: "gruen" | "gelb" | "rot" | null; letzterEk: number | null; letzterEkQuelle: string | null; verlustStopp: string | null; bestellvorschlag: boolean } | null;
  risiken: string[];
  hinweise: string[];
  fehler: string | null;
  geprueftAm: string;
  /** Abschnitt 11: Keepa-Schnappschuss und Kontext beim Eingang (Grundlage für den Deal-Wert). */
  merkmale?: DealMerkmale | null;
  /** Abschnitt 11: persönlicher Deal-Wert (0–100) mit Begründung und ähnlichen früheren Deals. */
  wert?: DealWert | null;
  /** Stand der Ampel-Regeln bei der Prüfung (B20.2: 2 = Angebote gelb, Amazon > 90 % rot); fehlt = alte Regeln. */
  regeln?: number;
  /** B28.6: Umschlag/ROI p. a. im besten Land (Spanne, geschätzt) und die gerechnete Menge. */
  umschlag?: import("@/lib/deal-eingang/umschlag-logic").Umschlag | null;
};

/** Merkmale eines Deals beim Eingang (Keepa DE bzw. bestes Land + Rechnung + Kontext). null = unbekannt. */
export type DealMerkmale = {
  land: string | null;
  bbJetzt: number | null;
  bb30: number | null;
  bb90: number | null;
  bb180: number | null;
  /** Buy Box jetzt gegenüber Ø 90 Tage in % (−15 = 15 % unter dem Schnitt). */
  bbAbweichung90: number | null;
  /** Schwankung der Buy Box über 90 Tage (Variationskoeffizient in %). */
  schwankung90: number | null;
  /** Preiseinbrüche (≥ 15 % unter Ø 30 Tage davor) in 180 Tagen. */
  einbrueche180: number | null;
  tief12: number | null;
  /** EK-Abstand zum 12-Monats-Tief der Buy Box (Verhältnis EK ÷ Tief in %). */
  ekZuTief: number | null;
  angebote: number | null;
  /** Angebote jetzt gegenüber vor 30 Tagen in %. */
  angeboteTrend30: number | null;
  fbaAnteil: number | null;
  amazonAnteil: number | null;
  amazonOos90: number | null;
  rang: number | null;
  /** Rang jetzt gegenüber Ø 90 Tage in % (negativ = besser). */
  rangTrend: number | null;
  monatlichVerkauft: number | null;
  /** Rang im selben Monat vor einem Jahr ÷ Ø Rang des Vorjahres (unter 1 = Saisonhoch). */
  saison: number | null;
  roi: number | null;
  marge: number | null;
  marke: string | null;
  kategorie: string | null;
  quelle: string | null;
  weg: string;
  wochentag: number;
  stunde: number;
  kapitalAmpel: "gruen" | "gelb" | "rot" | null;
  bestand: number | null;
  /** B28.3: wenigste Angebote in einem Land (Deal-Ampel je Land) und welches Land – für 👍-Grund „kein oder nur 1 Angebot“. */
  angeboteMinLand?: number | null;
  angeboteMinLandName?: string | null;
  /** Angebotene Menge (Stück) – für 👍-Grund „Großer Posten“. */
  menge?: number | null;
  /** B28.6: ROI pro Jahr (ROI × 365 ÷ erwartete Umschlagszeit) und Umschlag in Tagen (Mitte der Spanne). */
  roiPa?: number | null;
  umschlagTage?: number | null;
};

export type DealAehnlich = { id: string | null; quelle: "eigen" | "lugru"; titel: string | null; asin: string | null; datum: string; ergebnis: string; abstand: number };
export type DealWert = {
  wert: number;
  /** „Passt zu dir (78/100): … Gegen: …“ */
  begruendung: string;
  dafuer: string[];
  dagegen: string[];
  aehnliche: DealAehnlich[];
  /** kennzahlen = gewichtete Kennzahlen + ähnliche Deals; modell = zusätzlich gelerntes Modell (ab 100 Deals mit Ergebnis). */
  verfahren: "kennzahlen" | "modell";
  /** Ampel rot: Wert gedeckelt – der Deal-Wert ersetzt keine Prüfung. */
  gedeckelt: boolean;
};

/** Reales Ergebnis eines gekauften Deals (sellerboard je Charge, ab Wareneingang). */
export type DealErgebnis = {
  wareneingang: string | null;
  tage: number;
  verkauft: number;
  erstattet: number;
  oVk: number | null;
  realerGewinn: number | null;
  realerRoi: number | null;
  /** Tage vom Wareneingang bis 90 % der gekauften Menge verkauft (null = noch nicht). */
  tageBisAbverkauf: number | null;
  stand: string;
};

export const DAUMEN_GRUENDE = ["zu viele Angebote", "Chart instabil", "Amazon drin", "Marke gesperrt", "Kapital", "Saison", "sonstiges"] as const;

/** B28.3: Gründe für 👍 (Mehrfachauswahl, dazu Freitext) – Reihenfolge = Nummern 1–5 der Discord-Rückfrage. */
export const DAUMEN_GRUENDE_HOCH = [
  "Amazon ist Hauptanbieter, aber viel Preis-Puffer zum EK",
  "In einem Land (FR/IT/ES …) kein oder nur 1 Angebot",
  "Schneller Abverkauf bei niedrigerem VK möglich",
  "Marke/Kategorie läuft bei mir",
  "Großer Posten, lange Laufzeit ok",
] as const;

/** B28.5: Verpackung der Ware laut Deal (für Bestellmail und Wareneingang). */
export const DEAL_VERPACKUNG = ["lose", "eingeschweisst", "originalkarton"] as const;
export const VERPACKUNG_TEXT: Record<(typeof DEAL_VERPACKUNG)[number], string> = { lose: "lose", eingeschweisst: "eingeschweißt", originalkarton: "Originalkarton" };

export const dealEingaenge = pgTable(
  "deal_eingaenge",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    weg: text("weg", { enum: ["manuell", "teilen", "kurzbefehl", "mail", "claude", "profitpath", "gruppe", "lugru"] }).notNull(),
    /** Herkunft für Dubletten: „mail:<Message-ID>“, „pp:<Discord-Nachricht>“. */
    quelleRef: text("quelle_ref"),
    /** Schon strukturiert gelieferte Angebote (ProfitPath, Claude) – dann ohne KI-Erkennung. */
    angebote: jsonb("angebote").$type<DealAngebot[] | null>(),
    /** Geräte-Schlüssel, über den der Eingang kam (Kurzbefehl) – für Rate-Limit und Widerruf. */
    tokenId: uuid("token_id"),
    /** Absender/Quelle (z. B. „Konrad“) – von Hand oder aus dem Text erraten. */
    quelle: text("quelle"),
    rohtext: encryptedText("rohtext").notNull(),
    /** Dateien (Screenshot, PDF, Tabelle) in der Tabelle files. */
    dateiIds: jsonb("datei_ids").$type<string[]>().notNull().default([]),
    dateiNamen: jsonb("datei_namen").$type<string[]>().notNull().default([]),
    /** Prüfsumme über Text + Dateien – derselbe Eingang zweimal geteilt wird nicht doppelt geprüft. */
    inhaltKennung: text("inhalt_kennung").notNull(),
    pruefung: text("pruefung", { enum: ["offen", "laeuft", "fertig", "fehler"] }).notNull().default("offen"),
    fehler: text("fehler"),
    /** Entscheidung: neu → gekauft / Bestellvorschlag / B2B-Deal / verworfen; „preisliste“ = an den Preislisten-Scanner. */
    status: text("status", { enum: ["neu", "gekauft", "bestellvorschlag", "b2b", "verworfen", "preisliste"] }).notNull().default("neu"),
    grund: text("grund"),
    ampel: text("ampel", { enum: ["gruen", "gelb", "rot"] }),
    /** Kurztext wie in der Push-Nachricht. */
    zusammenfassung: text("zusammenfassung"),
    zeilen: jsonb("zeilen").$type<DealEingangZeile[]>().notNull().default([]),
    /** Erkannt ohne KI (Regeln) – Hinweis auf der Seite. */
    ohneKi: boolean("ohne_ki").notNull().default(false),
    preislisteId: uuid("preisliste_id"),
    b2bDealId: uuid("b2b_deal_id"),
    bestellungId: uuid("bestellung_id"),
    pushAm: timestamp("push_am", { withTimezone: true }),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    /** Abschnitt 11: 👍/👎 mit Kurzgrund – aus Seite, Push, Discord (Reaktion) oder Claude. */
    daumen: text("daumen", { enum: ["hoch", "runter"] }),
    daumenGrund: text("daumen_grund"),
    daumenWeg: text("daumen_weg", { enum: ["tool", "push", "discord", "claude"] }),
    daumenAm: timestamp("daumen_am", { withTimezone: true }),
    /** B28.3: Gründe bei 👍 (Mehrfachauswahl aus DAUMEN_GRUENDE_HOCH) und Freitext (👍 und 👎). */
    daumenGruende: jsonb("daumen_gruende").$type<string[]>().notNull().default([]),
    daumenFreitext: text("daumen_freitext"),
    /** Rückfrage des Bots nach 👍 in Discord („thread/nachricht“) – Antwort per Zahl-Reaktion oder Text, optional. */
    daumenFrageRef: text("daumen_frage_ref"),
    daumenFrageAm: timestamp("daumen_frage_am", { withTimezone: true }),
    /** B28.5: Verpackung und ob die EAN der Ware von der Amazon-EAN abweicht (dann FNSKU-Etikett nötig). */
    verpackung: text("verpackung", { enum: DEAL_VERPACKUNG }),
    eanAbweichend: boolean("ean_abweichend"),
    /** Abschnitt 10: gekauft (Menge, Preis netto je Stück) – Knopf, Bestellbestätigungs-Mail, Sprache/SMS oder Claude. */
    gekauftMenge: integer("gekauft_menge"),
    gekauftPreis: money("gekauft_preis"),
    gekauftAm: timestamp("gekauft_am", { withTimezone: true }),
    gekauftWeg: text("gekauft_weg", { enum: ["knopf", "mail", "sprache", "claude", "sms", "automatisch"] }),
    gekauftRef: text("gekauft_ref"),
    /** Discord-Nachricht des Eingangs (ProfitPath: „kanal/nachricht“) – für 👍/👎 als Reaktion. */
    discordRef: text("discord_ref"),
    /** Reales Ergebnis (sellerboard, 30/60/90 Tage nach Wareneingang). */
    ergebnis: jsonb("ergebnis").$type<DealErgebnis | null>(),
    /** B19.1: aus der Lugru-History nachgetragen (Ampel aus Post-Zahlen + Keepa beim Posten, kein Push). */
    historisch: boolean("historisch").notNull().default(false),
    /** Kaufen mit einem Tap: Kauf-Nummer („Kaufen 17“, 24 Std. gültig ab kauf.am) und vorbereiteter Kauf-Link. */
    kaufNr: integer("kauf_nr"),
    kauf: jsonb("kauf").$type<DealKauf | null>(),
    /** „Kauf vorbereitet (Menge)“: Ludwig hat den Warenkorb-/Produkt-Link geöffnet – gekauft ist damit nichts. */
    kaufVorbereitetAm: timestamp("kauf_vorbereitet_am", { withTimezone: true }),
    kaufVorbereitetMenge: integer("kauf_vorbereitet_menge"),
    /** Nach 24 Std. ohne erkannten Kauf: Erinnerung „Deal 17 noch offen?“ (einmal). */
    kaufErinnertAm: timestamp("kauf_erinnert_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("deal_eingaenge_tenant_idx").on(t.tenantId, t.createdAt), index("deal_eingaenge_quelle_idx").on(t.tenantId, t.quelle), index("deal_eingaenge_kennung_idx").on(t.tenantId, t.inhaltKennung), uniqueIndex("deal_eingaenge_ref_uq").on(t.tenantId, t.quelleRef), index("deal_eingaenge_kauf_nr_idx").on(t.tenantId, t.kaufNr)],
);

/** Vorbereiteter Kauf (Push „In den Warenkorb (4)“ bzw. „Produktseite öffnen“). */
export type DealKauf = {
  /** Vergabe der Kauf-Nummer (ISO). */
  am: string;
  zeile: number;
  asin: string | null;
  menge: number;
  shop: string;
  kuerzel: string | null;
  url: string;
  fallbackUrl: string | null;
  warenkorb: boolean;
  hinweis: string | null;
  gutschein: string | null;
  payback: string | null;
};

/**
 * Shop-Profile (Einstellungen → Shop-Profile): je Shop Link-Art, Link-Muster, Hinweis, Lieferantenkürzel und
 * Payback-Hinweis. Überschreiben die Start-Profile im Code (Amazon je Land mit Warenkorb-Link, sonst Produktseite).
 */
export const shopProfile = pgTable(
  "shop_profil",
  {
    id: id(),
    tenantId: tenantId(),
    kuerzel: text("kuerzel").notNull(),
    name: text("name").notNull(),
    domains: jsonb("domains").$type<string[]>().notNull().default([]),
    linkArt: text("link_art", { enum: ["warenkorb_link", "produktseite", "suche"] }).notNull().default("produktseite"),
    linkMuster: text("link_muster"),
    hinweis: text("hinweis"),
    payback: text("payback"),
    aktiv: boolean("aktiv").notNull().default(true),
    createdAt: createdAt(),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shop_profil_uq").on(t.tenantId, t.kuerzel)],
);

/**
 * Persönliche API-Schlüssel je Gerät (iPhone-Kurzbefehl „Deal prüfen“, später Schnellerfassung). Gespeichert wird
 * nur die Prüfsumme; der Schlüssel wird einmal beim Anlegen angezeigt. Widerrufen = sofort ungültig.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** deal_eingang = Kurzbefehl „Deal prüfen“ (dk_…); mobil = Handy-Endpunkte /api/mobil/* (mk_…). */
    zweck: text("zweck", { enum: ["deal_eingang", "mobil"] }).notNull().default("deal_eingang"),
    tokenHash: text("token_hash").notNull(),
    /** Die ersten Zeichen zum Wiedererkennen („dk_Ab3x…“). */
    anfang: text("anfang").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.tenantId, t.userId)],
);

/** ProfitPath über Discord: gelesene Kanäle (Modul/Alarmgruppe) mit Lesestand. */
export const dealEingangKanaele = pgTable(
  "deal_eingang_kanaele",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: text("kanal_id").notNull(),
    name: text("name"),
    cursor: text("cursor"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deal_eingang_kanaele_uq").on(t.tenantId, t.kanalId)],
);


/**
 * Abschnitt 11: History der Deals, die Lugru Deals (Shop-Monitor) in der Deal-Gruppe gepostet hat – nur Zahlen je
 * Deal und Reaktionen als Anzahl (✅ gekauft / ❌ nicht verfügbar), keine Profile einzelner Mitglieder. Schwaches
 * Signal für den Deal-Wert; eine fehlende Reaktion heißt nicht „nicht gekauft“.
 */
export const lugruDealsHistorie = pgTable(
  "lugru_deals_historie",
  {
    id: id(),
    tenantId: tenantId(),
    /** ID in Lugru Deals (Weg A, Übertragung vom PC); null bei Deals, die das Seller-System in Discord gelesen hat. */
    externId: bigint("extern_id", { mode: "number" }),
    /** Woher: „app“ = von Lugru Deals übertragen, „discord“ = vom Seller-System in den Deal-Kanälen gelesen. */
    quelle: text("quelle", { enum: ["app", "discord"] }).notNull().default("app"),
    discordKanalId: text("discord_kanal_id"),
    discordNachrichtId: text("discord_nachricht_id"),
    discordGuildId: text("discord_guild_id"),
    asin: text("asin").notNull(),
    /** ASIN nicht aus einem Amazon-Link, sondern frei im Text gefunden. */
    asinUnsicher: boolean("asin_unsicher").notNull().default(false),
    titel: text("titel"),
    quellmarkt: text("quellmarkt"),
    zielmarkt: text("zielmarkt"),
    shop: text("shop"),
    shopUrl: text("shop_url"),
    ekEur: money("ek_eur"),
    ekNetto: boolean("ek_netto"),
    vkEur: money("vk_eur"),
    gewinnEur: money("gewinn_eur"),
    margeProzent: real("marge_prozent"),
    verkaeufeMonat: integer("verkaeufe_monat"),
    maxMenge: integer("max_menge"),
    gruppe: text("gruppe"),
    kanal: text("kanal"),
    status: text("status"),
    /** Reaktionen der Mitglieder als Anzahl je Emoji – nie Namen oder IDs. */
    reaktionen: jsonb("reaktionen").$type<Record<string, number>>().notNull().default({}),
    kaeufe: integer("kaeufe").notNull().default(0),
    nichtVerfuegbar: integer("nicht_verfuegbar").notNull().default(0),
    reaktionenAm: timestamp("reaktionen_am", { withTimezone: true }),
    ausverkauftAm: timestamp("ausverkauft_am", { withTimezone: true }),
    gepostetAm: timestamp("gepostet_am", { withTimezone: true }).notNull(),
    /** Eintrag im Deal-Eingang (live gelesene Deals) – dort Ampel, Deal-Wert, Entscheidung. */
    eingangId: uuid("eingang_id"),
    ampel: text("ampel", { enum: ["gruen", "gelb", "rot"] }),
    /** Keepa-Schnappschuss zum Zeitpunkt des Postens (bei der History so nah wie möglich). */
    keepa: jsonb("keepa").$type<LugruKeepa | null>(),
    /** Eigener Kauf automatisch erkannt (sellerboard-SKU, Charge, Bestellung oder FBA-Sendung mit gleicher ASIN 0–21 Tage nach dem Posten). */
    gekauftErkannt: boolean("gekauft_erkannt").notNull().default(false),
    gekauftErkanntRef: text("gekauft_erkannt_ref"),
    /** Hat sich der Deal real bewährt (Keepa danach: Preis hielt, Angebote stiegen nicht stark)? null = unbekannt. */
    bewaehrt: boolean("bewaehrt"),
    bewaehrtGrund: text("bewaehrt_grund"),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lugru_deals_historie_uq").on(t.tenantId, t.externId),
    uniqueIndex("lugru_deals_historie_discord_uq").on(t.tenantId, t.discordNachrichtId),
    index("lugru_deals_historie_asin_idx").on(t.tenantId, t.asin),
    index("lugru_deals_historie_gepostet_idx").on(t.tenantId, t.gepostetAm),
  ],
);

/** Keepa-Werte zum Zeitpunkt des Postens (Euro bzw. Anzahl; null = unbekannt). */
export type LugruKeepa = {
  stand: string;
  /** „posten“ = live beim Eingang, „verlauf“ = nachträglich aus dem Keepa-Verlauf, „heute“ = nur aktuelle Werte. */
  art: "posten" | "verlauf" | "heute";
  buyBox: number | null;
  buyBox30: number | null;
  buyBox90: number | null;
  buyBox180: number | null;
  einbrueche12: number | null;
  angebote: number | null;
  angeboteTrend30: number | null;
  amazonAnteil: number | null;
  rang: number | null;
  gekauftImMonat: number | null;
  marke: string | null;
  kategorie: string | null;
  /** B19.1: Kategorie bei Keepa nachgefragt (auch wenn Keepa keine kennt). */
  kategorieAm?: string;
};

/** Deal-Kanäle der Lugru-Gruppe, die das Seller-System liest (Weg B): Stand live und Fortschritt der History. */
export const lugruKanaele = pgTable(
  "lugru_kanaele",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: text("kanal_id").notNull(),
    name: text("name"),
    guildId: text("guild_id"),
    /** Neueste verarbeitete Nachricht (live). */
    cursor: text("cursor"),
    /** Älteste verarbeitete Nachricht (History rückwärts); null = noch nicht begonnen. */
    historieVor: text("historie_vor"),
    historieFertig: boolean("historie_fertig").notNull().default(false),
    historieBis: timestamp("historie_bis", { withTimezone: true }),
    gelesen: integer("gelesen").notNull().default(0),
    erkannt: integer("erkannt").notNull().default(0),
    reaktionenAm: timestamp("reaktionen_am", { withTimezone: true }),
    tiefAbgleichAm: timestamp("tief_abgleich_am", { withTimezone: true }),
    letzterLauf: timestamp("letzter_lauf", { withTimezone: true }),
    fehler: text("fehler"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lugru_kanaele_uq").on(t.tenantId, t.kanalId)],
);

/**
 * B28.5: Bestellmail an den Lieferanten bei „Gekauft“ – erst Entwurf (bearbeitbar), dann „Senden“. Antwort des
 * Lieferanten (Rechnung, Sendungsnummer) wird über den Posteingang zugeordnet (Antwort auf die Mail, Betreff/ASIN).
 */
export const dealBestellmails = pgTable(
  "deal_bestellmails",
  {
    id: id(),
    tenantId: tenantId(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => dealEingaenge.id, { onDelete: "cascade" }),
    /** Lieferant (suppliers) und Bestellung im Einkauf (purchase_orders), falls vorhanden. */
    supplierId: uuid("supplier_id"),
    bestellungId: uuid("bestellung_id"),
    an: text("an").notNull(),
    kopieAn: text("kopie_an"),
    betreff: text("betreff").notNull(),
    text: encryptedText("text").notNull(),
    status: text("status", { enum: ["entwurf", "gesendet", "fehler", "verworfen"] }).notNull().default("entwurf"),
    fehler: text("fehler"),
    messageId: text("message_id"),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }),
    gesendetVon: uuid("gesendet_von").references(() => users.id, { onDelete: "set null" }),
    /** Antwort aus dem Posteingang (emails) mit erkannter Sendungsnummer bzw. Rechnung. */
    antwortId: uuid("antwort_id"),
    antwortAm: timestamp("antwort_am", { withTimezone: true }),
    sendungsnummer: text("sendungsnummer"),
    rechnungErhalten: boolean("rechnung_erhalten").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("deal_bestellmails_deal_idx").on(t.tenantId, t.dealId), index("deal_bestellmails_bestellung_idx").on(t.tenantId, t.bestellungId), index("deal_bestellmails_msg_idx").on(t.tenantId, t.messageId)],
);

/**
 * B28.8 Monatliche Lernschleife: am 3. die Produkte mit Verlust bzw. Marge unter 3 % im Vormonat (nur Einkäufe der
 * letzten 6 Monate). Ludwig ordnet ein: „Nie wieder kaufen“ / „Würde ich wieder kaufen (Pech)“ / „Weiß nicht warum“,
 * optional Gründe. Antworten fließen in Deal-Wert und Lernbericht (ähnliche Deals: Abschlag bzw. Hinweis).
 */
export const lernschleifeFragen = pgTable(
  "lernschleife_fragen",
  {
    id: id(),
    tenantId: tenantId(),
    /** Monat der Zahlen (JJJJ-MM), gefragt am 3. des Folgemonats. */
    monat: text("monat").notNull(),
    /** ASIN, sonst erste SKU – je Monat einmal. */
    schluessel: text("schluessel").notNull(),
    asin: text("asin"),
    skus: jsonb("skus").$type<string[]>().notNull().default([]),
    titel: text("titel"),
    units: integer("units"),
    umsatz: real("umsatz"),
    gewinn: real("gewinn"),
    marge: real("marge"),
    /** Für „ähnliche Deals“: Marke, Kategorie, Quelle, Angebote (aus dem Deal-Eingang bzw. Einkauf). */
    marke: text("marke"),
    kategorie: text("kategorie"),
    quelle: text("quelle"),
    angebote: integer("angebote"),
    letzterEinkauf: text("letzter_einkauf"),
    antwort: text("antwort", { enum: ["nie_wieder", "pech", "unklar"] }),
    gruende: jsonb("gruende").$type<string[]>().notNull().default([]),
    freitext: text("freitext"),
    beantwortetAm: timestamp("beantwortet_am", { withTimezone: true }),
    beantwortetVon: uuid("beantwortet_von").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lernschleife_uq").on(t.tenantId, t.monat, t.schluessel), index("lernschleife_tenant_idx").on(t.tenantId, t.createdAt)],
);
