import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { betrifftAufloesen, istBetrifft, nurAndere, type Betrifft, type BetrifftQuelle } from "./betrifft-logic";
import { myPartner, privateSettings } from "./service";

// Familienkalender: wen ein Termin betrifft (gesetzt je Termin-UID, sonst am Vornamen im Titel erkannt).
// Mandantengetrennt; der Kalender selbst wird nie geändert.

const B = schema.kalenderBetrifft;

export type BetrifftKarte = {
  /** Zuordnung eines Termins. */
  von: (ev: { uid: string; title: string }) => { wert: Betrifft; quelle: BetrifftQuelle };
  /** Betrifft der Termin nur die andere Person (nicht die angemeldete)? Dann blockt er deren Tag nicht. */
  nurAndere: (ev: { uid: string; title: string }) => boolean;
  partner: { a: string; b: string };
  ich: "a" | "b" | null;
};

/** Zuordnungen für die angegebenen Termin-UIDs laden (oder alle der Firma, wenn keine angegeben). */
export async function betrifftKarte(tenantId: string, opts: { uids?: string[]; userId?: string | null } = {}): Promise<BetrifftKarte> {
  const settings = await privateSettings(tenantId);
  const uids = opts.uids ? [...new Set(opts.uids)] : null;
  const rows = uids && !uids.length ? [] : await db.select({ uid: B.uid, betrifft: B.betrifft }).from(B).where(and(eq(B.tenantId, tenantId), uids ? inArray(B.uid, uids) : undefined));
  const gesetzt = new Map(rows.map((r) => [r.uid, r.betrifft as Betrifft]));
  const partner = settings.partners;
  const ich = opts.userId ? myPartner(settings, { userId: opts.userId }) : null;
  const von = (ev: { uid: string; title: string }) => betrifftAufloesen(gesetzt.get(ev.uid), ev.title, partner);
  return { von, nurAndere: (ev) => nurAndere(von(ev).wert, ich), partner, ich };
}

/**
 * Zuordnung setzen (nur Familienkalender-Termine dieser Firma). „automatisch“ löscht die Zuordnung wieder
 * (dann zählt der Vorname im Titel). Gilt für alle Termine mit derselben UID (ganze Serie).
 */
export async function betrifftSetzen(session: Session, eventId: string, wert: Betrifft | "automatisch"): Promise<{ titel: string } | null> {
  if (!session.privateAccess || !/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const E = schema.calendarEvents;
  const [ev] = await db.select({ uid: E.uid, title: E.title }).from(E).where(and(eq(E.tenantId, session.tenantId), eq(E.id, eventId)));
  if (!ev) return null;
  const { familyEventPrefill } = await import("./calendar-data");
  if (!(await familyEventPrefill(session, eventId))) return null; // kein Familienkalender (z. B. geschäftlich)
  const titel = ev.title.trim().slice(0, 80);
  if (wert === "automatisch") {
    await db.delete(B).where(and(eq(B.tenantId, session.tenantId), eq(B.uid, ev.uid)));
    return { titel };
  }
  if (!istBetrifft(wert)) return null;
  await db
    .insert(B)
    .values({ tenantId: session.tenantId, uid: ev.uid, betrifft: wert, gesetztVon: session.userId })
    .onConflictDoUpdate({ target: [B.tenantId, B.uid], set: { betrifft: wert, gesetztVon: session.userId, updatedAt: new Date() } });
  return { titel };
}
