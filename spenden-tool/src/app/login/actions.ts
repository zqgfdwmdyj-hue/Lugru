"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { checkTeamPassword, endSession, hasAdmin, startSession } from "@/lib/auth";
import { normalizeLogin, verifyPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";

export type LoginState = { error: string } | null;

// Gegen Durchprobieren: höchstens 10 Fehlversuche je Adresse und Name in 15 Minuten (im Speicher, reicht für
// einen Server). Je Name, damit ein Angreifer nicht das ganze Team aussperren kann.
const WINDOW = 15 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, number[]>();

async function clientKey(login: string) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unbekannt").trim();
  return `${ip}|${login}`;
}

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const name = normalizeLogin(String(fd.get("login") ?? ""));
  const password = String(fd.get("password") ?? "");
  const key = await clientKey(name);
  const now = Date.now();
  const recent = (fails.get(key) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX_FAILS) return { error: "Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen." };
  // Kleine Bremse gegen Durchprobieren
  await new Promise((r) => setTimeout(r, 400));
  const fail = (error: string): LoginState => {
    fails.set(key, [...recent, now]);
    if (fails.size > 5000) fails.clear();
    return { error };
  };

  if (await hasAdmin()) {
    // Eigene Zugänge: Name + Passwort
    if (!name) return { error: "Bitte E-Mail oder Namen eingeben." };
    // Anmeldename oder E-Mail-Adresse
    const raw = String(fd.get("login") ?? "").trim().toLowerCase();
    const [u] = await db.select().from(schema.users).where(raw.includes("@") ? eq(schema.users.email, raw) : eq(schema.users.login, name));
    if (!u || !u.active || !(await verifyPassword(password, u.passwordHash))) return fail("E-Mail/Name oder Passwort stimmt nicht.");
    fails.delete(key);
    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
    await startSession(u);
    redirect("/");
  }

  // Noch keine Benutzer: Team-Passwort (zum Anlegen der ersten Zugänge)
  if (!checkTeamPassword(password)) return fail("Passwort stimmt nicht.");
  fails.delete(key);
  await startSession(null);
  await logActivity({ id: null, name: "Team", isAdmin: true }, "Mit Team-Passwort angemeldet");
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
