import "server-only";
import bcrypt from "bcryptjs";
import { and, eq, inArray, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { homeFor } from "@/lib/auth/areas";
import { requireSession, type Session } from "@/lib/auth/session";
import { DEFAULT_MED_PLAN, DEFAULT_PRIVATE_SETTINGS, type MedPlan, type PartnerKey, type PrivateSettings } from "./logic";

// Bereich „Privat“: Zugang (eigenes Recht + optionale PIN) und Einträge. Inhalte liegen verschlüsselt
// in private_entries.data; hier wird entschlüsselt gelesen und nach Sichtbarkeit gefiltert.

const E = schema.privateEntries;
/** So lange bleibt „Privat“ nach der PIN offen (verlängert sich bei Benutzung). */
export const UNLOCK_MINUTES = 30;

export type PrivateKind = "intim" | "paarzeit" | "kinder" | "ausschlafen" | "auszeit" | "medplan" | "routine" | "danke" | "stimmung" | "zustaendig" | "dateidee" | "aufgabe" | "termin" | "tagebuch" | "beobachtung" | "gespraech" | "einstellungen";
/** Diese Einträge gehören dem Verfasser – nur er ändert oder löscht sie. */
const OWN_KINDS = new Set<PrivateKind>(["tagebuch", "beobachtung", "medplan", "routine", "stimmung"]);
/** Nur für den Verfasser sichtbar (Tagebuch zusätzlich, wenn freigegeben). */
const PERSONAL_KINDS = new Set<string>(["medplan", "routine"]);
/** Was Personen mit Umfang „familie“ sehen und eintragen dürfen – gemeinsame Familieninfos, sonst nichts. */
export const FAMILY_KINDS = new Set<PrivateKind>(["kinder", "ausschlafen", "auszeit", "zustaendig"]);

/** Darf diese Sitzung Einträge dieser Art sehen bzw. anlegen? (Umfang „familie“ nur Familieninfos.) */
export function kindAllowed(session: Pick<Session, "privateScope">, kind: PrivateKind): boolean {
  return session.privateScope !== "familie" || FAMILY_KINDS.has(kind);
}

/**
 * Für alle Seiten und Aktionen in „Privat“: Zugang nötig, mit PIN zusätzlich entsperrt.
 * `allowLocked` nur für die Entsperr-Seite selbst.
 */
export async function requirePrivate(opts: { allowLocked?: boolean; full?: boolean } = {}): Promise<Session> {
  const session = await requireSession();
  if (!session.privateAccess) redirect(`${homeFor(session)}?gesperrt=1`);
  // Partnerschaft, Gesundheit, Therapie: nur mit vollem Umfang – direkt aufgerufene Links eingeschlossen.
  if (opts.full && session.privateScope === "familie") redirect("/privat?nurfamilie=1");
  if (session.privatePin && !opts.allowLocked) {
    const until = session.privateUnlockedUntil?.getTime() ?? 0;
    if (until <= Date.now()) redirect("/privat/entsperren");
    // Bei Benutzung verlängern (höchstens alle 5 Minuten schreiben).
    if (until - Date.now() < (UNLOCK_MINUTES - 5) * 60_000) {
      await db.update(schema.sessions).set({ privateUnlockedUntil: new Date(Date.now() + UNLOCK_MINUTES * 60_000) }).where(eq(schema.sessions.id, session.sessionId));
    }
  }
  return session;
}

export type Entry<T = Record<string, unknown>> = { id: string; userId: string; kind: PrivateKind; data: T; createdAt: Date; updatedAt: Date };

/** Alle Personen mit Privat-Zugang dieser Firma (für Namen und Freigaben). */
export async function privateMembers(tenantId: string) {
  return db
    .select({ userId: schema.users.id, name: schema.users.name, login: schema.users.email, scope: schema.memberships.privateScope })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    // Nur-ansehen-Konten zählen nie dazu (sie bekommen „Privat“ nicht, auch mit Freigabe).
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.privateAccess, true), eq(schema.memberships.readOnly, false)));
}

