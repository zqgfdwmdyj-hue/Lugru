import Link from "next/link";
import { and, eq, gte, lte, notInArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { linkAllowed } from "@/lib/auth/areas";
import { collectDesired } from "@/lib/calendar/items";
import { monthGrid, monthTitle, parseMonth, parseView, shiftMonth, spreadDays, weekDays, weekTitle, type CalendarView, type DayEntry } from "@/lib/calendar/month";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { createTask } from "@/lib/tasks/actions";
import { calendarVisible, isBusinessCalendar, seesAllCalendars } from "@/lib/calendar/visibility";
import { SYSTEM_CATEGORIES, textOn } from "@/lib/calendar/colors";
import { calendarPalette } from "@/lib/calendar/palette";
import { saveStaffCalendarsAction } from "./actions";
import { SyncButton } from "./sync-button";

// Monats-, Wochen- und Agendaansicht wie in Apple Kalender: eigene Termine (aus den verbundenen Kalendern, in
// deren Farbe, gefüllt) und alles mit Datum aus dem System – Aufgaben, Fristen, Versand, Ansprüche, geplante
// Zahlungen (umrandet, mit Symbol). Monat kürzt volle Tage, Woche und Agenda zeigen jeden Eintrag ganz.

const SYSTEM_COLORS: Record<string, string> = Object.fromEntries(Object.entries(SYSTEM_CATEGORIES).map(([k, v]) => [k, v.color]));
const SYSTEM_LABELS: Record<string, string> = Object.fromEntries(Object.entries(SYSTEM_CATEGORIES).map(([k, v]) => [k, v.label]));
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_IN_CELL = 4;
const VIEW_LABEL: Record<CalendarView, string> = { monat: "Monat", woche: "Woche", agenda: "Agenda" };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const berlinTime = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

type Scope = "alle" | "geschaeft" | "privat";

const dayHead = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
const dayLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Ein Eintrag als Kästchen (Monat, Woche): Termine gefüllt, Fälligkeiten aus dem System umrandet. */
function EntryChip({ e, wrap = false }: { e: DayEntry; wrap?: boolean }) {
  const cls = ["cal-ev", e.time ? "" : "cal-ev-allday", e.system ? "cal-ev-sys" : "", e.overdue ? "cal-ev-overdue" : "", wrap ? "cal-ev-wrap" : ""].filter(Boolean).join(" ");
  const body = (
    <>
      {(e.abbr || e.icon) && <b className="cal-abbr" style={{ ["--c" as string]: e.color, ["--t" as string]: textOn(e.color) }} aria-label={e.label}>{e.abbr ?? e.icon}</b>}
      {e.time && <span className="cal-time">{e.time}</span>}
      {e.title}
    </>
  );
  return (
    <span className={cls} style={{ ["--c" as string]: e.color }} title={`${e.time ? `${e.time} ` : ""}${e.title} · ${e.label}`} data-kind={e.system ? "faellig" : "termin"}>
      {body}
    </span>
  );
}

/** Ein Eintrag als Zeile (Tagesliste, Agenda): Uhrzeit, Quelle, voller Titel, Link ins System. */
function EntryLine({ e }: { e: DayEntry }) {
  return (
    <div className={`cal-line${e.system ? " cal-line-sys" : ""}`} style={{ ["--c" as string]: e.color }} data-kind={e.system ? "faellig" : "termin"}>
      <span className="cal-line-bar" />
      <span style={{ minWidth: 0 }}>
        <span className="small muted">{(e.abbr || e.icon) && <b className="cal-abbr" style={{ ["--c" as string]: e.color, ["--t" as string]: textOn(e.color) }}>{e.abbr ?? e.icon}</b>}{e.time ?? (e.system ? "fällig" : "ganztägig")} · {e.label}{e.overdue ? " · überfällig" : ""}</span>
        <br />
        {e.link ? <Link href={e.link}>{e.title}</Link> : e.title}
        {e.location && <span className="small muted"> · {e.location}</span>}
      </span>
    </div>
  );
}

export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ monat?: string; tag?: string; sicht?: string; ansicht?: string }> }) {
  const session = await requireArea("kalender");
  const sp = await searchParams;
  const today = todayIso();
  const view = parseView(sp.ansicht);
  const tagParam = sp.tag && ISO_DAY.test(sp.tag) ? sp.tag : null;
  // Woche: der Tag bestimmt den Monat (das Monatsraster enthält immer die ganze Woche).
  const month = view === "woche" && tagParam ? tagParam.slice(0, 7) : parseMonth(sp.monat, today);
  const grid = monthGrid(month);
  const from = grid[0];
  const to = grid[grid.length - 1];
  const selected = tagParam && tagParam >= from && tagParam <= to ? tagParam : today.startsWith(month) ? today : `${month}-01`;
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
      color: SYSTEM_COLORS[d.category] ?? SYSTEM_CATEGORIES.Aufgabe.color,
      label: SYSTEM_LABELS[d.category] ?? d.category,
      icon: SYSTEM_CATEGORIES[d.category]?.icon ?? "☑",
      link: d.link,
      overdue: d.date < today,
      system: true,
    });
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.system ? 1 : 0) - (b.system ? 1 : 0) || (a.time ?? "").localeCompare(b.time ?? ""));

  const href = (m: string, tag?: string, sicht: Scope = scope, ansicht: CalendarView = view) =>
    `/kalender?monat=${m}${tag ? `&tag=${tag}` : ""}${sicht !== "alle" ? `&sicht=${sicht}` : ""}${ansicht !== "monat" ? `&ansicht=${ansicht}` : ""}`;
  const dayList = byDay.get(selected) ?? [];
  const selectedLabel = new Date(`${selected}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const week = weekDays(selected);
  const agendaDays = grid.filter((d) => d.startsWith(month) && (byDay.get(d)?.length ?? 0) > 0);
  // Blättern je Ansicht: Woche um 7 Tage, Monat und Agenda um einen Monat.
  const prevHref = view === "woche" ? href(addDaysIso(selected, -7).slice(0, 7), addDaysIso(selected, -7)) : href(shiftMonth(month, -1));
  const nextHref = view === "woche" ? href(addDaysIso(selected, 7).slice(0, 7), addDaysIso(selected, 7)) : href(shiftMonth(month, 1));
  const prevLabel = view === "woche" ? "Vorige Woche" : "Voriger Monat";
  const nextLabel = view === "woche" ? "Nächste Woche" : "Nächster Monat";
  const newTask = (
    <form action={createTask} className="stack" style={{ gap: 8 }} data-testid="cal-new-task">
      <label className="label" htmlFor="cal-title">Neue Aufgabe</label>
      <input className="input" id="cal-title" name="title" required maxLength={300} placeholder="z. B. Ware bei Lieferant bestellen" />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="sr-only" htmlFor="cal-due">Fällig am</label>
        <input className="input" id="cal-due" type="date" name="dueDate" defaultValue={selected} style={{ width: 160 }} />
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="critical" /> wichtig
        </label>
        <button className="btn btn-primary btn-small" type="submit">Eintragen</button>
      </div>
      <input type="hidden" name="link" value="/kalender" />
      {appleConnected && <span className="small muted">Erscheint auch im Apple-Kalender „{cal?.calendarName || "Seller-System"}“.</span>}
    </form>
  );
  const legend = (
    <div className="cal-legend small">
      {[...calendars].map(([name, color]) => (
        <span key={name}><b className="cal-abbr" style={{ ["--c" as string]: color, ["--t" as string]: textOn(color) }}>{calAbbr.get(name)}</b>{name}</span>
      ))}
      {Object.entries(SYSTEM_CATEGORIES).map(([k, c]) => (
        <span key={k}><b className="cal-abbr" style={{ ["--c" as string]: c.color, ["--t" as string]: textOn(c.color) }}>{c.icon}</b>{c.label}</span>
      ))}
      <span className="cal-legend-kinds" data-testid="cal-legend-kinds">
        <span className="cal-ev cal-ev-allday cal-ev-sample" style={{ ["--c" as string]: "#6E6E73" }}>Termin</span> gefüllt ·{" "}
        <span className="cal-ev cal-ev-sys cal-ev-sample" style={{ ["--c" as string]: SYSTEM_CATEGORIES.Aufgabe.color }}>Fälligkeit</span> umrandet
      </span>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kalender</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {connected && <SyncButton />}
          <div className="priv-tabs" role="group" aria-label="Ansicht" data-testid="calendar-view">
            {(["monat", "woche", "agenda"] as const).map((v) => (
              <Link key={v} href={href(v === "woche" ? selected.slice(0, 7) : month, selected, scope, v)} className={`chip${view === v ? " active" : ""}`} aria-current={view === v ? "true" : undefined} data-testid={`view-${v}`}>{VIEW_LABEL[v]}</Link>
            ))}
          </div>
          <Link className="btn" href={prevHref} aria-label={prevLabel}>‹</Link>
          <Link className="btn" href={href(today.slice(0, 7), today)}>Heute</Link>
          <Link className="btn" href={nextHref} aria-label={nextLabel}>›</Link>
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
              <Link key={k} href={href(month, tagParam ?? undefined, k)} className={`chip${scope === k ? " active" : ""}`} aria-current={scope === k ? "true" : undefined}>{k === "alle" ? "Alle" : k === "geschaeft" ? "Geschäft" : "Privat & Familie"}</Link>
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

      {view === "woche" ? (
        <section className="card cal-card" data-testid="cal-week">
          <div className="cal-title">
            <h2>Woche {weekTitle(week)}</h2>
            {legend}
          </div>
          <div className="cal-week">
            {week.map((d) => {
              const list = byDay.get(d) ?? [];
              return (
                <div key={d} className={`cal-week-day${d === today ? " cal-today" : ""}${d === selected ? " cal-sel" : ""}`} data-day={d}>
                  <Link className="cal-week-head" href={href(d.slice(0, 7), d)} scroll={false}>
                    <span>{dayHead(d)}</span>
                    {list.length > 0 && <span className="muted small">{list.length}</span>}
                  </Link>
                  <div className="cal-week-items">
                    {list.length === 0 ? <span className="small muted">–</span> : list.map((e) => (e.link ? <Link key={e.id} href={e.link} className="cal-ev-link"><EntryChip e={e} wrap /></Link> : <EntryChip key={e.id} e={e} wrap />))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : view === "agenda" ? (
        <section className="card card-pad stack" data-testid="cal-agenda">
          <div className="cal-title" style={{ padding: 0 }}>
            <h2>{monthTitle(month)} · Agenda</h2>
            {legend}
          </div>
          {agendaDays.length === 0 ? (
            <div className="small muted">In diesem Monat ist nichts eingetragen.</div>
          ) : (
            <div className="cal-agenda">
              {agendaDays.map((d) => (
                <div key={d} className={`cal-agenda-day${d === today ? " cal-agenda-today" : ""}${d < today ? " cal-agenda-past" : ""}`} id={`tag-${d}`} data-day={d}>
                  <h3>{dayLong(d)}{d === today ? " · heute" : ""}</h3>
                  <div className="stack" style={{ gap: 8, fontSize: 14 }}>
                    {(byDay.get(d) ?? []).map((e) => <EntryLine key={e.id} e={e} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <section className="card cal-card" style={{ flexGrow: 1, minWidth: 0 }}>
            <div className="cal-title">
              <h2>{monthTitle(month)}</h2>
              {legend}
            </div>
            <div className="cal-grid">
              {WEEKDAYS.map((w) => (
                <div key={w} className="cal-wd">{w}</div>
              ))}
              {grid.map((d) => {
                const list = byDay.get(d) ?? [];
                const cls = ["cal-day", d.startsWith(month) ? "" : "cal-out", d === today ? "cal-today" : "", d === selected ? "cal-sel" : ""].filter(Boolean).join(" ");
                return (
                  <Link key={d} href={href(month, d)} className={cls} scroll={false} data-day={d}>
                    <span className="cal-num">{Number(d.slice(8))}</span>
                    <span className="cal-items">
                      {list.slice(0, MAX_IN_CELL).map((e) => <EntryChip key={e.id} e={e} />)}
                      {list.length > MAX_IN_CELL && <span className="cal-more" title="Tag anklicken: alle Einträge stehen in der Tagesliste – oder Woche/Agenda öffnen" data-testid="cal-more">+{list.length - MAX_IN_CELL} weitere ›</span>}
                    </span>
                    <span className="cal-dots">
                      {list.slice(0, 5).map((e) => (
                        <i key={e.id} className={e.system ? "sys" : undefined} style={{ ["--c" as string]: e.color }} />
                      ))}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <aside className="col-side cal-side">
            <section className="card card-pad stack" data-testid="cal-daylist">
              <div className="between" style={{ alignItems: "baseline" }}>
                <h2 style={{ textTransform: "capitalize" }}>{selectedLabel}</h2>
                <Link className="small" href={href(selected.slice(0, 7), selected, scope, "woche")} data-testid="cal-open-week">Woche ›</Link>
              </div>
              {dayList.length === 0 ? (
                <div className="small muted">Nichts eingetragen.</div>
              ) : (
                <div className="stack" style={{ gap: 10, fontSize: 14 }}>
                  {dayList.map((e) => <EntryLine key={e.id} e={e} />)}
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>{newTask}</div>
            </section>
            {connected && calState?.lastSync && (
              <div className="small muted" style={{ padding: "0 4px" }}>
                {calState.read?.length ? `Gelesen: ${calState.read.map((r) => `${r.name} (${r.error ? "Fehler" : r.events})`).join(", ")} · ` : ""}Zuletzt abgeglichen {new Date(calState.lastSync).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · eigene Termine werden 3 Monate zurück bis 1 Jahr voraus gelesen, alle 15 Minuten.
              </div>
            )}
          </aside>
        </div>
      )}
      {view !== "monat" && <section className="card card-pad" style={{ maxWidth: 560 }}>{newTask}</section>}
    </>
  );
}
