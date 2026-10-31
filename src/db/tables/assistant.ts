import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt, users } from "./core";
import { encryptedJson, encryptedText } from "./encrypted";

/**
 * KI-Assistent: (1) Claude-Konnektor – claude.ai meldet sich per OAuth an und ruft die Werkzeuge über
 * /api/mcp auf; (2) Fragefeld im Seller-System (Claude-API mit eigenem Schlüssel). Beide nutzen dieselben
 * Werkzeuge mit den Rechten der angemeldeten Person.
 */

/** Programme, die sich selbst registriert haben (z. B. claude.ai) – nur mit erlaubten Rücksprung-Adressen. */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: id(),
    clientId: text("client_id").notNull(),
    /** Nur bei vertraulichen Programmen; öffentliche (PKCE) haben keins. */
    secretHash: text("secret_hash"),
    name: text("name"),
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_clients_client_id_uq").on(t.clientId)],
);

/** Einmal-Codes nach der Freigabe (5 Minuten gültig, nur einmal einlösbar). */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  tenantId: tenantId(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Erteilte Zugänge (eine Zeile je Verbindung). Zugangs- und Erneuerungs-Token liegen nur als Hash vor;
 * „Trennen“ setzt revokedAt – danach gilt keins der beiden mehr.
 */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    clientName: text("client_name"),
    /** Leerzeichen-getrennt: lesen, aendern, privat. */
    scope: text("scope").notNull(),
    accessHash: text("access_hash").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshHash: text("refresh_hash").notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_grants_access_uq").on(t.accessHash), uniqueIndex("oauth_grants_refresh_uq").on(t.refreshHash), index("oauth_grants_tenant_idx").on(t.tenantId, t.userId)],
);

/** Protokoll: welches Werkzeug wann über welchen Weg benutzt wurde (Änderungen nachvollziehbar). */
export const assistantLog = pgTable(
  "assistant_log",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel", { enum: ["claude", "app"] }).notNull(),
    tool: text("tool").notNull(),
    write: boolean("write").notNull().default(false),
    ok: boolean("ok").notNull(),
    /** Kurzbeschreibung (bei Privat nur die Art, nie Inhalte) – verschlüsselt. */
    summary: encryptedText("summary"),
    /** Auftragstext der Person (Fragefeld), der zu dieser Änderung geführt hat. */
    auftrag: encryptedText("auftrag"),
    /** Betroffene Datensätze (IDs). */
    ids: jsonb("ids").$type<string[]>().notNull().default([]),
    /** Stufe beim Ausführen (grün/gelb). */
    stufe: text("stufe"),
    /** Daten zum Rückgängigmachen (vorher-Zustand). */
    undo: encryptedJson<unknown>("undo"),
    rueckgaengigAm: timestamp("rueckgaengig_am", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_log_idx").on(t.tenantId, t.createdAt)],
);

/** Gespräche im Fragefeld – je Person, verschlüsselt (Fragen und Antworten enthalten Geschäftsdaten). */
export const assistantChats = pgTable(
  "assistant_chats",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: encryptedText("title"),
    /** Nachrichten wie an die Claude-API geschickt (nur angehängt, nie nachträglich geändert). */
    messages: encryptedJson<unknown[]>("messages").notNull(),
    /** Wartet auf Bestätigung: Werkzeug-Aufrufe, die etwas ändern würden. */
    pending: encryptedJson<unknown>("pending"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assistant_chats_user_idx").on(t.tenantId, t.userId, t.updatedAt)],
);
