import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { linkAllowed } from "@/lib/auth/areas";
import { calendarVisible, isBusinessCalendar } from "@/lib/calendar/visibility";
import { DEFAULT_CALENDAR_NAME } from "@/lib/calendar/sync";
import { getIntegration } from "@/lib/integrations/store";
import { privateCalendar } from "@/lib/private/calendar-data";
import { myPartner, privateSettings } from "@/lib/private/service";
import { getSettings } from "@/lib/settings";
import { bindingTask } from "@/lib/today/service";
import { bloeckeAm } from "@/lib/zeit/bloecke";
import { ladeBloecke } from "@/lib/zeit/service";
import { aufgabenTyp, lerneAufwand, plusTage, planeTage, schaetzeAufwand, type Arbeitszeit, type PlanAufgabe, type Sperre, type TagPlan, type Verschoben } from "./logic";

// Tagesplan: offene Aufgaben (eigene, ohne Zuständigen beim Inhaber) in die Arbeitszeit legen. Belegt sind Termine
// aus verbundenen Kalendern, private Einträge (Kinderzeit, Auszeit, Ausschlafen, Paarzeit, private Termine),
// freie Zeiten und reservierte Stunden. Private Sperrzeiten zeigen ohne `mitPrivat` nur „Privat belegt“.

const T = schema.tasks;
const E = schema.calendarEvents;
export const PRIVAT_BELEGT = "Privat belegt";

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/** Private Arten, die Arbeitszeit belegen (Nähe, Periode u. Ä. nicht). */
const BLOCKIERT = new Set(["termin", "kinder", "auszeit", "ausschlafen", "paarzeit"]);

export type WartetAuf = { person: string; aufgaben: { id: string; titel: string; faellig: string | null; ueberfaellig: boolean; link: string | null }[] };

export type Tagesplan = {
  start: string;
  tage: TagPlan[];
  verschoben: Verschoben[];
  ohneFrist: PlanAufgabe[];
  wartetAuf: WartetAuf[];
  privatDetails: boolean;
  arbeitszeit: Arbeitszeit;
  hinweise: string[];
};

/** Arbeitszeit dieser Person (eigene Einstellung, sonst die allgemeine). */
export function arbeitszeitFuer(s: { arbeitszeit: Arbeitszeit; personen: Record<string, Arbeitszeit> }, userId: string): Arbeitszeit {
  return { ...s.arbeitszeit, ...(s.personen[userId] ?? {}) };
}

/** Darf diese Sitzung private Details sehen? Nur mit Privat-Zugang, vollem Umfang und (bei PIN) entsperrt. */
export function privatDetailsErlaubt(session: Session, now = Date.now()): boolean {
  if (!session.privateAccess || session.privateScope !== "voll") return false;
  return !session.privatePin || (session.privateUnlockedUntil?.getTime() ?? 0) > now;
}

async function namen(tenantId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, tenantId));
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

