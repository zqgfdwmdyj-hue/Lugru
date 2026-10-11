import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";

// Zugang: eigene Benutzer (Tabelle users) mit Namen und Passwort. Solange noch kein Admin angelegt ist, gilt das
// gemeinsame Team-Passwort (APP_PASSWORD) – damit legt man die ersten Zugänge an. Sitzung als signiertes Cookie.

export const SESSION_COOKIE = "spenden_session";
const DAYS = 30;
const TEAM = "team";

export type CurrentUser = { id: string | null; name: string; isAdmin: boolean };

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkTeamPassword(input: string) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  return safeEqual(sign(input), sign(pw));
}

/** Gibt es schon einen aktiven Admin? Dann ist das Team-Passwort abgeschaltet. */
export async function hasAdmin() {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.isAdmin, true), eq(schema.users.active, true)))
    .limit(1);
  return !!row;
}

/**
 * Die Signatur hängt am Passwort: Wird es geändert (Team-Passwort in der .env oder das eines Benutzers), sind alle
 * bisherigen Anmeldungen ungültig – z. B. bei einem verlorenen Handy. Deaktivierte Benutzer sind sofort abgemeldet.
 */
const sessionSig = (who: string, expires: string, fingerprint: string) => sign(`${who}|${expires}|${sign(`fp|${fingerprint}`)}`);
const teamFingerprint = () => `team|${process.env.APP_PASSWORD ?? ""}`;

export async function startSession(user: { id: string; passwordHash: string } | null) {
  const expires = String(Date.now() + DAYS * 86400_000);
  const who = user?.id ?? TEAM;
  const sig = sessionSig(who, expires, user ? user.passwordHash : teamFingerprint());
  (await cookies()).set(SESSION_COOKIE, `${who}.${expires}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
    path: "/",
    expires: new Date(Number(expires)),
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Angemeldete Person dieser Anfrage (je Anfrage nur einmal aus der Datenbank). */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const v = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!v) return null;
  const [who, expires, sig] = v.split(".");
  if (!who || !sig || !(Number(expires) > Date.now())) return null;
  if (who === TEAM) {
    if (!process.env.APP_PASSWORD || !safeEqual(sig, sessionSig(TEAM, expires, teamFingerprint()))) return null;
    // Sobald ein Admin existiert, gilt nur noch der eigene Zugang.
    if (await hasAdmin()) return null;
    return { id: null, name: "Team", isAdmin: true };
  }
  if (!/^[0-9a-f-]{36}$/i.test(who)) return null;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, who));
  if (!u || !u.active || !safeEqual(sig, sessionSig(u.id, expires, u.passwordHash))) return null;
  return { id: u.id, name: u.name, isAdmin: u.isAdmin };
});

export async function isLoggedIn() {
  return (await currentUser()) !== null;
}

/** In jeder Seite, Server-Aktion und Route aufrufen. */
export async function requireLogin(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Nur für Admins (Benutzer verwalten, Aufräumen). */
export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireLogin();
  if (!u.isAdmin) redirect("/");
  return u;
}
