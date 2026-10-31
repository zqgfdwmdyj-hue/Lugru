import "server-only";
import { and, eq, gte, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { isBusinessCalendar } from "@/lib/calendar/visibility";
import { calendarPalette } from "@/lib/calendar/palette";
import { DEFAULT_CALENDAR_NAME } from "@/lib/calendar/sync";
import { getIntegration } from "@/lib/integrations/store";
import { addDays, type AppointmentEntry, type DateEntry, type IntimEntry, type KidsEntry, type SleepEntry } from "./logic";
import { buildCalendarItems, eventRef, touchRhythm, type ExternEvent, type PeriodEntry, type RitualEntry, type TouchEntry } from "./kalender";
import { loadEntries, privateSettings } from "./service";

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

type EventRow = typeof schema.calendarEvents.$inferSelect;

/** Nur private/Familien-Kalender: keine geschäftlichen und nicht der eigene Export-Kalender. */
async function familyFilter(tenantId: string, exportCalendar: string | null) {
  const [cfg, tenant] = await Promise.all([getIntegration(tenantId, "apple_calendar"), db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId))]);
  const staff = tenant[0]?.settings.calendar?.staffCalendars;
  const push = cfg?.calendarName || DEFAULT_CALENDAR_NAME;
  return (ev: Pick<EventRow, "calendarName">) => !isBusinessCalendar(ev.calendarName, staff, push) && !(exportCalendar && ev.calendarName.trim().toLowerCase() === exportCalendar.trim().toLowerCase());
}

/** Termine aus den verbundenen privaten/Familien-Kalendern (nicht die geschäftlichen) im Zeitraum. */
async function familyEvents(tenantId: string, from: string, to: string, exportCalendar: string | null): Promise<ExternEvent[]> {
  const E = schema.calendarEvents;
  const [isFamily, rows] = await Promise.all([
    familyFilter(tenantId, exportCalendar),
    db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, tenantId), lte(E.day, to), or(gte(E.day, from), gte(E.endsAt, new Date(`${from}T00:00:00Z`)))))
      .orderBy(E.allDay, E.startsAt),
  ]);
  const own = rows.filter(isFamily);
  // Gleiche Farbe und gleiches Kürzel wie im Geschäftskalender (deutlich verschieden von Privat-Arten und anderen Kalendern).
  const { colors, abbr } = await calendarPalette(tenantId);
  return own
    .map((ev) => {
      // Ende inklusiv: ganztägig endet iCalendar am Folgetag 00:00, mit Uhrzeit zählt der Tag des Endes.
      const endDay = ev.endsAt ? (ev.allDay ? addDays(ev.endsAt.toISOString().slice(0, 10), -1) : berlinDay(new Date(ev.endsAt.getTime() - 1))) : null;
      return { id: ev.id, ref: eventRef(ev.uid, ev.startsAt), title: ev.title, day: ev.day, endDay, time: ev.allDay ? null : berlinTime(ev.startsAt), calendar: ev.calendarName, color: colors.get(ev.calendarName) ?? ev.color, abbr: abbr.get(ev.calendarName) };
    });
}

/** Familienkalender-Termine mit Beginn und Ende (Uhrzeit Berlin) – für die Haushaltshilfe (Babysitter, Putzhilfe). */
export async function familyEventTimes(tenantId: string, from: string, to: string): Promise<{ ref: string; title: string; day: string; from: string | null; to: string | null; calendar: string }[]> {
  const E = schema.calendarEvents;
  const settings = await privateSettings(tenantId);
  const [isFamily, rows] = await Promise.all([
    familyFilter(tenantId, settings.externSync.enabled ? settings.externSync.calendar : null),
    db.select().from(E).where(and(eq(E.tenantId, tenantId), gte(E.day, from), lte(E.day, to))).orderBy(E.day, E.startsAt),
  ]);
  return rows.filter(isFamily).map((ev) => {
    const von = ev.allDay ? null : berlinTime(ev.startsAt);
    // Ende nur am selben Tag oder über Nacht bis zum nächsten Morgen.
    const bis = !ev.allDay && ev.endsAt && ev.endsAt > ev.startsAt && (berlinDay(ev.endsAt) === ev.day || ev.endsAt.getTime() - ev.startsAt.getTime() < 18 * 3600_000) ? berlinTime(ev.endsAt) : null;
    return { ref: eventRef(ev.uid, ev.startsAt), title: ev.title, day: ev.day, from: von, to: bis && bis !== von ? bis : null, calendar: ev.calendarName };
  });
}

