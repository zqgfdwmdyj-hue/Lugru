import "server-only";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { portalBasis } from "./service";

// Anmeldung im Kundenportal – völlig getrennt von den Konten des Seller-Systems: eigene Tabellen, eigenes Cookie
// (nur unter /portal gültig). Ein Portal-Zugang sieht nur Deals und die eigenen Reservierungen/Rechnungen.

export const PORTAL_COOKIE = "b2b_portal";
const SITZUNG_TAGE = 14;
const EINLADUNG_TAGE = 7;
const Z = schema.b2bZugaenge;
const SZ = schema.b2bSitzungen;
const K = schema.b2bKunden;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const emailHash = (email: string) => sha(`b2b-mail:${email.trim().toLowerCase()}`);
export const passwortFehler = (pw: string) => (pw.length < 10 ? "Das Passwort braucht mindestens 10 Zeichen." : pw.length > 200 ? "Das Passwort ist zu lang." : null);

/** Einladung (neu oder erneut): Link 7 Tage gültig. Gibt den Link nur einmal zurück – gespeichert wird nur der Prüfwert. */
export async function einladungErstellen(tenantId: string, kundeId: string): Promise<{ ok: true; link: string; email: string; bis: Date } | { ok: false; fehler: string }> {
  const [k] = await db.select({ id: K.id, email: K.email, aktiv: K.aktiv }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.id, kundeId)));
  if (!k) return { ok: false, fehler: "Kunde nicht gefunden." };
  if (!k.aktiv) return { ok: false, fehler: "Kunde ist inaktiv." };
  if (!k.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k.email)) return { ok: false, fehler: "Beim Kunden fehlt eine gültige E-Mail-Adresse." };
  const eh = emailHash(k.email);
  const [fremd] = await db.select({ id: Z.id }).from(Z).where(and(eq(Z.emailHash, eh), ne(Z.kundeId, kundeId)));
  if (fremd) return { ok: false, fehler: "Diese E-Mail-Adresse hat schon einen Zugang bei einem anderen Kunden." };
  const token = randomBytes(24).toString("base64url");
  const bis = new Date(Date.now() + EINLADUNG_TAGE * 86400_000);
  const [z] = await db.select({ id: Z.id }).from(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.kundeId, kundeId)));
  if (z) await db.update(Z).set({ emailHash: eh, einladungHash: sha(token), einladungBis: bis }).where(eq(Z.id, z.id));
  else await db.insert(Z).values({ tenantId, kundeId, emailHash: eh, einladungHash: sha(token), einladungBis: bis });
  return { ok: true, link: `${portalBasis()}/portal/einladung/${token}`, email: k.email, bis };
}

export async function einladungGueltig(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [z] = await db
    .select({ id: Z.id, tenantId: Z.tenantId, kundeId: Z.kundeId, firma: K.firma, gesperrt: Z.gesperrt })
    .from(Z)
    .innerJoin(K, eq(K.id, Z.kundeId))
    .where(and(eq(Z.einladungHash, sha(token)), gt(Z.einladungBis, new Date())));
  return z && !z.gesperrt ? z : null;
}

/** Passwort über den Einladungs-Link setzen; danach ist der Link verbraucht und der Kunde angemeldet. */
export async function passwortSetzen(token: string, passwort: string): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const z = await einladungGueltig(token);
  if (!z) return { ok: false, fehler: "Der Link ist abgelaufen oder wurde schon benutzt – bitte eine neue Einladung anfordern." };
  const f = passwortFehler(passwort);
  if (f) return { ok: false, fehler: f };
  await db.update(Z).set({ passwortHash: await bcrypt.hash(passwort, 12), einladungHash: null, einladungBis: null }).where(eq(Z.id, z.id));
  await db.delete(SZ).where(eq(SZ.zugangId, z.id));
  await sitzungAnlegen(z.id, z.tenantId, z.kundeId);
  return { ok: true };
}

// Zu viele Fehlversuche: je E-Mail und je Adresse höchstens 8 in 15 Minuten (im Speicher des Servers).
const versuche = new Map<string, number[]>();
function gebremst(schluessel: string[]): boolean {
  const jetzt = Date.now();
  return schluessel.some((s) => (versuche.get(s) ?? []).filter((t) => jetzt - t < 15 * 60_000).length >= 8);
}
function fehlversuch(schluessel: string[]) {
  const jetzt = Date.now();
  for (const s of schluessel) versuche.set(s, [...(versuche.get(s) ?? []).filter((t) => jetzt - t < 15 * 60_000), jetzt]);
  if (versuche.size > 10_000) versuche.clear();
}

