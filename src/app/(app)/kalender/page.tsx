import Link from "next/link";
import { and, eq, gte, lte, notInArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { linkAllowed } from "@/lib/auth/areas";
import { collectDesired } from "@/lib/calendar/items";
import { monthGrid, monthTitle, parseMonth, shiftMonth, spreadDays, type DayEntry } from "@/lib/calendar/month";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { createTask } from "@/lib/tasks/actions";
import { calendarVisible, isBusinessCalendar, seesAllCalendars } from "@/lib/calendar/visibility";
import { SYSTEM_CATEGORIES, textOn } from "@/lib/calendar/colors";
import { calendarPalette } from "@/lib/calendar/palette";
import { saveStaffCalendarsAction } from "./actions";
import { SyncButton } from "./sync-button";

// Monatsansicht wie in Apple Kalender: eigene Termine (aus den verbundenen Kalendern, in deren Farbe)
// und alles mit Datum aus dem System – Aufgaben, Fristen, Versand, Ansprüche, geplante Zahlungen.

const SYSTEM_COLORS: Record<string, string> = Object.fromEntries(Object.entries(SYSTEM_CATEGORIES).map(([k, v]) => [k, v.color]));
const SYSTEM_LABELS: Record<string, string> = Object.fromEntries(Object.entries(SYSTEM_CATEGORIES).map(([k, v]) => [k, v.label]));
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_IN_CELL = 4;

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

type Scope = "alle" | "geschaeft" | "privat";

export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ monat?: string; tag?: string; sicht?: string }> }) {
  const session = await requireArea("kalender");
  const sp = await searchParams;
  const today = todayIso();
  const month = parseMonth(sp.monat, today);
  const grid = monthGrid(month);
  const from = grid[0];
  const to = grid[grid.length - 1];
  const selected = sp.tag && /^\d{4}-\d{2}-\d{2}$/.test(sp.tag) && sp.tag >= from && sp.tag <= to ? sp.tag : today.startsWith(month) ? today : `${month}-01`;
  // Geschäft = Fälligkeiten des Systems + für Mitarbeiter freigegebene Kalender; Privat = die übrigen verbundenen Kalender.
  const canPrivate = seesAllCalendars(session);
  const scope: Scope = canPrivate && (sp.sicht === "geschaeft" || sp.sicht === "privat") ? sp.sicht : "alle";

  const E = schema.calendarEvents;
  const [cal, tenant, events, desired] = await Promise.all([
    getIntegration(session.tenantId, "apple_calendar"),
    db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, session.tenantId)),
    db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, session.tenantId), lte(E.day, to), or(gte(E.day, from), gte(E.endsAt, new Date(`${from}T00:00:00Z`)))))
      .orderBy(E.allDay, E.startsAt),
    collectDesired(session.tenantId, today, { from, to }),
  ]);
  const connected = Boolean((cal?.appleId && cal.appPassword) || cal?.icsUrls);
  const appleConnected = Boolean(cal?.appleId && cal.appPassword);
  const calState = tenant[0]?.settings.calendar;

  // Einträge je Tag sammeln: ganztägige zuerst, dann nach Uhrzeit, Systemeinträge dahinter.
  const byDay = new Map<string, DayEntry[]>();
  const push = (day: string, e: DayEntry) => {
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  };
  const calendars = new Map<string, string>();
  // Eingeschränkte Mitarbeiter: keine privaten Termine, nur Fälligkeiten aus freigegebenen Bereichen.
  const restricted = session.role === "staff" && session.areas !== null;
  // Ideen und Posts von nicht freigegebenen Marken ausblenden.
  const hiddenIdeas = new Set<string>();
  if (session.role === "staff" && session.brandIds !== null) {
    const allow = session.brandIds.length ? session.brandIds : ["00000000-0000-0000-0000-000000000000"];
    const [ideaRows, postRows] = await Promise.all([
      db.select({ id: schema.ideas.id }).from(schema.ideas).where(and(eq(schema.ideas.tenantId, session.tenantId), notInArray(schema.ideas.brandId, allow))),
      db.select({ id: schema.contentPosts.id }).from(schema.contentPosts).where(and(eq(schema.contentPosts.tenantId, session.tenantId), notInArray(schema.contentPosts.brandId, allow))),
    ]);
    for (const r of ideaRows) hiddenIdeas.add(`idea:${r.id}`);
    for (const r of postRows) hiddenIdeas.add(`post:${r.id}`);
  }
  // Eigene Kalender: Inhaber und Privat-Zugang alle, andere nur die freigegebenen (Familie/Privat nie ungefragt).
  const staffCalendars = calState?.staffCalendars;
  const pushName = cal?.calendarName || "Seller-System";
  const visibleEvents = restricted
    ? []
    : events.filter((ev) => calendarVisible(session, ev.calendarName, staffCalendars) && (scope === "alle" || (scope === "geschaeft") === isBusinessCalendar(ev.calendarName, staffCalendars, pushName)));
  const hiddenCalendars = restricted ? 0 : new Set(events.filter((ev) => !calendarVisible(session, ev.calendarName, staffCalendars)).map((ev) => ev.calendarName)).size;
  const allCalendarNames = [...new Set([...(calState?.read ?? []).map((r) => r.name), ...events.map((e) => e.calendarName)])].sort((a, b) => a.localeCompare(b, "de"));
  // Ähnliche Kalenderfarben (z. B. Familie/Privat beide gelb) bekommen eine deutlich andere Ersatzfarbe, dazu ein Kürzel.
  const { colors: calColors, abbr: calAbbr } = await calendarPalette(session.tenantId);
  for (const ev of visibleEvents) {
    const color = calColors.get(ev.calendarName) ?? "#6E6E73";
    calendars.set(ev.calendarName, color);
    const endDay = ev.endsAt ? (ev.allDay ? ev.endsAt.toISOString().slice(0, 10) : addDaysIso(berlinDay(new Date(ev.endsAt.getTime() - 1)), 1)) : null;
    const days = spreadDays(ev.day, endDay, from, to);
    days.forEach((d, i) =>
      push(d, {
        id: `${ev.id}:${d}`,
        title: ev.title,
        time: !ev.allDay && i === 0 ? berlinTime(ev.startsAt) : null,
        color,
        label: ev.calendarName,
        link: null,
        location: ev.location,
        abbr: calAbbr.get(ev.calendarName),
      }),
    );
  }
  for (const d of scope === "privat" ? [] : desired) {
    if (session.role === "staff" && (restricted || session.brandIds !== null) && !linkAllowed(session, d.link)) continue;
    if (hiddenIdeas.has(d.key)) continue;
    if (d.date < from || d.date > to) continue;
    push(d.date, {
      id: d.key,
      title: d.title,
      time: null,
      color: SYSTEM_COLORS[d.category] ?? "#2563eb",
      label: SYSTEM_LABELS[d.category] ?? d.category,
      icon: SYSTEM_CATEGORIES[d.category]?.icon ?? "☑",
      link: d.link,
      overdue: d.date < today,
    });
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.link ? 1 : 0) - (b.link ? 1 : 0) || (a.time ?? "").localeCompare(b.time ?? ""));

  const href = (m: string, tag?: string, sicht: Scope = scope) => `/kalender?monat=${m}${tag ? `&tag=${tag}` : ""}${sicht !== "alle" ? `&sicht=${sicht}` : ""}`;
  const dayList = byDay.get(selected) ?? [];
  const selectedLabel = new Date(`${selected}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kalender</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {connected && <SyncButton />}
          <Link className="btn" href={href(shiftMonth(month, -1))} aria-label="Voriger Monat">‹</Link>
          <Link className="btn" href={href(today.slice(0, 7), today)}>Heute</Link>
          <Link className="btn" href={href(shiftMonth(month, 1))} aria-label="Nächster Monat">›</Link>
        </div>
      </div>

      {!connected ? (
        <div className="notice notice-info small">
          Hier stehen alle Fälligkeiten des Systems. Verbinde deine Kalender (iCloud, Google, Outlook), dann kommen deine eigenen Termine dazu – und die Fälligkeiten stehen auch auf dem iPhone.{" "}
          {session.role === "owner" && <Link href="/anbindungen?p=apple_calendar#apple_calendar">Kalender verbinden</Link>}
        </div>
      ) : calState?.lastError ? (
        <div className="notice notice-warn small">Beim letzten Abgleich gab es ein Problem: {calState.lastError}</div>
      ) : calState?.read && calState.read.every((r) => r.events === 0) ? (
        <div className="notice notice-info small">
          In den verbundenen Kalendern ({calState.read.map((r) => r.name).join(", ") || "keine"}) wurden keine eigenen Termine gefunden. Liegen deine Termine z. B. in einem Google-Kalender, dessen iCal-Link unter{" "}
          <Link href="/anbindungen?p=apple_calendar#apple_calendar">Anbindungen → Kalender</Link> eintragen.
        </div>
      ) : null}

      {canPrivate && (
        <div className="between" style={{ flexWrap: "wrap" }}>
          <div className="priv-tabs" role="group" aria-label="Welche Termine" data-testid="calendar-scope">
            {(["alle", "geschaeft", "privat"] as const).map((k) => (
              <Link key={k} href={href(month, sp.tag, k)} className={`chip${scope === k ? " active" : ""}`} aria-current={scope === k ? "true" : undefined}>{k === "alle" ? "Alle" : k === "geschaeft" ? "Geschäft" : "Privat & Familie"}</Link>
            ))}
          </div>
          {session.privateAccess && <Link className="small" href="/privat/kalender">Privatkalender (Kinderzeit, Paarzeit, Termine …) →</Link>}
        </div>
      )}
      {hiddenCalendars > 0 && (
        <div className="notice notice-info small" data-testid="calendars-hidden">
          Termine aus {hiddenCalendars} eigenen Kalender{hiddenCalendars === 1 ? "" : "n"} des Inhabers sind für dein Konto ausgeblendet (privat bzw. nicht freigegeben). Fälligkeiten des Systems stehen vollständig hier.
        </div>
      )}
      {session.role === "owner" && allCalendarNames.length > 0 && (
        <details className="card card-pad small" data-testid="staff-calendars">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Sichtbarkeit für Mitarbeiter ({(staffCalendars ?? []).length ? `${(staffCalendars ?? []).length} freigegeben` : "keine Kalender freigegeben"})</summary>
          <form action={saveStaffCalendarsAction} className="stack" style={{ gap: 6, marginTop: 8 }}>
            <span className="muted">Mitarbeiter ohne Privat-Zugang (auch „nur ansehen“) sehen nur die hier angehakten Kalender – auf der Startseite und im Kalender. Familien- und Privatkalender nicht anhaken.</span>
            {allCalendarNames.map((n) => (
              <label key={n} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="calendar" value={n} defaultChecked={(staffCalendars ?? []).some((x) => x.toLowerCase() === n.toLowerCase())} /> {n}
              </label>
            ))}
            <button className="btn btn-primary btn-small" type="submit" style={{ alignSelf: "flex-start" }}>Speichern</button>
          </form>
        </details>
      )}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card cal-card" style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="cal-title">
            <h2>{monthTitle(month)}</h2>
            <div className="cal-legend small">
              {[...calendars].map(([name, color]) => (
                <span key={name}><b className="cal-abbr" style={{ ["--c" as string]: color, ["--t" as string]: textOn(color) }}>{calAbbr.get(name)}</b>{name}</span>
              ))}
              {Object.entries(SYSTEM_CATEGORIES).map(([k, c]) => (
                <span key={k}><b className="cal-abbr" style={{ ["--c" as string]: c.color, ["--t" as string]: textOn(c.color) }}>{c.icon}</b>{c.label}</span>
              ))}
            </div>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-wd">{w}</div>
            ))}
            {grid.map((d) => {
              const list = byDay.get(d) ?? [];
              const cls = ["cal-day", d.startsWith(month) ? "" : "cal-out", d === today ? "cal-today" : "", d === selected ? "cal-sel" : ""].filter(Boolean).join(" ");
              return (
                <Link key={d} href={href(month, d)} className={cls} scroll={false}>
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  <span className="cal-items">
                    {list.slice(0, MAX_IN_CELL).map((e) => (
                      <span key={e.id} className={`cal-ev${e.time ? "" : " cal-ev-allday"}${e.overdue ? " cal-ev-overdue" : ""}`} style={{ ["--c" as string]: e.color }} title={`${e.time ? `${e.time} ` : ""}${e.title}`}>
                        {(e.abbr || e.icon) && <b className="cal-abbr" style={{ ["--c" as string]: e.color, ["--t" as string]: textOn(e.color) }} aria-label={e.label}>{e.abbr ?? e.icon}</b>}
                        {e.time && <span className="cal-time">{e.time}</span>}
                        {e.title}
                      </span>
                    ))}
                    {list.length > MAX_IN_CELL && <span className="cal-more">+{list.length - MAX_IN_CELL} weitere</span>}
                  </span>
                  <span className="cal-dots">
                    {list.slice(0, 5).map((e) => (
                      <i key={e.id} style={{ background: e.color }} />
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2 style={{ textTransform: "capitalize" }}>{selectedLabel}</h2>
            {dayList.length === 0 ? (
              <div className="small muted">Nichts eingetragen.</div>
            ) : (
              <div className="stack" style={{ gap: 10, fontSize: 14 }}>
                {dayList.map((e) => (
                  <div key={e.id} style={{ display: "flex", gap: 10 }}>
                    <span style={{ width: 4, borderRadius: 2, background: e.color, flexShrink: 0 }} />
                    <span style={{ minWidth: 0 }}>
                      <span className="small muted">{(e.abbr || e.icon) && <b className="cal-abbr" style={{ ["--c" as string]: e.color, ["--t" as string]: textOn(e.color) }}>{e.abbr ?? e.icon}</b>}{e.time ?? "ganztägig"} · {e.label}{e.overdue ? " · überfällig" : ""}</span>
                      <br />
                      {e.link ? <Link href={e.link}>{e.title}</Link> : e.title}
                      {e.location && <span className="small muted"> · {e.location}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <form action={createTask} className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <label className="label" htmlFor="cal-title">Neue Aufgabe an diesem Tag</label>
              <input className="input" id="cal-title" name="title" required maxLength={300} placeholder="z. B. Ware bei Lieferant bestellen" />
              <input type="hidden" name="dueDate" value={selected} />
              <input type="hidden" name="link" value="/kalender" />
              <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="critical" /> wichtig
              </label>
              <div><button className="btn btn-primary btn-small" type="submit">Eintragen</button></div>
              {appleConnected && <span className="small muted">Erscheint auch im Apple-Kalender „{cal?.calendarName || "Seller-System"}“.</span>}
            </form>
          </section>
          {connected && calState?.lastSync && (
            <div className="small muted" style={{ padding: "0 4px" }}>
              {calState.read?.length ? `Gelesen: ${calState.read.map((r) => `${r.name} (${r.error ? "Fehler" : r.events})`).join(", ")} · ` : ""}Zuletzt abgeglichen {new Date(calState.lastSync).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · eigene Termine werden 3 Monate zurück bis 1 Jahr voraus gelesen, alle 15 Minuten.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