/** Sperrzeiten je Tag für diese Person. */
async function sperrenLaden(session: Session, von: string, bis: string, heute: string, mitPrivat: boolean): Promise<Map<string, Sperre[]>> {
  const t = session.tenantId;
  const out = new Map<string, Sperre[]>();
  const add = (tag: string, s: Sperre) => out.set(tag, [...(out.get(tag) ?? []), s]);
  const [tenant] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, t));
  const staffCalendars = tenant?.settings.calendar?.staffCalendars;
  const pushName = (await getIntegration(t, "apple_calendar"))?.calendarName || DEFAULT_CALENDAR_NAME;
  const privat = session.privateAccess ? await privateSettings(t) : null;
  const fahrzeit = Math.max(0, (await getSettings(t)).mobil.fahrzeitMin);
  const minuten = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const exportName = privat?.externSync.enabled ? privat.externSync.calendar : null;

  // 1) Verbundene Kalender (ohne den eigenen Push-Kalender – dort stehen die Aufgaben selbst – und ohne den Export der Privat-Einträge).
  const events = await db
    .select()
    .from(E)
    .where(and(eq(E.tenantId, t), eq(E.allDay, false), lte(E.day, bis), or(gte(E.day, von), gte(E.endsAt, new Date(`${von}T00:00:00Z`)))))
    .orderBy(asc(E.startsAt));
  for (const ev of events) {
    const name = ev.calendarName.trim().toLowerCase();
    if (name === pushName.trim().toLowerCase() || (exportName && name === exportName.trim().toLowerCase())) continue;
    if (!calendarVisible(session, ev.calendarName, staffCalendars)) continue;
    const geschaeft = isBusinessCalendar(ev.calendarName, staffCalendars, pushName);
    const startTag = berlinDay(ev.startsAt);
    const endeTag = ev.endsAt ? berlinDay(new Date(ev.endsAt.getTime() - 1)) : startTag;
    for (let tag = startTag; tag <= endeTag && tag <= bis; tag = plusTage(tag, 1)) {
      if (tag < von) continue;
      const a = tag === startTag ? berlinTime(ev.startsAt) : "00:00";
      const b = ev.endsAt && tag === endeTag ? berlinTime(ev.endsAt) : ev.endsAt ? "23:59" : berlinTime(new Date(ev.startsAt.getTime() + 3600_000));
      add(tag, geschaeft ? { von: a, bis: b, titel: ev.title, art: "termin" } : { von: a, bis: b, titel: mitPrivat ? ev.title : PRIVAT_BELEGT, art: "privat" });
      // Handy & Tesla (B13): vor geschäftlichen Terminen mit Ort die Fahrzeit blocken – dort passen Anrufe hinein.
      if (geschaeft && ev.location?.trim() && tag === startTag && a !== "00:00") {
        const vonFahrt = hhmmPlus("00:00", Math.max(0, minuten(a) - fahrzeit));
        add(tag, { von: vonFahrt, bis: a, titel: `Fahrzeit → ${ev.title} (Anrufe möglich)`, art: "termin" });
      }
    }
  }

  // 2) Privatbereich: nur Einträge, die diese Person betreffen (ohne Zuordnung: alle).
  if (privat) {
    const ich = myPartner(privat, session);
    const pc = await privateCalendar(session, von, bis, heute);
    for (const x of pc.items) {
      if (!BLOCKIERT.has(x.kind) || x.status === "ausgefallen") continue;
      if (ich && x.people.length && !x.people.includes(ich)) continue;
      const titel = mitPrivat ? x.title : PRIVAT_BELEGT;
      const ende = x.endDay ?? x.day;
      for (let tag = x.day; tag <= ende && tag <= bis; tag = plusTage(tag, 1)) {
        if (tag < von) continue;
        if (x.from) add(tag, { von: x.from, bis: x.to ?? hhmmPlus(x.from, 60), titel, art: "privat" });
        else if (x.kind === "ausschlafen") add(tag, { von: "00:00", bis: "10:00", titel, art: "privat" });
        // Kinderzeit, Auszeit, Paarzeit ohne Uhrzeit: ganzer Tag; private Termine ohne Uhrzeit belegen nichts.
        else if (x.kind !== "termin") add(tag, { von: "00:00", bis: "23:59", titel, art: "privat", ganztags: true });
      }
    }
  }

  // 3) Freie Zeiten und reservierte Stunden (für alle oder diese Person).
  const bloecke = (await ladeBloecke(t)).filter((b) => b.userId === null || b.userId === session.userId);
  for (let tag = von; tag <= bis; tag = plusTage(tag, 1)) {
    for (const b of bloeckeAm(bloecke, tag)) {
      if (b.art === "frei") add(tag, b.ganztags ? { von: "00:00", bis: "23:59", titel: b.titel, art: "frei", ganztags: true } : { von: b.vonZeit ?? "00:00", bis: b.bisZeit ?? "23:59", titel: b.titel, art: "frei" });
      else if (b.stunden) add(tag, { von: "00:00", bis: hhmmPlus("00:00", Math.round(b.stunden * 60)), titel: `${b.titel} (${String(b.stunden).replace(".", ",")} Std. reserviert)`, art: "reserviert" });
    }
  }
  return out;
}