let dummy: string | null = null;
const platzhalter = async () => (dummy ??= await bcrypt.hash(randomBytes(16).toString("hex"), 12));

export async function anmelden(email: string, passwort: string, ip: string): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const eh = emailHash(email);
  const schluessel = [`m:${eh}`, `i:${ip}`];
  if (gebremst(schluessel)) return { ok: false, fehler: "Zu viele Versuche – bitte in 15 Minuten erneut versuchen." };
  const [z] = await db.select({ id: Z.id, tenantId: Z.tenantId, kundeId: Z.kundeId, hash: Z.passwortHash, gesperrt: Z.gesperrt, aktiv: K.aktiv }).from(Z).innerJoin(K, eq(K.id, Z.kundeId)).where(eq(Z.emailHash, eh));
  // Immer vergleichen (auch ohne Zugang), damit die Antwortzeit nichts verrät.
  const ok = await bcrypt.compare(passwort, z?.hash ?? (await platzhalter()));
  if (!z || !z.hash || !ok || z.gesperrt || !z.aktiv) {
    fehlversuch(schluessel);
    return { ok: false, fehler: "E-Mail oder Passwort stimmt nicht." };
  }
  await db.update(Z).set({ letzterLogin: new Date() }).where(eq(Z.id, z.id));
  await sitzungAnlegen(z.id, z.tenantId, z.kundeId);
  return { ok: true };
}

async function sitzungAnlegen(zugangId: string, tenantId: string, kundeId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SITZUNG_TAGE * 86400_000);
  await db.insert(SZ).values({ id: sha(token), zugangId, tenantId, kundeId, expiresAt });
  (await cookies()).set(PORTAL_COOKIE, token, { httpOnly: true, secure: (process.env.APP_URL ?? "").startsWith("https://"), sameSite: "lax", path: "/portal", expires: expiresAt });
}

export async function abmelden() {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (token) await db.delete(SZ).where(eq(SZ.id, sha(token)));
  store.delete({ name: PORTAL_COOKIE, path: "/portal" });
}

export type PortalSitzung = { zugangId: string; tenantId: string; kundeId: string; firma: string };

/** Aktueller Portal-Kunde – gesperrte Zugänge und inaktive Kunden gelten als abgemeldet. */
export const portalSitzung = cache(async (): Promise<PortalSitzung | null> => {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const [r] = await db
    .select({ zugangId: SZ.zugangId, tenantId: SZ.tenantId, kundeId: SZ.kundeId, firma: K.firma, gesperrt: Z.gesperrt, aktiv: K.aktiv })
    .from(SZ)
    .innerJoin(Z, eq(Z.id, SZ.zugangId))
    .innerJoin(K, and(eq(K.id, SZ.kundeId), eq(K.tenantId, SZ.tenantId)))
    .where(and(eq(SZ.id, sha(token)), gt(SZ.expiresAt, new Date())));
  if (!r || r.gesperrt || !r.aktiv) return null;
  return { zugangId: r.zugangId, tenantId: r.tenantId, kundeId: r.kundeId, firma: r.firma };
});

export async function requirePortal(): Promise<PortalSitzung> {
  const s = await portalSitzung();
  if (!s) redirect("/portal/login");
  return s;
}

/** Zugang sperren: alle Sitzungen sofort ungültig. */
export async function zugangSperren(tenantId: string, kundeId: string, gesperrt: boolean) {
  const rows = await db.update(Z).set({ gesperrt }).where(and(eq(Z.tenantId, tenantId), eq(Z.kundeId, kundeId))).returning({ id: Z.id });
  if (gesperrt) for (const r of rows) await db.delete(SZ).where(eq(SZ.zugangId, r.id));
}

/** Passwort ändern (altes nötig); andere Geräte werden abgemeldet, diese Sitzung bleibt. */
export async function passwortAendern(s: PortalSitzung, alt: string, neu: string): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const f = passwortFehler(neu);
  if (f) return { ok: false, fehler: f };
  const [z] = await db.select({ hash: Z.passwortHash }).from(Z).where(and(eq(Z.id, s.zugangId), eq(Z.tenantId, s.tenantId)));
  if (!z?.hash || !(await bcrypt.compare(alt, z.hash))) return { ok: false, fehler: "Das bisherige Passwort stimmt nicht." };
  await db.update(Z).set({ passwortHash: await bcrypt.hash(neu, 12) }).where(eq(Z.id, s.zugangId));
  const token = (await cookies()).get(PORTAL_COOKIE)?.value ?? "";
  await db.delete(SZ).where(and(eq(SZ.zugangId, s.zugangId), ne(SZ.id, sha(token))));
  return { ok: true };
}
