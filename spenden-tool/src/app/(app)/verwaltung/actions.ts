"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin, requireLogin, startSession } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD, normalizeLogin, verifyPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { deleteOrphanFiles } from "@/lib/service";

const U = schema.users;
const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export type FormState = { ok: boolean; message: string } | null;

/** Neuen Zugang anlegen. Der erste Admin ersetzt das Team-Passwort – wer gerade damit angemeldet ist, wird gleich als dieser Admin angemeldet. */
export async function createUser(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const name = str(fd, "name").slice(0, 80);
  const login = normalizeLogin(str(fd, "login") || name);
  const password = String(fd.get("password") ?? "");
  const isAdmin = fd.get("isAdmin") === "on";
  if (!name || !login) return { ok: false, message: "Bitte einen Namen eingeben." };
  if (password.length < MIN_PASSWORD) return { ok: false, message: `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.` };
  const [taken] = await db.select({ id: U.id }).from(U).where(eq(U.login, login));
  if (taken) return { ok: false, message: `Den Anmeldenamen „${login}“ gibt es schon.` };
  const [u] = await db.insert(U).values({ name, login, passwordHash: await hashPassword(password), isAdmin }).returning();
  await logActivity(me, `Zugang für ${name} (${login}) angelegt${isAdmin ? " – Admin" : ""}`);
  if (me.id === null && isAdmin) {
    // Team-Passwort gilt ab jetzt nicht mehr – direkt mit dem neuen Admin weiterarbeiten.
    await startSession(u);
    redirect("/verwaltung?erster=1");
  }
  revalidatePath("/verwaltung");
  return { ok: true, message: `Zugang angelegt. Anmeldename: ${login}` };
}

/** Name, Rolle, aktiv und ggf. neues Passwort. Der letzte aktive Admin kann sich nicht selbst aussperren. */
export async function updateUser(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const id = uuid.parse(fd.get("userId"));
  const [u] = await db.select().from(U).where(eq(U.id, id));
  if (!u) return { ok: false, message: "Zugang nicht gefunden." };
  const name = str(fd, "name").slice(0, 80) || u.name;
  const isAdmin = fd.get("isAdmin") === "on";
  const active = fd.get("active") === "on";
  const password = String(fd.get("password") ?? "");
  if (password && password.length < MIN_PASSWORD) return { ok: false, message: `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.` };
  if (u.isAdmin && u.active && (!isAdmin || !active)) {
    const [other] = await db.select({ id: U.id }).from(U).where(and(ne(U.id, id), eq(U.isAdmin, true), eq(U.active, true))).limit(1);
    if (!other) return { ok: false, message: "Es muss mindestens ein aktiver Admin bleiben." };
  }
  const passwordHash = password ? await hashPassword(password) : u.passwordHash;
  await db.update(U).set({ name, isAdmin, active, passwordHash }).where(eq(U.id, id));
  const changes = [password && "neues Passwort", !active && u.active && "deaktiviert", active && !u.active && "wieder aktiviert", isAdmin !== u.isAdmin && (isAdmin ? "jetzt Admin" : "kein Admin mehr")].filter(Boolean);
  await logActivity(me, `Zugang ${u.login} geändert${changes.length ? `: ${changes.join(", ")}` : ""}`);
  // Eigenes Passwort geändert: angemeldet bleiben (alle anderen Geräte sind abgemeldet).
  if (me.id === id && password) await startSession({ id, passwordHash });
  revalidatePath("/verwaltung");
  return { ok: true, message: `Gespeichert${changes.length ? ` (${changes.join(", ")})` : ""}.` };
}

/** Eigenes Passwort ändern – für alle. */
export async function changeOwnPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireLogin();
  if (!me.id) return { ok: false, message: "Mit dem Team-Passwort angemeldet – bitte unter Verwaltung eigene Zugänge anlegen." };
  const [u] = await db.select().from(U).where(eq(U.id, me.id));
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (!u || !(await verifyPassword(current, u.passwordHash))) return { ok: false, message: "Das bisherige Passwort stimmt nicht." };
  if (next.length < MIN_PASSWORD) return { ok: false, message: `Das neue Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.` };
  if (next !== String(fd.get("repeat") ?? "")) return { ok: false, message: "Die beiden neuen Passwörter sind nicht gleich." };
  const passwordHash = await hashPassword(next);
  await db.update(U).set({ passwordHash }).where(eq(U.id, u.id));
  await startSession({ id: u.id, passwordHash });
  await logActivity(me, "Eigenes Passwort geändert");
  return { ok: true, message: "Passwort geändert. Andere Geräte sind jetzt abgemeldet." };
}

/** Fotos löschen, die nirgends mehr verwendet werden (ersetzt, entfernt, zusammengeführt). */
export async function cleanupFiles(): Promise<void> {
  const me = await requireAdmin();
  const { count, bytes } = await deleteOrphanFiles();
  await logActivity(me, `Aufgeräumt: ${count} ungenutzte Fotos (${(bytes / 1024 / 1024).toFixed(1)} MB) gelöscht`);
  revalidatePath("/verwaltung");
}
