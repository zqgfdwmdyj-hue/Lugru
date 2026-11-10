import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";

/**
 * B34.1 Scan-Modus (Handy, Laden und online): jeder Scan mit Eingabe (Code, Preis brutto/netto, Rückvergütung, Menge),
 * Ergebnis der Prüfung (wie scan_pruefen) und der Aktion danach (Einkaufsliste, Deal, verworfen). „Heute gescannt“ und
 * die Einkaufsliste lesen hieraus. Offline gemerkte Scans kommen mit `offline = true` nach.
 */
export const scanEintraege = pgTable(
  "scan_eintraege",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    modus: text("modus", { enum: ["laden", "online"] }).notNull().default("laden"),
    /** EAN, ASIN oder Link wie eingegeben. */
    code: text("code").notNull(),
    asin: text("asin"),
    titel: text("titel"),
    /** Modus Online: Link aus der Shop-App (bzw. Amazon-Link) für „Kauf vorbereiten“. */
    shopUrl: text("shop_url"),
    preis: numeric("preis", { precision: 12, scale: 2, mode: "number" }).notNull(),
    netto: boolean("netto").notNull().default(false),
    /** Rückvergütung in % (Cashback, Kartenpunkte) – senkt den effektiven EK. */
    rueckverguetung: numeric("rueckverguetung", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    ekNetto: numeric("ek_netto", { precision: 12, scale: 2, mode: "number" }),
    menge: integer("menge"),
    ampel: text("ampel"),
    land: text("land"),
    gewinnStueck: numeric("gewinn_stueck", { precision: 12, scale: 2, mode: "number" }),
    roi: numeric("roi", { precision: 8, scale: 1, mode: "number" }),
    roiPa: numeric("roi_pa", { precision: 8, scale: 0, mode: "number" }),
    empfohleneMenge: integer("empfohlene_menge"),
    /** Volles Ergebnis (Begründung, Hinweise, Bestand, Kapital-Ampel, Satz zum Vorlesen). */
    ergebnis: jsonb("ergebnis").$type<Record<string, unknown>>(),
    fehler: text("fehler"),
    offline: boolean("offline").notNull().default(false),
    /** Zeitpunkt des Scans auf dem Handy (bei Offline-Scans früher als created_at). */
    gescanntAm: timestamp("gescannt_am", { withTimezone: true }).notNull().defaultNow(),
    aktion: text("aktion", { enum: ["einkaufsliste", "deal", "verworfen", "kauf_vorbereitet", "gekauft"] }),
    listeMenge: integer("liste_menge"),
    listePreis: numeric("liste_preis", { precision: 12, scale: 2, mode: "number" }),
    /** Shop bzw. Ort (Laden, Filiale). */
    listeOrt: text("liste_ort"),
    dealEingangId: uuid("deal_eingang_id"),
    /** Belege zum Scan: Preisschild (Medienablage) und Kassenbon (Rechnungsstation). */
    belege: jsonb("belege").$type<{ art: "preisschild" | "kassenbon"; key?: string; belegId?: string; am: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("scan_eintraege_tenant_idx").on(t.tenantId, t.gescanntAm)],
);
