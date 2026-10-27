import "server-only";
import { and, eq, gte, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { isBusinessCalendar } from "@/lib/calendar/visibility";
import { calendarPalette } from "@/lib/calendar/palette";
import { DEFAULT_CALENDAR_NAME } from "@/lib/calendar/sync";
import { getIntegration } from "@/lib/integrations/store";
import { addDays, type AppointmentEntry, type DateEntry, type IntimEntry, type KidsEntry, type SleepEntry } from "./logic";
import { buildCalendarItems, touchRhythm, type ExternEvent, type PeriodEntry, type RitualEntry, type TouchEntry } from "./kalender";
import { loadEntries, privateSettings } from "./service";

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/** Termine aus den verbundenen privaten/Familien-Kalendern (nicht die geschäftlichen) im Zeitraum. */
async function familyEvents(tenantId: string, from: string, to: string, exportCalendar: string | null): Promise<ExternEvent[]> {
  const E = schema.calendarEvents;
  const [cfg, tenant, rows] = await Promise.all([
    getIntegration(tenantId, "apple_calendar"),
    db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, tenantId), lte(E.day, to), or(gte(E.day, from), gte(E.endsAt, new Date(`${from}T00:00:00Z`)))))
      .orderBy(E.allDay, E.startsAt),
  ]);
  const staff = tenant[0]?.settings.calendar?.staffCalendars;
  const push = cfg?.calendarName || DEFAULT_CALENDAR_NAME;
  const own = rows.filter((ev) => !isBusinessCalendar(ev.calendarName, staff, push) && !(exportCalendar && ev.calendarName.trim().toLowerCase() === exportCalendar.trim().toLowerCase()));
  // Gleiche Farbe und gleiches Kürzel wie im Geschäftskalender (deutlich verschieden von Privat-Arten und anderen Kalendern).
  const { colors, abbr } = await calendarPalette(tenantId);
  return own
    .map((ev) => {
      // Ende inklusiv: ganztägig endet iCalendar am Folgetag 00:00, mit Uhrzeit zählt der Tag des Endes.
      const endDay = ev.endsAt ? (ev.allDay ? addDays(ev.endsAt.toISOString().slice(0, 10), -1) : berlinDay(new Date(ev.endsAt.getTime() - 1))) : null;
      return { id: ev.id, title: ev.title, day: ev.day, endDay, time: ev.allDay ? null : berlinTime(ev.startsAt), calendar: ev.calendarName, color: colors.get(ev.calendarName) ?? ev.color, abbr: abbr.get(ev.calendarName) };
    });
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
