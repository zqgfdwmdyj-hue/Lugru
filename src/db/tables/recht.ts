import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt } from "./core";
import { encryptedText } from "./encrypted";

// B14 Teil A – Rechtsfälle beim Anwalt (Asana nur lesen + Mails). Inhalte verschlüsselt. Private Fälle
// (bereich = „privat“) sind nur im Privatbereich sichtbar (Personen mit vollem Privat-Zugang), nie für VA/Mitarbeiter.
// Teil B – Discord-Kanäle der Deal-Gruppe (nur lesen): Rohnachrichten höchstens 30 Tage, danach nur Zusammenfassungen.

export const rechtsfaelle = pgTable(
  "rechtsfaelle",
  {
    id: id(),
    tenantId: tenantId(),
    quelle: text("quelle", { enum: ["asana", "hand", "mail"] }).notNull(),
    /** Asana-Aufgabe (gid) – gegen Dubletten. */
    asanaGid: text("asana_gid"),
    asanaUrl: text("asana_url"),
    titel: encryptedText("titel").notNull(),
    aktenzeichen: encryptedText("aktenzeichen"),
    gegenstand: encryptedText("gegenstand"),
    bereich: text("bereich", { enum: ["geschaeft", "privat"] }).notNull(),
    /** LuGru, WiGru, W&G … (nur geschäftlich). */
    firma: text("firma"),
    status: text("status").notNull().default("offen"),
    amZug: text("am_zug", { enum: ["anwalt", "wir", "gegenseite", "gericht", "unklar"] }).notNull().default("unklar"),
    naechsteFrist: date("naechste_frist", { mode: "string" }),
    fristText: encryptedText("frist_text"),
    letzterStand: encryptedText("letzter_stand"),
    letzteBewegung: timestamp("letzte_bewegung", { withTimezone: true }),
    abgeschlossen: timestamp("abgeschlossen", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("rechtsfaelle_asana_uq").on(t.tenantId, t.asanaGid), index("rechtsfaelle_bereich_idx").on(t.tenantId, t.bereich)],
);

export const rechtsfallEintraege = pgTable(
  "rechtsfall_eintraege",
  {
    id: id(),
    tenantId: tenantId(),
    fallId: uuid("fall_id")
      .notNull()
      .references(() => rechtsfaelle.id, { onDelete: "cascade" }),
    art: text("art", { enum: ["kommentar", "mail", "frist", "status", "entwurf", "notiz"] }).notNull(),
    text: encryptedText("text").notNull(),
    datum: timestamp("datum", { withTimezone: true }).notNull(),
    /** Asana-Story-gid bzw. Mail-Schlüssel – gegen Dubletten. */
    quelleRef: text("quelle_ref"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("rechtsfall_eintraege_ref_uq").on(t.tenantId, t.quelleRef), index("rechtsfall_eintraege_fall_idx").on(t.tenantId, t.fallId, t.datum)],
);

/** Rohnachrichten aus freigegebenen Discord-Kanälen – höchstens `rohTage` (Standard 30), danach gelöscht. */
export const discordChat = pgTable(
  "discord_chat",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: text("kanal_id").notNull(),
    nachrichtId: text("nachricht_id").notNull(),
    /** Anzeigename nur verschlüsselt; in Zusammenfassungen nur „laut Gruppe“. */
    autor: encryptedText("autor"),
    autorId: text("autor_id"),
    text: encryptedText("text").notNull(),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("discord_chat_nachricht_uq").on(t.tenantId, t.nachrichtId), index("discord_chat_kanal_idx").on(t.tenantId, t.kanalId, t.gesendetAm)],
);

/** Lesestand und letzte Zusammenfassung je Kanal. */
export const discordChatStand = pgTable(
  "discord_chat_stand",
  {
    id: id(),
    tenantId: tenantId(),
    kanalId: text("kanal_id").notNull(),
    name: text("name").notNull(),
    rhythmus: text("rhythmus", { enum: ["taeglich", "woechentlich", "aus"] }).notNull(),
    letzteId: text("letzte_id"),
    letzteZusammenfassung: timestamp("letzte_zusammenfassung", { withTimezone: true }),
    /** Frühwarnungen (Thema → Zeitpunkt), damit dieselbe Warnung nicht mehrfach kommt. */
    gewarnt: text("gewarnt"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("discord_chat_stand_uq").on(t.tenantId, t.kanalId)],
);
