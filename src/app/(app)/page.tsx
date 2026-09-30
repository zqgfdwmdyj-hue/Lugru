import Link from "next/link";
import { and, asc, count, desc, eq, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { linkAllowed } from "@/lib/auth/areas";
import { addDaysIso, dueLabel, greeting, longDate, todayIso } from "@/lib/dates";
import { formatDate } from "@/lib/numbers";
import { createTask, deleteTask, toggleTask } from "@/lib/tasks/actions";
import { refreshImportReminder } from "@/lib/tasks/system";

const CATEGORY_LABEL: Record<string, string> = {
  amazon: "Amazon",
  ebay: "eBay",
  versand: "Versand",
  einkauf: "Einkauf",
  geld: "Geld",
  support: "Support",
  eigene: "Eigene",
  marken: "Marken",
  system: "System",
};

const FILTERS = ["alle", "einkauf", "amazon", "ebay", "geld", "marken", "eigene"] as const;

type Task = typeof schema.tasks.$inferSelect;

function TaskRow({ task, today }: { task: Task; today: string }) {
  const done = task.status === "done";
  const overdue = !done && task.dueDate !== null && task.dueDate <= today;
  const tagClass =
    task.priority === "critical"
      ? "tag tag-critical"
      : task.category === "einkauf" || task.category === "versand"
        ? "tag tag-info"
        : task.category === "geld"
          ? "tag tag-warn"
          : "tag tag-neutral";
  return (
    <div className={`todo${done ? " todo-done" : ""}`}>
      <form action={toggleTask}>
        <input type="hidden" name="id" value={task.id} />
        <button
          type="submit"
          className={`todo-check${done ? " checked" : ""}`}
          aria-label={done ? "Wieder öffnen" : "Als erledigt markieren"}
        >
          {done && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" aria-hidden="true">
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </button>
      </form>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div className="todo-title">
          {task.link && !done ? <Link href={task.link} style={{ color: "inherit", textDecoration: "none" }}>{task.title}</Link> : task.title}
        </div>
        {task.notes && <div className="todo-notes">{task.notes}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, width: 190, justifyContent: "flex-end" }}>
        <span className={tagClass}>
          {task.priority === "critical" ? "KRITISCH" : CATEGORY_LABEL[task.category].toUpperCase()}
        </span>
        <span className="due" style={{ color: overdue ? "var(--danger)" : "var(--muted)" }}>
          {task.dueDate ? dueLabel(task.dueDate, today) : ""}
        </span>
        <span style={{ width: 14 }}>
          {task.systemKey === null && (
            <form action={deleteTask}>
              <input type="hidden" name="id" value={task.id} />
              <button type="submit" className="btn-link" aria-label="Aufgabe löschen" title="Löschen" style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1 }}>
                ×
              </button>
            </form>
          )}
        </span>
      </div>
    </div>
  );
}

