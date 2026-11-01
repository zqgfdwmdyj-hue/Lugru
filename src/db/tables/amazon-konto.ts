import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, money, tenantId } from "./core";
import type { KontoMarkt, KontoStufe, Verstoss } from "@/lib/amazon-berichte/logic";

// Amazon-Berichte 1–4: Kontozustand je Marktplatz (jeder Abruf eine Zeile – Vergleich mit dem letzten Stand),
// gestrandeter Bestand + gesperrte Angebote (Stand des letzten Berichts) und weitere Gebühren (Langzeitlager,
// Inbound-Mängel; Lagerlimit kommt aus den Transaktionen).

export const amazonKontozustand = pgTable(
  "amazon_kontozustand",
  {
    id: id(),
    tenantId: tenantId(),
    marktplatz: text("marktplatz").notNull(),
    land: text("land"),
    ahrStatus: text("ahr_status"),
    ahrScore: integer("ahr_score"),
    werte: jsonb("werte").$type<KontoMarkt["werte"]>().notNull(),
    verstoesse: jsonb("verstoesse").$type<Verstoss[]>().notNull().default([]),
    stufe: text("stufe").$type<KontoStufe>().notNull(),
    gruende: jsonb("gruende").$type<string[]>().notNull().default([]),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("amazon_kontozustand_idx").on(t.tenantId, t.marktplatz, t.abgerufenAm)],
);

export const amazonGestrandet = pgTable(
  "amazon_gestrandet",
  {
    id: id(),
    tenantId: tenantId(),
    /** gestrandet / gesperrt */
    art: text("art", { enum: ["gestrandet", "gesperrt"] }).notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    fnsku: text("fnsku"),
    titel: text("titel"),
    status: text("status"),
    grund: text("grund"),
    seit: date("seit", { mode: "string" }),
    autoEntfernung: date("auto_entfernung", { mode: "string" }),
    menge: integer("menge").notNull().default(0),
    preis: money("preis"),
    aktion: text("aktion"),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("amazon_gestrandet_uq").on(t.tenantId, t.art, t.sku)],
);

export const amazonZusatzgebuehren = pgTable(
  "amazon_zusatzgebuehren",
  {
    id: id(),
    tenantId: tenantId(),
    art: text("art", { enum: ["langzeitlager", "lagerlimit", "inbound_mangel", "inbound_platzierung"] }).notNull(),
    rowKey: text("row_key").notNull(),
    monat: text("monat").notNull(),
    datum: date("datum", { mode: "string" }),
    sku: text("sku"),
    asin: text("asin"),
    fnsku: text("fnsku"),
    sendung: text("sendung"),
    titel: text("titel"),
    menge: integer("menge"),
    betrag: money("betrag").notNull(),
    waehrung: text("waehrung").notNull().default("EUR"),
    land: text("land"),
    text: text("text"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("amazon_zusatzgebuehren_uq").on(t.tenantId, t.rowKey), index("amazon_zusatzgebuehren_monat_idx").on(t.tenantId, t.monat)],
);
