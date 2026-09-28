import Link from "next/link";
import { and, eq, gte, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { collectDesired } from "@/lib/calendar/items";
import { monthGrid, monthTitle, parseMonth, shiftMonth, spreadDays, type DayEntry } from "@/lib/calendar/month";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { createTask } from "@/lib/tasks/actions";
import { SyncButton } from "./sync-button";

// Monatsansicht wie in Apple Kalender: eigene Termine (aus den verbundenen Kalendern, in deren Farbe)
// und alles mit Datum aus dem System – Aufgaben, Fristen, Versand, Ansprüche, geplante Zahlungen.

const SYSTEM_COLORS: Record<string, string> = {
  Aufgabe: "#0E6B5F",
  Fall: "#B42318",
  Ansprüche: "#8A4F00",
  Versand: "#1F5FAE",
  Geld: "#1C6B3A",
};
const SYSTEM_LABELS: Record<string, string> = { Aufgabe: "Aufgabe", Fall: "Frist", Ansprüche: "Ansprüche", Versand: "Versand", Geld: "Geld" };
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_IN_CELL = 4;

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ monat?: string; tag?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const today = todayIso();
  const month = parseMonth(sp.monat, today);
  const grid = monthGrid(month);
  const from = grid[0];
  const to = grid[grid.length - 1];
  const selected = sp.tag && /^\d{4}-\d{2}-\d{2}$/.test(sp.tag) && sp.tag >= from && sp.tag <= to ? sp.tag : today.startsWith(month) ? today : `${month}-01`;

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
  for (const ev of events) {
    const color = ev.color ?? "#6E6E73";
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
      }),
    );
  }
  for (const d of desired) {
    if (d.date < from || d.date > to) continue;
    push(d.date, {
      id: d.key,
      title: d.title,
      time: null,
      color: SYSTEM_COLORS[d.category] ?? "#0E6B5F",
      label: SYSTEM_LABELS[d.category] ?? d.category,
      link: d.link,
      overdue: d.date < today,
    });
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.link ? 1 : 0) - (b.link ? 1 : 0) || (a.time ?? "").localeCompare(b.time ?? ""));

  const href = (m: string, tag?: string) => `/kalender?monat=${m}${tag ? `&tag=${tag}` : ""}`;
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

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card cal-card" style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="cal-title">
            <h2>{monthTitle(month)}</h2>
            <div className="cal-legend small">
              {[...calendars].map(([name, color]) => (
                <span key={name}><i style={{ background: color }} />{name}</span>
              ))}
              {Object.entries(SYSTEM_LABELS).map(([k, label]) => (
                <span key={k}><i style={{ background: SYSTEM_COLORS[k] }} />{label}</span>
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
                      <span className="small muted">{e.time ?? "ganztägig"} · {e.label}{e.overdue ? " · überfällig" : ""}</span>
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
