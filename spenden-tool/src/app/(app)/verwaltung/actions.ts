"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin, requireLogin, startSession } from "@/lib/auth";
import { generatePassword, hashPassword, MIN_PASSWORD, normalizeEmail, normalizeLogin, verifyPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { deleteOrphanFiles } from "@/lib/service";

const U = schema.users;
const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export type FormState = { ok: boolean; message: string } | null;

export type CreateState = { ok: boolean; message: string; created?: { name: string; login: string; email: string | null; password: string | null }[] } | null;

/** Freien Anmeldenamen finden: „anna.müller“, sonst „anna.müller2“ … */
async function freeLogin(base: string) {
  for (let i = 1; i < 100; i++) {
    const login = i === 1 ? base : `${base}${i}`;
    const [taken] = await db.select({ id: U.id }).from(U).where(eq(U.login, login));
    if (!taken) return login;
  }
  return `${base}${Date.now() % 10000}`;
}

/**
 * Zugänge anlegen – einzeln (E-Mail, Name, Rolle, Passwort optional) oder mehrere auf einmal (eine Person pro Zeile:
 * „Name, E-Mail“). Ohne Passwort erzeugt das Tool eines und zeigt es einmal an. Der erste Admin ersetzt das
 * Team-Passwort – wer gerade damit angemeldet ist, wird gleich als dieser Admin angemeldet.
 */
export async function createUsers(_prev: CreateState, fd: FormData): Promise<CreateState> {
  const me = await requireAdmin();
  const first = me.id === null;
  const isAdmin = first || fd.get("role") === "admin";
  const typed = String(fd.get("password") ?? "");
  type Row = { name: string; email: string };
  const rows: Row[] = [];
  const bulk = str(fd, "bulk");
  if (bulk) {
    for (const line of bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 50)) {
      const parts = line.split(/[,;\t]/).map((x) => x.trim());
      const email = parts.find((x) => x.includes("@")) ?? "";
      const name = parts.find((x) => x && !x.includes("@")) ?? email.split("@")[0];
      rows.push({ name, email });
    }
  } else {
    const email = str(fd, "email");
    rows.push({ name: str(fd, "name") || email.split("@")[0], email });
  }
  if (rows.length === 0 || rows.some((r) => !r.name)) return { ok: false, message: "Bitte mindestens einen Namen oder eine E-Mail eingeben." };
  if (first && !typed) return { ok: false, message: "Für den ersten Admin bitte selbst ein Passwort wählen – damit meldest du dich gleich an." };
  if (typed && typed.length < MIN_PASSWORD) return { ok: false, message: `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.` };

  const created: NonNullable<CreateState>["created"] = [];
  const skipped: string[] = [];
  let firstUser: typeof U.$inferSelect | null = null;
  for (const r of rows) {
    const email = r.email ? normalizeEmail(r.email) : "";
    if (r.email && !email) {
      skipped.push(`${r.name} (E-Mail ungültig)`);
      continue;
    }
    if (email) {
      const [dupe] = await db.select({ id: U.id }).from(U).where(eq(U.email, email));
      if (dupe) {
        skipped.push(`${r.name} (E-Mail schon vergeben)`);
        continue;
      }
    }
    const login = await freeLogin(normalizeLogin(r.name) || normalizeLogin(email.split("@")[0]) || "helfer");
    const password = typed && rows.length === 1 ? typed : generatePassword();
    const [u] = await db
      .insert(U)
      .values({ name: r.name.slice(0, 80), login, email: email || null, passwordHash: await hashPassword(password), isAdmin })
      .returning();
    firstUser ??= u;
    created.push({ name: u.name, login, email: u.email, password: typed && rows.length === 1 ? null : password });
  }
  if (created.length) await logActivity(me, `${created.length === 1 ? `Zugang für ${created[0].name}` : `${created.length} Zugänge`} angelegt${isAdmin ? " – Admin" : ""}`);
  if (first && firstUser) {
    // Team-Passwort gilt ab jetzt nicht mehr – direkt mit dem neuen Admin weiterarbeiten.
    await startSession(firstUser);
    redirect("/verwaltung?erster=1");
  }
  revalidatePath("/verwaltung");
  const msg = [created.length ? `${created.length} Zugang/Zugänge angelegt.` : "", skipped.length ? `Übersprungen: ${skipped.join(", ")}.` : ""].filter(Boolean).join(" ");
  return { ok: created.length > 0, message: msg || "Nichts angelegt.", created };
}

/** Zugang entfernen (wie im Seller-Tool). Das Protokoll behält den Namen; den letzten Admin und sich selbst nicht. */
export async function deleteUser(fd: FormData) {
  const me = await requireAdmin();
  const id = uuid.parse(fd.get("userId"));
  if (id === me.id) return;
  const [u] = await db.select().from(U).where(eq(U.id, id));
  if (!u) return;
  if (u.isAdmin && u.active) {
    const [other] = await db.select({ id: U.id }).from(U).where(and(ne(U.id, id), eq(U.isAdmin, true), eq(U.active, true))).limit(1);
    if (!other) return;
  }
  await db.delete(U).where(eq(U.id, id));
  await logActivity(me, `Zugang ${u.name} (${u.login}) entfernt`);
  revalidatePath("/verwaltung");
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
  const rawEmail = str(fd, "email");
  const email = rawEmail ? normalizeEmail(rawEmail) : "";
  if (rawEmail && !email) return { ok: false, message: "Die E-Mail-Adresse sieht nicht richtig aus." };
  if (email && email !== u.email) {
    const [dupe] = await db.select({ id: U.id }).from(U).where(and(eq(U.email, email), ne(U.id, id)));
    if (dupe) return { ok: false, message: "Diese E-Mail hat schon ein anderer Zugang." };
  }
  if (u.isAdmin && u.active && (!isAdmin || !active)) {
    const [other] = await db.select({ id: U.id }).from(U).where(and(ne(U.id, id), eq(U.isAdmin, true), eq(U.active, true))).limit(1);
    if (!other) return { ok: false, message: "Es muss mindestens ein aktiver Admin bleiben." };
  }
  const passwordHash = password ? await hashPassword(password) : u.passwordHash;
  await db.update(U).set({ name, isAdmin, active, passwordHash, email: email || null }).where(eq(U.id, id));
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