export async function privateSettings(tenantId: string): Promise<PrivateSettings & { id: string | null }> {
  const [row] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.kind, "einstellungen"))).limit(1);
  const d = (row?.data ?? {}) as Partial<PrivateSettings>;
  return {
    id: row?.id ?? null,
    partners: { ...DEFAULT_PRIVATE_SETTINGS.partners, ...(d.partners ?? {}) },
    kids: d.kids ?? [],
    therapists: { ...DEFAULT_PRIVATE_SETTINGS.therapists, ...(d.therapists ?? {}) },
    diaryShared: d.diaryShared ?? [],
    userPartner: d.userPartner ?? {},
    wakeTime: d.wakeTime ?? DEFAULT_PRIVATE_SETTINGS.wakeTime,
    dateReminderDays: typeof d.dateReminderDays === "number" ? d.dateReminderDays : DEFAULT_PRIVATE_SETTINGS.dateReminderDays,
    startHint: d.startHint ?? {},
  };
}

export async function savePrivateSettings(session: Session, patch: Partial<PrivateSettings>) {
  const cur = await privateSettings(session.tenantId);
  const { id, ...rest } = cur;
  const data = { ...rest, ...patch };
  if (id) await db.update(E).set({ data, updatedAt: new Date() }).where(and(eq(E.id, id), eq(E.tenantId, session.tenantId)));
  else await db.insert(E).values({ tenantId: session.tenantId, userId: session.userId, kind: "einstellungen", data });
}

/**
 * Welche Person bin ich (Partner 1 oder 2)? Nur aus der ausdrücklichen Zuordnung – nie geraten (früher über
 * den Namen bzw. „Partner 1“). null = noch nicht festgelegt: dann fragt die Seite einmal danach.
 */
export function myPartner(s: PrivateSettings, session: Pick<Session, "userId">): PartnerKey | null {
  return s.userPartner[session.userId] ?? null;
}

/**
 * Einträge lesen (entschlüsselt). Tagebuch: eigenes und freigegebene; Beobachtungen: eigene und
 * die über mich. Alles andere teilen sich alle mit Privat-Zugang.
 */
export async function loadEntries<T = Record<string, unknown>>(session: Session, kinds: PrivateKind[]): Promise<Entry<T>[]> {
  kinds = kinds.filter((k) => kindAllowed(session, k));
  if (!kinds.length) return [];
  const rows = await db.select().from(E).where(and(eq(E.tenantId, session.tenantId), inArray(E.kind, kinds)));
  const settings = kinds.includes("tagebuch") ? await privateSettings(session.tenantId) : null;
  return rows
    .filter((r) => {
      if (PERSONAL_KINDS.has(r.kind)) return r.userId === session.userId;
      if (r.kind === "tagebuch") return r.userId === session.userId || settings!.diaryShared.includes(r.userId);
      if (r.kind === "beobachtung") return r.userId === session.userId || (r.data as { aboutUserId?: string }).aboutUserId === session.userId;
      return true;
    })
    .map((r) => ({ id: r.id, userId: r.userId, kind: r.kind as PrivateKind, data: r.data as T, createdAt: r.createdAt, updatedAt: r.updatedAt }));
}

export async function addEntry(session: Session, kind: PrivateKind, data: Record<string, unknown>) {
  if (!kindAllowed(session, kind)) throw new Error("Dafür reicht der Privat-Zugang nicht.");
  const [row] = await db.insert(E).values({ tenantId: session.tenantId, userId: session.userId, kind, data }).returning({ id: E.id });
  return row.id;
}

async function ownEntry(session: Session, id: string, kind: PrivateKind) {
  if (!kindAllowed(session, kind)) return null;
  const [row] = await db.select().from(E).where(and(eq(E.id, id), eq(E.tenantId, session.tenantId), eq(E.kind, kind)));
  if (!row) return null;
  if (OWN_KINDS.has(kind) && row.userId !== session.userId) return null;
  return row;
}