const hhmmPlus = (hhmm: string, minuten: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const n = Math.min(23 * 60 + 59, h * 60 + (m || 0) + minuten);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

/**
 * Tagesplan ab `start` für `tage` Tage. Eigene Aufgaben = mir zugewiesen bzw. (beim Inhaber) ohne Zuständigen;
 * Aufgaben anderer Personen erscheinen als „wartet auf …“.
 */
export async function tagesplan(session: Session, o: { start: string; tage?: number; mitPrivat?: boolean; heute: string }): Promise<Tagesplan> {
  const t = session.tenantId;
  const tage = Math.min(Math.max(o.tage ?? 1, 1), 14);
  // Private Details nur, wenn der Aufrufer es erlaubt (Seite: entsperrter Privatbereich; Claude: Privat-Freigabe).
  const mitPrivat = !!o.mitPrivat && session.privateAccess;
  const s = await getSettings(t);
  const az = arbeitszeitFuer(s.tagesplan, session.userId);
  const ende = plusTage(o.start, tage - 1);
  const hinweise: string[] = [];

  const offen = await db
    .select({ id: T.id, title: T.title, systemKey: T.systemKey, dueDate: T.dueDate, priority: T.priority, aufwand: T.aufwand, link: T.link, assigneeId: T.assigneeId, zustaendigExtern: T.zustaendigExtern, createdBy: T.createdBy })
    .from(T)
    .where(and(eq(T.tenantId, t), eq(T.status, "open"), bindingTask))
    .orderBy(asc(T.dueDate))
    .limit(800);
  const restricted = session.role === "staff" && session.areas !== null;
  const sichtbar = offen.filter((x) => !restricted || (x.link ? linkAllowed(session, x.link) : x.createdBy === session.userId || x.assigneeId === session.userId));
  const meine = sichtbar.filter((x) => (x.assigneeId === session.userId && !x.zustaendigExtern) || (session.role === "owner" && !x.assigneeId && !x.zustaendigExtern));
  const sperren = await sperrenLaden(session, o.start, ende, o.heute, mitPrivat);
  // Heute: Überfälliges zählt als heute fällig. Blick in die Zukunft: was vorher fällig ist, wird vorher erledigt.
  const imPlan = meine.filter((x) => !x.dueDate || o.start <= o.heute || x.dueDate >= o.start);
  const gelernt = await gelernterAufwand(t);
  const ergebnis = planeTage({
    start: o.start,
    tage,
    aufgaben: imPlan.map((x) => {
      const g = x.aufwand ? null : (gelernt.get(aufgabenTyp(x)) ?? null);
      return { id: x.id, titel: x.title, faellig: x.dueDate && x.dueDate < o.start ? o.start : x.dueDate, prioritaet: x.priority, aufwand: x.aufwand ?? g ?? schaetzeAufwand(x.title), geschaetzt: !x.aufwand, gelernt: Boolean(g), link: x.link };
    }),
    arbeitszeit: az,
    sperrenAm: (tag) => sperren.get(tag) ?? [],
    vorziehen: s.tagesplan.vorziehen,
  });
  const ueberfaellig = o.start <= o.heute ? meine.filter((x) => x.dueDate && x.dueDate < o.start).length : 0;
  if (ueberfaellig) hinweise.push(`${ueberfaellig} überfällige Aufgabe${ueberfaellig === 1 ? "" : "n"} zählt als heute fällig.`);

  // Wartet auf …: Aufgaben, die andere erledigen (nur für den Inhaber sichtbar).
  const wartetAuf: WartetAuf[] = [];
  if (session.role === "owner") {
    const n = await namen(t);
    const gruppen = new Map<string, WartetAuf["aufgaben"]>();
    for (const x of sichtbar) {
      const person = x.zustaendigExtern || (x.assigneeId && x.assigneeId !== session.userId ? n.get(x.assigneeId) ?? "andere Person" : null);
      if (!person) continue;
      gruppen.set(person, [...(gruppen.get(person) ?? []), { id: x.id, titel: x.title, faellig: x.dueDate, ueberfaellig: !!x.dueDate && x.dueDate < o.heute, link: x.link }]);
    }
    for (const [person, aufgaben] of [...gruppen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) wartetAuf.push({ person, aufgaben });
  }
  return { start: o.start, tage: ergebnis.tage, verschoben: ergebnis.verschoben, ohneFrist: ergebnis.ohneFrist, wartetAuf, privatDetails: mitPrivat, arbeitszeit: az, hinweise };
}

/** Aufgabe auf ein Datum verschieben (eigene oder sichtbare Aufgaben). */
export async function aufgabeVerschieben(session: Session, id: string, datum: string): Promise<{ titel: string; vorher: string | null } | null> {
  const [x] = await db.select({ title: T.title, dueDate: T.dueDate, link: T.link, createdBy: T.createdBy, assigneeId: T.assigneeId }).from(T).where(and(eq(T.tenantId, session.tenantId), eq(T.id, id)));
  if (!x) return null;
  const restricted = session.role === "staff" && session.areas !== null;
  if (restricted && !(x.link ? linkAllowed(session, x.link) : x.createdBy === session.userId || x.assigneeId === session.userId)) return null;
  await db.update(T).set({ dueDate: datum }).where(and(eq(T.tenantId, session.tenantId), eq(T.id, id)));
  return { titel: x.title, vorher: x.dueDate };
}

/** Aufwand je Aufgabenart aus den letzten 180 Tagen: von Hand eingetragen oder gemessen (angefangen → erledigt). */
export async function gelernterAufwand(tenantId: string) {
  const rows = await db
    .select({ title: T.title, systemKey: T.systemKey, aufwand: T.aufwand, begonnenAm: T.begonnenAm, completedAt: T.completedAt })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), gte(T.createdAt, new Date(Date.now() - 180 * 86_400_000)), or(isNotNull(T.aufwand), and(isNotNull(T.begonnenAm), isNotNull(T.completedAt)))))
    .limit(5000);
  return lerneAufwand(rows.map((r) => ({ typ: aufgabenTyp(r), manuell: r.aufwand, dauerMin: r.begonnenAm && r.completedAt ? Math.round((r.completedAt.getTime() - r.begonnenAm.getTime()) / 60_000) : null })));
}

/** Aufwand einer Aufgabe setzen (S/M/L) oder zurück auf „geschätzt“. */
export async function aufwandSetzen(tenantId: string, ids: string[], aufwand: "S" | "M" | "L" | null): Promise<void> {
  if (!ids.length) return;
  await db.update(T).set({ aufwand }).where(and(eq(T.tenantId, tenantId), inArray(T.id, ids)));
}
