import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { CalDavClient, type Calendar } from "./caldav";
import { buildEvent, parseEvents } from "./ics";
import { collectDesired } from "./items";
import { hashDesired, planCalendarChanges, planPush, uidFor, type DesiredItem, type RemoteItem, type StoredItem } from "./plan";

export const DEFAULT_CALENDAR_NAME = "Seller-System";
const berlinDay = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(iso));

export async function calendarClient(tenantId: string) {
  const cfg = await getIntegration(tenantId, "apple_calendar");
  if (!cfg?.appleId || !cfg.appPassword) return null;
  return {
    client: new CalDavClient({ server: cfg.server || "https://caldav.icloud.com", username: cfg.appleId, password: cfg.appPassword }),
    calendarName: cfg.calendarName || DEFAULT_CALENDAR_NAME,
    readOnly: (cfg.readCalendars ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

async function saveState(tenantId: string, state: Record<string, unknown>) {
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('calendar', coalesce(${schema.tenants.settings}->'calendar', '{}'::jsonb) || ${JSON.stringify(state)}::jsonb)` })
    .where(eq(schema.tenants.id, tenantId));
}

export type SyncResult = { created: number; updated: number; removed: number; fromCalendar: number; appointments: number };

const running = new Map<string, Promise<SyncResult | null>>();
const again = new Set<string>();

/**
 * Gleicht den Kalender ab. Läuft je Firma nie doppelt: Kommt ein Aufruf, während einer läuft,
 * folgt genau ein weiterer Durchgang danach. Wirft bei Verbindungsfehlern (im Zustand vermerkt).
 */
export async function syncCalendar(tenantId: string): Promise<SyncResult | null> {
  const cur = running.get(tenantId);
  if (cur) {
    again.add(tenantId);
    return cur;
  }
  const p = syncOnce(tenantId).finally(() => {
    running.delete(tenantId);
    if (again.delete(tenantId)) void syncCalendar(tenantId).catch(() => {});
  });
  running.set(tenantId, p);
  return p;
}

async function syncOnce(tenantId: string): Promise<SyncResult | null> {
  const c = await calendarClient(tenantId);
  if (!c) return null;
  try {
    const r = await runSync(tenantId, c);
    await saveState(tenantId, { lastSync: new Date().toISOString(), lastError: null });
    return r;
  } catch (e) {
    await saveState(tenantId, { lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function runSync(tenantId: string, c: NonNullable<Awaited<ReturnType<typeof calendarClient>>>): Promise<SyncResult> {
  const { client } = c;
  const [tenant] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const state = tenant?.settings.calendar ?? {};

  // 1. Kalender finden oder anlegen.
  const { home, calendars } = await client.listCalendars();
  const eventCalendars = calendars.filter((k) => k.components.length === 0 || k.components.includes("VEVENT"));
  let sys: Calendar | undefined = eventCalendars.find((k) => k.href === state.href) ?? eventCalendars.find((k) => k.name === c.calendarName);
  const sysHref = sys?.href ?? (await client.createCalendar(home, c.calendarName));
  await saveState(tenantId, { href: sysHref, calendars: eventCalendars.map((k) => k.name) });

  // 2. Änderungen aus dem Kalender übernehmen.
  const I = schema.calendarItems;
  const loadStored = async (): Promise<StoredItem[]> =>
    (await db.select().from(I).where(eq(I.tenantId, tenantId))).map((s) => ({ id: s.id, sourceKey: s.sourceKey, uid: s.uid, href: s.href, etag: s.etag, hash: s.hash, date: s.date, title: s.title, taskId: s.taskId }));
  const remoteRaw = await client.events(sysHref);
  const remote: RemoteItem[] = [];
  for (const r of remoteRaw) {
    const ev = parseEvents(r.ics).find((e) => !e.recurrenceId);
    if (!ev) continue;
    remote.push({ uid: ev.uid, href: r.href, etag: r.etag, date: ev.allDay ? ev.start : berlinDay(ev.start), title: ev.title, description: ev.description });
  }
  const remoteByUid = new Map(remote.map((r) => [r.uid, r]));
  const changes = planCalendarChanges(await loadStored(), remote);
  const T = schema.tasks;
  for (const s of changes.deleted) {
    if (s.taskId) {
      await db
        .update(T)
        .set({ status: "done", completedAt: new Date(), notes: sql`coalesce(${T.notes} || E'\\n', '') || 'Im Kalender gelöscht – als erledigt markiert.'` })
        .where(and(eq(T.id, s.taskId), eq(T.tenantId, tenantId), eq(T.status, "open")));
    }
    await db.delete(I).where(eq(I.id, s.id));
  }
  for (const m of changes.moved) {
    await db.update(T).set({ dueDate: m.date, title: m.title }).where(and(eq(T.id, m.item.taskId!), eq(T.tenantId, tenantId)));
  }
  for (const s of changes.reset) {
    // Verschobene Sammeltermine (Versand, Ansprüche …) beim Schreiben zurücksetzen.
    await db.update(I).set({ hash: "" }).where(eq(I.id, s.id));
  }
  for (const r of changes.created) {
    const [task] = await db
      .insert(T)
      .values({ tenantId, title: r.title, dueDate: r.date, category: "eigene", notes: [r.description, "Im Kalender angelegt."].filter(Boolean).join("\n\n") })
      .returning({ id: T.id });
    const key = `task:${task.id}`;
    // Den Termin übernehmen statt neu anzulegen – der Hash passt noch nicht, deshalb wird er einmal in unserem Format geschrieben.
    await db.insert(I).values({ tenantId, sourceKey: key, uid: r.uid, href: r.href, etag: r.etag, hash: "", date: r.date, title: r.title, taskId: task.id });
  }

  // 3. Fälligkeiten des Systems schreiben.
  const desired = await collectDesired(tenantId);
  const plan = planPush(await loadStored(), desired);
  const now = new Date();
  const ics = (d: DesiredItem, uid: string) =>
    buildEvent({ uid, title: d.title, date: d.date, description: d.description, url: absoluteLink(d.link), category: d.category, alarmAtMinute: d.remind ? 9 * 60 : undefined }, now);
  let created = 0;
  let updated = 0;
  let removed = 0;
  for (const d of plan.create) {
    const uid = uidFor(tenantId, d.key);
    const href = new URL(`${uid.split("@")[0]}.ics`, sysHref).toString();
    const existing = remoteByUid.get(uid);
    const etag = await client.put(href, ics(d, uid), existing?.etag ?? null);
    await db
      .insert(I)
      .values({ tenantId, sourceKey: d.key, uid, href: existing?.href ?? href, etag, hash: hashDesired(d), date: d.date, title: d.title, taskId: d.taskId ?? null })
      .onConflictDoUpdate({ target: [I.tenantId, I.uid], set: { sourceKey: d.key, hash: hashDesired(d), date: d.date, title: d.title, etag, updatedAt: now } });
    created++;
  }
  for (const { item, desired: d } of plan.update) {
    const etag = await client.put(item.href, ics(d, item.uid), remoteByUid.get(item.uid)?.etag ?? item.etag);
    await db.update(I).set({ hash: hashDesired(d), date: d.date, title: d.title, etag, updatedAt: now }).where(eq(I.id, item.id));
    updated++;
  }
  for (const s of plan.remove) {
    await client.remove(s.href);
    await db.delete(I).where(eq(I.id, s.id));
    removed++;
  }

  // 4. Eigene Termine der übrigen Kalender lesen (3 Monate zurück bis 1 Jahr voraus – für die Kalenderansicht).
  const readable = eventCalendars.filter((k) => k.href !== sysHref && (c.readOnly.length === 0 || c.readOnly.includes(k.name.toLowerCase())));
  const today = todayIso();
  const range = { from: new Date(`${addDaysIso(today, -92)}T00:00:00Z`), to: new Date(`${addDaysIso(today, 366)}T00:00:00Z`) };
  const E = schema.calendarEvents;
  const rows: (typeof E.$inferInsert)[] = [];
  for (const k of readable) {
    let evs;
    try {
      evs = await client.events(k.href, range);
    } catch {
      continue; // einzelne Kalender (z. B. abonnierte Feiertage) dürfen fehlschlagen
    }
    for (const r of evs) {
      for (const ev of parseEvents(r.ics)) {
        const starts = ev.allDay ? new Date(`${ev.start}T00:00:00Z`) : new Date(ev.start);
        if (starts > range.to) continue;
        const day = ev.allDay ? ev.start : berlinDay(ev.start);
        // Nicht aufgelöste Serien: nur der erste Termin – besser als nichts.
        if (!ev.allDay && ev.end && new Date(ev.end) < range.from) continue;
        if (ev.allDay && (ev.end ?? addDaysIso(ev.start, 1)) <= addDaysIso(today, -92)) continue;
        rows.push({ tenantId, calendarName: k.name, color: calendarColor(k.color), uid: ev.uid, title: ev.title, startsAt: starts, endsAt: ev.end ? (ev.allDay ? new Date(`${ev.end}T00:00:00Z`) : new Date(ev.end)) : null, allDay: ev.allDay, day, location: ev.location, notes: ev.description?.slice(0, 2000) ?? null });
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(E).where(eq(E.tenantId, tenantId));
    for (let i = 0; i < rows.length; i += 300) await tx.insert(E).values(rows.slice(i, i + 300)).onConflictDoNothing();
  });

  return { created, updated, removed, fromCalendar: changes.created.length + changes.moved.length + changes.deleted.filter((d) => d.taskId).length, appointments: rows.length };
}

/** Apple liefert Farben als #RRGGBBAA – für die Anzeige reicht #RRGGBB. */
export function calendarColor(c: string | null): string | null {
  const m = c?.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  return m ? `#${m[1].toUpperCase()}` : null;
}

function absoluteLink(link: string) {
  const base = process.env.APP_URL || "http://localhost:3000";
  return new URL(link, base).toString();
}