/** Vorbelegung zum Übernehmen eines Familienkalender-Termins (Paarzeit, Kinderzeit …). */
export type EventPrefill = { ref: string; calendar: string; title: string; day: string; from?: string; to?: string; allDay: boolean };

/**
 * Ein Termin aus einem Familienkalender (nie ein geschäftlicher) für „Eintragen“: Tag, Uhrzeit und Titel.
 * Das Ende wird nur übernommen, wenn es am selben Tag liegt oder kurz nach Mitternacht (über Nacht).
 */
export async function familyEventPrefill(session: Session, id: string): Promise<EventPrefill | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const E = schema.calendarEvents;
  const settings = await privateSettings(session.tenantId);
  const [[ev], isFamily] = await Promise.all([
    db.select().from(E).where(and(eq(E.tenantId, session.tenantId), eq(E.id, id))),
    familyFilter(session.tenantId, settings.externSync.enabled ? settings.externSync.calendar : null),
  ]);
  if (!ev || !isFamily(ev)) return null;
  const base = { ref: eventRef(ev.uid, ev.startsAt), calendar: ev.calendarName, title: ev.title.trim().slice(0, 200), day: ev.day, allDay: ev.allDay };
  if (ev.allDay) return base;
  const from = berlinTime(ev.startsAt);
  let to: string | undefined;
  if (ev.endsAt && ev.endsAt > ev.startsAt) {
    const endDay = berlinDay(ev.endsAt);
    const end = berlinTime(ev.endsAt);
    if (endDay === ev.day || (endDay === addDays(ev.day, 1) && end < from)) to = end;
  }
  return { ...base, from, ...(to && to !== from ? { to } : {}) };
}

/** Alles für den Privatkalender im Zeitraum – aus den vorhandenen Einträgen, ohne Doppelerfassung. */
export async function privateCalendar(session: Session, from: string, to: string, today: string) {
  const settings = await privateSettings(session.tenantId);
  const [termine, kinder, auszeit, ausschlafen, paarzeit, naehe, touches, rituals, periods, extern] = await Promise.all([
    loadEntries<AppointmentEntry>(session, ["termin"]),
    loadEntries<KidsEntry>(session, ["kinder"]),
    loadEntries<SleepEntry>(session, ["auszeit"]),
    loadEntries<SleepEntry>(session, ["ausschlafen"]),
    loadEntries<DateEntry>(session, ["paarzeit"]),
    loadEntries<IntimEntry>(session, ["intim"]),
    loadEntries<TouchEntry>(session, ["zuwendung"]),
    loadEntries<RitualEntry>(session, ["ritual"]),
    loadEntries<PeriodEntry>(session, ["periode"]),
    familyEvents(session.tenantId, from, to, settings.externSync.enabled ? settings.externSync.calendar : null),
  ]);
  const items = buildCalendarItems(
    { names: settings.partners, today, therapists: settings.therapists, termine, kinder, auszeit, ausschlafen, paarzeit, naehe, touches, rituals, periods, extern },
    from,
    to,
  );
  const active = rituals.filter((r) => r.data.active && r.data.from <= today && (!r.data.until || r.data.until >= today)).sort((a, b) => b.data.from.localeCompare(a.data.from))[0] ?? null;
  const rhythm = active ? touchRhythm(touches.map((t) => t.data), active.data) : null;
  const externCalendars = [...new Map(extern.map((e) => [e.calendar, { name: e.calendar, color: e.color ?? "#6e6e73", abbr: e.abbr ?? "" }])).values()];
  return { settings, items, ritual: active, rituals, rhythm, periods, externCount: extern.length, externCalendars };
}