export async function updateEntry(session: Session, id: string, kind: PrivateKind, patch: Record<string, unknown>, replace = false) {
  const row = await ownEntry(session, id, kind);
  if (!row) return false;
  const data = replace ? patch : { ...(row.data as Record<string, unknown>), ...patch };
  await db.update(E).set({ data, updatedAt: new Date() }).where(eq(E.id, row.id));
  return true;
}

export async function deleteEntry(session: Session, id: string, kind: PrivateKind) {
  const row = await ownEntry(session, id, kind);
  if (!row) return false;
  await db.delete(E).where(eq(E.id, row.id));
  return true;
}

// ---- PIN ---------------------------------------------------------------------------------------------

const pinTries = new Map<string, { count: number; until: number }>();
export const PIN_RE = /^\d{4,8}$/;

async function pinHash(session: Session) {
  const [m] = await db
    .select({ hash: schema.memberships.privatePinHash })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, session.userId)));
  return m?.hash ?? null;
}

/** PIN prüfen und „Privat“ für diese Sitzung öffnen. Nach 5 Fehlversuchen 5 Minuten Pause. */
export async function unlockPrivate(session: Session, pin: string): Promise<string | null> {
  const t = pinTries.get(session.userId);
  if (t && t.count >= 5 && t.until > Date.now()) return "Zu viele Versuche – bitte in ein paar Minuten nochmal.";
  const hash = await pinHash(session);
  if (!hash) return null;
  if (!(await bcrypt.compare(pin, hash))) {
    pinTries.set(session.userId, { count: (t?.count ?? 0) + 1, until: Date.now() + 5 * 60_000 });
    return "PIN stimmt nicht.";
  }
  pinTries.delete(session.userId);
  await db.update(schema.sessions).set({ privateUnlockedUntil: new Date(Date.now() + UNLOCK_MINUTES * 60_000) }).where(eq(schema.sessions.id, session.sessionId));
  return null;
}

export async function lockPrivate(session: Session) {
  await db.update(schema.sessions).set({ privateUnlockedUntil: null }).where(eq(schema.sessions.id, session.sessionId));
}

/** PIN setzen, ändern oder entfernen (leer). Mit bestehender PIN muss die alte stimmen. */
export async function setPin(session: Session, current: string, next: string): Promise<string | null> {
  const hash = await pinHash(session);
  if (hash && !(await bcrypt.compare(current, hash))) return "Die bisherige PIN stimmt nicht.";
  if (next && !PIN_RE.test(next)) return "PIN: 4 bis 8 Ziffern.";
  await db
    .update(schema.memberships)
    .set({ privatePinHash: next ? await bcrypt.hash(next, 10) : null })
    .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, session.userId)));
  if (next) await db.update(schema.sessions).set({ privateUnlockedUntil: new Date(Date.now() + UNLOCK_MINUTES * 60_000) }).where(eq(schema.sessions.id, session.sessionId));
  return null;
}

/** Uhrzeit jetzt (deutsche Zeit) als HH:MM. */
export function nowTime(d = new Date()): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Eigener Medikamentenplan (oder Standard) mit Eintrags-ID. */
export async function myMedPlan(session: Session) {
  const [row] = (await loadEntries<MedPlan>(session, ["medplan"])).filter((e) => e.userId === session.userId);
  return { id: row?.id ?? null, plan: { ...DEFAULT_MED_PLAN, ...(row?.data ?? {}) } as MedPlan };
}

/** Alle eigenen Privat-Einträge löschen (die gemeinsamen Einstellungen bleiben). */
export async function deleteAllPrivate(session: Session) {
  const rows = await db.delete(E).where(and(eq(E.tenantId, session.tenantId), eq(E.userId, session.userId), ne(E.kind, "einstellungen"))).returning({ id: E.id });
  return rows.length;
}