export default async function StartPage({ searchParams }: { searchParams: Promise<{ kat?: string }> }) {
  const session = await requireSession();
  const { kat } = await searchParams;
  const filter = FILTERS.includes(kat as (typeof FILTERS)[number]) ? kat! : "alle";
  const today = todayIso();

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  await refreshImportReminder(session.tenantId, tenant.settings.importReminderDays ?? 7);

  const T = schema.tasks;
  const base = [eq(T.tenantId, session.tenantId)];
  if (filter !== "alle") base.push(eq(T.category, filter as Task["category"]));

  const [open, recentlyDone] = await Promise.all([
    db
      .select()
      .from(T)
      .where(and(...base, eq(T.status, "open")))
      .orderBy(sql`${T.dueDate} asc nulls last`, sql`case ${T.priority} when 'critical' then 0 when 'normal' then 1 else 2 end`, asc(T.createdAt)),
    db
      .select()
      .from(T)
      .where(and(...base, eq(T.status, "done")))
      .orderBy(desc(T.completedAt))
      .limit(3),
  ]);

  // Eingeschränkte Mitarbeiter: nur Aufgaben aus freigegebenen Bereichen und eigene.
  const restricted = session.role === "staff" && session.areas !== null;
  const brandLimited = session.role === "staff" && session.brandIds !== null;
  const visibleTask = (t: Task) => (!restricted && !brandLimited) || (t.link ? linkAllowed(session, t.link) : !restricted || t.createdBy === session.userId);
  if (restricted || brandLimited) {
    for (const list of [open, recentlyDone]) list.splice(0, list.length, ...list.filter(visibleTask));
  }

  const weekEnd = addDaysIso(today, 7);
  const now = open.filter((t) => t.priority === "critical" || (t.dueDate !== null && t.dueDate <= today));
  const soon = open.filter((t) => !now.includes(t) && t.dueDate !== null && t.dueDate <= weekEnd);
  const later = open.filter((t) => !now.includes(t) && !soon.includes(t));

  const L = schema.lots;
  const [lotStats] = await db
    .select({
      total: count(),
      returns: sql<number>`count(*) filter (where ${L.kind} = 'return')::int`,
      inherited: sql<number>`count(*) filter (where ${L.unitCostSource} = 'inherited')::int`,
      withoutCost: sql<number>`count(*) filter (where ${L.unitCostNet} is null)::int`,
    })
    .from(L)
    .where(eq(L.tenantId, session.tenantId));
  const [lastImport] = await db
    .select({ at: max(schema.importRuns.createdAt) })
    .from(schema.importRuns)
    .where(eq(schema.importRuns.tenantId, session.tenantId));
  const [kb] = await db
    .select({ n: count() })
    .from(schema.knowledgeEntries)
    .where(eq(schema.knowledgeEntries.tenantId, session.tenantId));
  const upcoming = await db
    .select({ title: T.title, dueDate: T.dueDate })
    .from(T)
    .where(and(eq(T.tenantId, session.tenantId), eq(T.status, "open"), sql`${T.dueDate} is not null`))
    .orderBy(asc(T.dueDate))
    .limit(5);

  const E = schema.calendarEvents;
  const [appointments, [calendarLink]] = await Promise.all([
    db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, session.tenantId), sql`${E.day} between ${today}::date and ${addDaysIso(today, 7)}::date`))
      .orderBy(asc(E.day), desc(E.allDay), asc(E.startsAt))
      .limit(12),
    db.select({ n: count() }).from(schema.integrations).where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, "apple_calendar"))),
  ]);
  const calState = tenant.settings.calendar;
  const timeOf = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

  const section = (label: string, color: string, items: Task[]) =>
    items.length > 0 && (
      <>
        <div className="section-label" style={{ color }}>{label}</div>
        {items.map((t) => <TaskRow key={t.id} task={t} today={today} />)}
      </>
    );

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <div style={{ flexShrink: 0 }}>
          <div className="crumb">{longDate()}</div>
          <h1 style={{ marginTop: 2 }}>{greeting()}</h1>
        </div>
        <form action="/suche" style={{ flexGrow: 1, maxWidth: 720 }}>
          <label htmlFor="q" className="sr-only">Suche</label>
          <input
            id="q"
            name="q"
            type="search"
            className="input"
            placeholder="Suchen: ASIN, SKU, Artikel, Shop, Wissen, Aufgabe …"
            style={{ height: 46, fontSize: 15 }}
          />
        </form>
      </div>

      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
          <div className="between" style={{ padding: "18px 22px 12px", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 20 }}>
              To-dos <span className="num muted" style={{ fontSize: 15, fontWeight: 400 }}>{open.length} offen</span>
            </h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FILTERS.map((f) => (
                <Link key={f} href={f === "alle" ? "/" : `/?kat=${f}`} className={`chip${filter === f ? " active" : ""}`}>
                  {f === "alle" ? "Alle" : CATEGORY_LABEL[f]}
                </Link>
              ))}
            </div>
          </div>

          <form action={createTask} style={{ margin: "0 22px 10px", display: "flex", gap: 8, alignItems: "center" }}>
            <label htmlFor="title" className="sr-only">Neue Aufgabe</label>
            <input id="title" name="title" className="input" placeholder="Eigene Aufgabe hinzufügen …" required style={{ flexGrow: 1 }} />
            <label htmlFor="dueDate" className="sr-only">Fällig am</label>
            <input id="dueDate" name="dueDate" type="date" className="input" style={{ width: 150 }} />
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <input type="checkbox" name="critical" /> kritisch
            </label>
            <input type="hidden" name="category" value={filter === "alle" ? "eigene" : filter} />
            <button className="btn btn-primary" type="submit">Hinzufügen</button>
          </form>

          {open.length === 0 && (
            <div style={{ padding: "18px 22px" }} className="muted">Nichts offen. Stark.</div>
          )}
          {section("ÜBERFÄLLIG, HEUTE & KRITISCH", "var(--danger)", now)}
          {section("NÄCHSTE 7 TAGE", "var(--muted)", soon)}
          {section("OHNE DATUM / SPÄTER", "var(--muted)", later)}
          {recentlyDone.length > 0 && (
            <>
              <div className="section-label muted">ZULETZT ERLEDIGT</div>
              {recentlyDone.map((t) => <TaskRow key={t.id} task={t} today={today} />)}
            </>
          )}
        </section>

        {!restricted && (
        <div className="col-side">
          <section className="card card-pad">
            <div className="between" style={{ marginBottom: 12 }}>
              <h2>Termine</h2>
              {calendarLink.n > 0 && calState?.lastSync && <span className="small muted">Kalender {new Date(calState.lastSync).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
            {calendarLink.n === 0 ? (
              <div className="small muted">
                Kalender verbinden (iCloud, Google, Outlook), dann stehen hier deine Termine – und alle Fälligkeiten des Systems in deinem Kalender.{" "}
                {session.role === "owner" && <Link href="/anbindungen?p=apple_calendar#apple_calendar">Jetzt verbinden</Link>}
              </div>
            ) : calState?.lastError ? (
              <div className="small" style={{ color: "var(--danger)" }}>Kalender: {calState.lastError}</div>
            ) : appointments.length === 0 ? (
              <div className="small muted">Keine Termine in den nächsten 7 Tagen.</div>
            ) : (
              <div className="stack" style={{ fontSize: 13 }}>
                {appointments.map((a) => (
                  <div key={a.id} style={{ display: "flex", gap: 10 }}>
                    <span className="num" style={{ width: 64, flexShrink: 0 }}>{dueLabel(a.day, today)}</span>
                    <span style={{ minWidth: 0 }}>
                      {!a.allDay && <span className="num muted">{timeOf(a.startsAt)} </span>}
                      {a.title}
                      {a.location && <span className="muted"> · {a.location}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Schnellzugriff</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              <Link className="btn" href="/import">Daten importieren</Link>
              <Link className="btn" href="/export">COG-Export</Link>
              <Link className="btn" href="/chargen">Chargen</Link>
              <Link className="btn" href="/wissen/neu">Wissen notieren</Link>
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Auf einen Blick</h2>
            <div className="stack" style={{ fontSize: 14 }}>
              <div className="between"><span className="muted">Chargen gesamt</span><span className="num">{lotStats.total}</span></div>
              <div className="between"><span className="muted">Retouren mit geerbtem EK</span><span className="num">{lotStats.inherited} / {lotStats.returns}</span></div>
              <div className="between">
                <span className="muted">Chargen ohne EK</span>
                <Link className="num" href="/chargen?filter=ohne-ek" style={{ color: lotStats.withoutCost ? "var(--danger)" : undefined }}>{lotStats.withoutCost}</Link>
              </div>
              <div className="between"><span className="muted">Letzter Import</span><span className="num">{lastImport?.at ? formatDate(new Date(lastImport.at).toISOString()) : "–"}</span></div>
              <div className="between"><span className="muted">Wissenseinträge</span><span className="num">{kb.n}</span></div>
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Nächste Fristen</h2>
            {upcoming.length === 0 ? (
              <div className="muted small">Keine Aufgaben mit Datum.</div>
            ) : (
              <div className="stack" style={{ fontSize: 13 }}>
                {upcoming.map((u, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <span className="num" style={{ width: 64, flexShrink: 0, color: u.dueDate! <= today ? "var(--danger)" : undefined }}>
                      {dueLabel(u.dueDate!, today)}
                    </span>
                    <span>{u.title}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        )}
      </div>
    </>
  );
}
