"use server";

import bcrypt from "bcryptjs";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { homeFor } from "@/lib/auth/areas";
import { privatVollBeiNichtInhaber } from "@/lib/auth/rollen";
import { createSession, destroySession } from "@/lib/auth/session";
import { normalizeLogin } from "@/lib/auth/username";
import { safeNext } from "@/lib/auth/next-path";

// Einfache Bremse gegen Durchprobieren von Passwörtern (pro Prozess).
const attempts = new Map<string, { count: number; until: number }>();

// Unbekannter Benutzername: trotzdem einmal bcrypt rechnen, damit die Antwortzeit nicht verrät, ob es ihn gibt.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= bcrypt.hash("kein-benutzer", 12));

/** `email` = eingegebener Anmeldename (Benutzername oder E-Mail). */
export type LoginState = { error: string; email: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const typed = String(formData.get("email") ?? "");
  const name = normalizeLogin(typed);
  const password = String(formData.get("password") ?? "");
  if (!name || !password) return { error: "Bitte Benutzername und Passwort eingeben.", email: typed };

  const a = attempts.get(name);
  if (a && a.count >= 5 && a.until > Date.now()) {
    return { error: "Zu viele Versuche. Bitte in ein paar Minuten erneut probieren.", email: typed };
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, name));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await dummy()));
  if (!user || !ok) {
    const next = { count: (a?.count ?? 0) + 1, until: Date.now() + 5 * 60_000 };
    attempts.set(name, next);
    return { error: "Benutzername oder Passwort ist falsch.", email: typed };
  }
  attempts.delete(name);

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);
  if (!membership) return { error: "Diesem Konto ist noch keine Firma zugeordnet.", email: typed };
  if (membership.deaktiviertAm) return { error: `Dieses Konto ist deaktiviert${membership.deaktiviertGrund ? ` (${membership.deaktiviertGrund})` : ""}. Bitte den Inhaber bitten, es unter Einstellungen → Benutzer wieder zu aktivieren.`, email: typed };

  const now = new Date();
  await db.update(schema.users).set({ lastLoginAt: now, lastSeenAt: now }).where(eq(schema.users.id, user.id));
  await createSession(user.id, membership.tenantId);
  // Claude-Freigabe: nach dem Login zurück zur Freigabe-Seite.
  const next = safeNext(formData.get("weiter"));
  if (next) redirect(next);
  // Gleich auf die eigene Startseite (z. B. nur Paletten-Lager oder nur Privat), ohne „gesperrt“-Umweg.
  const home = homeFor({ role: membership.role, areas: membership.areas ?? null, privateAccess: membership.privateAccess, readOnly: membership.role === "staff" && membership.readOnly });
  // B20.1: Inhaber sieht die 🔴-Warnung einmal je Anmeldung als Dialog, solange ein Nicht-Inhaber Privat „voll“ hat.
  if (membership.role === "owner") {
    const M = schema.memberships;
    const andere = await db.select({ role: M.role, privateAccess: M.privateAccess, privateScope: M.privateScope, readOnly: M.readOnly }).from(M).where(and(eq(M.tenantId, membership.tenantId), isNull(M.deaktiviertAm)));
    if (privatVollBeiNichtInhaber(andere) > 0) redirect(`${home}${home.includes("?") ? "&" : "?"}privatwarnung=1`);
  }
  redirect(home);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
