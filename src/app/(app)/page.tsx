import Link from "next/link";
import { heuteZeit } from "@/lib/zeit/service";
import { rueckfrageVerschiebenAction } from "./kalender/zeiten/actions";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { areaForPath, canAccess, linkAllowed } from "@/lib/auth/areas";
import { getPrefs } from "@/lib/auth/prefs";
import { addDaysIso, dueLabel, greeting, longDate, todayIso } from "@/lib/dates";
import { createTask, deleteTask, toggleTask } from "@/lib/tasks/actions";
import { refreshImportReminder } from "@/lib/tasks/system";
import { BUCKET_LABEL, bucketCounts, bucketOf, isIdeaTask, planDay, type Bucket, type TaskLite } from "@/lib/today/logic";
import { dataAreas, todaySignals } from "@/lib/today/service";
import { calendarVisible, isBusinessCalendar } from "@/lib/calendar/visibility";
import { DEFAULT_CALENDAR_NAME } from "@/lib/calendar/sync";
import { getIntegration as integrationLaden } from "@/lib/integrations/store";
import { PRIVAT_BELEGT } from "@/lib/tagesplan/service";
import { textOn } from "@/lib/calendar/colors";
import { calendarPalette } from "@/lib/calendar/palette";
import { PrivateHint } from "@/app/(privat)/privat/hint";
import { TaskNotes } from "@/components/task-notes";
import { Suspense } from "react";
import { TodayInsights } from "./today-insights";
import { toggleCalendarAction } from "./start-actions";

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
const BUCKETS: Bucket[] = ["ueberfaellig", "heute", "woche", "spaeter", "ohne"];

type Task = typeof schema.tasks.$inferSelect;

function TaskRow({ task, today, step = false, idea = false }: { task: Task | TaskLite; today: string; step?: boolean; idea?: boolean }) {
  const done = "status" in task && task.status === "done";
  // Ideen haben höchstens ein vorgeschlagenes Datum – nie „überfällig“.
  const overdue = !idea && !done && task.dueDate !== null && task.dueDate < today;
  const tagClass =
    task.priority === "critical" ? "tag tag-critical" : task.category === "einkauf" || task.category === "versand" ? "tag tag-info" : task.category === "geld" ? "tag tag-warn" : "tag tag-neutral";
  return (
    <div className={`todo${done ? " todo-done" : ""}`} data-testid="task-row">
      <form action={toggleTask}>
        <input type="hidden" name="id" value={task.id} />
        <button type="submit" className={`todo-check${done ? " checked" : ""}`} aria-label={done ? "Wieder öffnen" : "Als erledigt markieren"}>
          {done && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" aria-hidden="true">
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </button>
      </form>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div className="todo-title">{task.link && !done ? <Link href={task.link} style={{ color: "inherit", textDecoration: "none" }}>{task.title}</Link> : task.title}</div>
        <TaskNotes notes={task.notes} />
      </div>
      <div className="todo-meta">
        <span className={tagClass}>{task.priority === "critical" ? "KRITISCH" : (CATEGORY_LABEL[task.category] ?? task.category).toUpperCase()}</span>
        <span className="due" style={{ color: overdue ? "var(--danger)" : "var(--muted)" }}>{task.dueDate ? (idea ? `Vorschlag ${new Date(`${task.dueDate}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}` : dueLabel(task.dueDate, today)) : ""}</span>
        {step && task.link && !done ? (
          <Link className="btn btn-small" href={task.link} data-testid="task-step">Öffnen →</Link>
        ) : (
          <span style={{ width: 14 }}>
            {"systemKey" in task && task.systemKey === null && "createdBy" in task && (
              <form action={deleteTask}>
                <input type="hidden" name="id" value={task.id} />
                <button type="submit" className="btn-link x-danger" aria-label="Aufgabe löschen" title="Löschen" style={{ fontSize: 18, lineHeight: 1 }}>×</button>
              </form>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function AddTask({ category }: { category: string }) {
  return (
    <details className="add-task">
      <summary className="btn btn-small" data-testid="add-task-toggle">+ Eigene Aufgabe</summary>
      <form action={createTask} className="add-task-form">
        <label htmlFor="title" className="sr-only">Neue Aufgabe</label>
        <input id="title" name="title" className="input" placeholder="Was ist zu tun?" required style={{ flexGrow: 1, minWidth: 180 }} />
        <label htmlFor="dueDate" className="sr-only">Fällig am</label>
        <input id="dueDate" name="dueDate" type="date" className="input" style={{ width: 150 }} />
        <label className="small" style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <input type="checkbox" name="critical" /> kritisch
        </label>
        <input type="hidden" name="category" value={category} />
        <button className="btn btn-primary" type="submit">Hinzufügen</button>
        <div className="small muted" style={{ flexBasis: "100%" }}>Erscheint in den Aufgaben der Firma und – mit Datum – im Kalender (auch im verbundenen Apple-Kalender „Seller-System“). Private Aufgaben gehören in den Privat-Bereich.</div>
      </form>
    </details>
  );
}

/** Freie Zeit / reservierte Kapazität heute; Rückfrage bei „wichtig + Frist heute“ an einem freien Tag. */
async function ZeitHeute({ tenantId, userId, today }: { tenantId: string; userId: string; today: string }) {
  const z = await heuteZeit(tenantId, userId, today).catch(() => null);
  if (!z || (!z.frei.length && !z.reserviert.stunden)) return null;
  return (
    <div className="card card-pad small" style={{ marginBottom: 14 }} data-testid="zeit-heute">
      {z.frei.map((b) => (
        <div key={b.id}>🌙 <strong>{b.titel}</strong>{b.ganztags ? " – heute keine Geschäftsaufgaben" : ` ab ${b.vonZeit} – danach Feierabend`}.</div>
      ))}
      {z.reserviert.bloecke.map((b) => (
        <div key={b.id}>⏳ Heute reserviert: <strong>{String(b.stunden ?? 0).replace(".", ",")} Std. {b.titel}</strong>{b.link && <> – <Link href={b.link}>öffnen</Link></>}</div>
      ))}
      {z.rueckfragen.length > 0 && (
        <div style={{ marginTop: 6 }} data-testid="zeit-rueckfrage">
          <strong>Rückfrage:</strong> heute ist frei, aber {z.rueckfragen.length === 1 ? "eine wichtige Aufgabe ist" : `${z.rueckfragen.length} wichtige Aufgaben sind`} heute fällig:
          {z.rueckfragen.map((t) => (
            <form key={t.id} action={rueckfrageVerschiebenAction} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <input type="hidden" name="id" value={t.id} />
              <span>{t.link ? <Link href={t.link}>{t.title}</Link> : t.title}</span>
              <button className="btn btn-small" type="submit">auf nächsten Arbeitstag</button>
              <span className="muted">oder heute erledigen</span>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function StartPage({ searchParams }: { searchParams: Promise<{ kat?: string; ansicht?: string; zeit?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const filter = FILTERS.includes(sp.kat as (typeof FILTERS)[number]) ? sp.kat! : "alle";
  const listView = sp.ansicht === "liste" || filter !== "alle";
  const zeit = BUCKETS.includes(sp.zeit as Bucket) ? (sp.zeit as Bucket) : null;
  const today = todayIso();

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  await refreshImportReminder(session.tenantId, tenant.settings.importReminderDays ?? 7);

  const T = schema.tasks;
  const base = [eq(T.tenantId, session.tenantId)];
  if (filter !== "alle") base.push(eq(T.category, filter as Task["category"]));
  const [open, recentlyDone] = await Promise.all([
    db.select().from(T).where(and(...base, eq(T.status, "open"))).orderBy(sql`${T.dueDate} asc nulls last`, sql`case ${T.priority} when 'critical' then 0 when 'normal' then 1 else 2 end`, asc(T.createdAt)),
    db.select().from(T).where(and(...base, eq(T.status, "done"))).orderBy(desc(T.completedAt)).limit(5),
  ]);

  // Eingeschränkte Mitarbeiter: nur Aufgaben aus freigegebenen Bereichen und eigene.
  const restricted = session.role === "staff" && session.areas !== null;
  const brandLimited = session.role === "staff" && session.brandIds !== null;
  const visibleTask = (t: Task) => (!restricted && !brandLimited) || (t.link ? linkAllowed(session, t.link) : !restricted || t.createdBy === session.userId);
  if (restricted || brandLimited) for (const list of [open, recentlyDone]) list.splice(0, list.length, ...list.filter(visibleTask));

  const plan = planDay(open, today);
  const [signals, areas, prefs] = await Promise.all([todaySignals(session.tenantId, today), restricted ? Promise.resolve([]) : dataAreas(session.tenantId), getPrefs(session)]);
  const mySignals = signals.filter((s) => canAccess(session, areaForPath(s.href.split("?")[0])));
  // Rechtsfristen in 7 Tagen (nur Inhaber): geschäftlich mit Titel, private nur als Anzahl.
  const recht = await import("@/lib/recht/service").then((x) => x.rechtZeile(session, today)).catch(() => null);
  if (recht) mySignals.push({ key: "recht", label: recht.text, count: recht.anzahl, href: recht.link, level: "warn" });

  const E = schema.calendarEvents;
  const [appointments, [calendarLink]] = await Promise.all([
    db.select().from(E).where(and(eq(E.tenantId, session.tenantId), sql`${E.day} between ${today}::date and ${addDaysIso(today, 7)}::date`)).orderBy(asc(E.day), desc(E.allDay), asc(E.startsAt)).limit(40),
    db.select({ n: count() }).from(schema.integrations).where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, "apple_calendar"))),
  ]);
  const calState = tenant.settings.calendar;
  // Eigene Kalender nur, wenn diese Person sie sehen darf (Inhaber/Privat-Zugang alle, sonst nur freigegebene).
  const allowed = appointments.filter((a) => calendarVisible(session, a.calendarName, calState?.staffCalendars));
  const blockedCalendars = new Set(appointments.filter((a) => !calendarVisible(session, a.calendarName, calState?.staffCalendars)).map((a) => a.calendarName)).size;
  const calendars = [...new Set(allowed.map((a) => a.calendarName))].sort();
  const { colors: calColors, abbr: calAbbr } = await calendarPalette(session.tenantId);
  const hidden = new Set(prefs.hiddenCalendars ?? []);
  const shownAppointments = allowed.filter((a) => !hidden.has(a.calendarName)).slice(0, 12);
  // B15.2: Private/Familien-Kalender auf der Startseite nur als „Privat belegt“ + Uhrzeit – nie Titel, Ort oder Beträge.
  const pushKalender = (await integrationLaden(session.tenantId, "apple_calendar").catch(() => null))?.calendarName || DEFAULT_CALENDAR_NAME;
  const privatTermin = (name: string) => !isBusinessCalendar(name, calState?.staffCalendars, pushKalender);
  const timeOf = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const problems = areas.filter((a) => a.missing || a.stale || a.error);

  const head = (
    <div className="page-head" style={{ alignItems: "center" }}>
      <div style={{ flexShrink: 0 }}>
        <div className="crumb">{longDate()}</div>
        <h1 style={{ marginTop: 2 }}>{greeting()}</h1>
      </div>
      <form action="/suche" style={{ flexGrow: 1, maxWidth: 720 }}>
        <label htmlFor="q" className="sr-only">Suche</label>
        <input id="q" name="q" type="search" className="input" placeholder="Suchen: ASIN, SKU, Artikel, Shop, Wissen, Aufgabe …" style={{ height: 46, fontSize: 15 }} />
      </form>
    </div>
  );

  // ---- Klassische Liste (Filter nach Bereich bzw. „alle Aufgaben“) – wie bisher, nach Zeitfenstern getrennt.
  if (listView) {
    // Gleiche Zeitlogik wie die Tagesübersicht: automatische Ideen zählen nicht und stehen getrennt.
    const binding = open.filter((t) => !isIdeaTask(t));
    const ideaTasks = open.filter((t) => isIdeaTask(t));
    const listCounts = bucketCounts(open, today);
    const byBucket = (b: Bucket) => binding.filter((t) => bucketOf(t, today) === b);
    return (
      <>
        {head}
        <section className="card" style={{ minWidth: 0, overflow: "hidden" }} data-testid="task-list">
          <div className="between" style={{ padding: "18px 22px 12px", flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 20 }}>
              <Link href="/" className="small" style={{ fontWeight: 400, marginRight: 8 }}>← Tagesübersicht</Link>
              Alle Aufgaben <span className="num muted" style={{ fontSize: 15, fontWeight: 400 }}>{binding.length} offen{ideaTasks.length ? ` · ${ideaTasks.length} Ideen` : ""}</span>
            </h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FILTERS.map((f) => (
                <Link key={f} href={f === "alle" ? "/?ansicht=liste" : `/?kat=${f}`} className={`chip${filter === f ? " active" : ""}`} aria-current={filter === f ? "true" : undefined}>{f === "alle" ? "Alle" : CATEGORY_LABEL[f]}</Link>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 22px 10px" }}>
            {BUCKETS.map((b) => (
              <Link key={b} href={`/?ansicht=liste${filter !== "alle" ? `&kat=${filter}` : ""}${zeit === b ? "" : `&zeit=${b}`}`} className={`chip${zeit === b ? " active" : ""}`} aria-current={zeit === b ? "true" : undefined} data-testid={`list-count-${b}`}>{BUCKET_LABEL[b]} · {listCounts[b]}</Link>
            ))}
          </div>
          <div style={{ padding: "0 22px 10px" }}><AddTask category={filter === "alle" ? "eigene" : filter} /></div>
          {open.length === 0 && <div style={{ padding: "18px 22px" }} className="muted">{filter === "alle" ? "Nichts offen." : "Keine offenen Aufgaben in diesem Bereich."}</div>}
          {BUCKETS.filter((b) => !zeit || b === zeit).map((b) => {
            const list = byBucket(b);
            if (!list.length) return null;
            return (
              <div key={b} data-testid={`bucket-${b}`}>
                <div className="section-label" style={{ color: b === "ueberfaellig" ? "var(--danger)" : "var(--muted)" }}>{BUCKET_LABEL[b].toUpperCase()} · {list.length}</div>
                {list.map((t) => <TaskRow key={t.id} task={t} today={today} />)}
              </div>
            );
          })}
          {ideaTasks.length > 0 && !zeit && (
            <div data-testid="bucket-ideen">
              <div className="section-label muted">IDEEN & VORSCHLÄGE (UNVERBINDLICH) · {ideaTasks.length}</div>
              {ideaTasks.map((t) => <TaskRow key={t.id} task={t} today={today} idea />)}
            </div>
          )}
          {recentlyDone.length > 0 && !zeit && (
            <>
              <div className="section-label muted">ZULETZT ERLEDIGT</div>
              {recentlyDone.map((t) => <TaskRow key={t.id} task={t} today={today} />)}
            </>
          )}
        </section>
      </>
    );
  }

  // ---- Tagesübersicht
  const urgent = mySignals.filter((s) => s.level === "danger");
  const warn = mySignals.filter((s) => s.level === "warn");
  const info = mySignals.filter((s) => s.level === "info");
  return (
    <>
      {head}
      <PrivateHint session={session} />
      <ZeitHeute tenantId={session.tenantId} userId={session.userId} today={today} />

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0, gap: 16 }}>
          <section className="card" data-testid="today-urgent">
            <div className="card-head"><h2>Jetzt dringend</h2></div>
            {urgent.length === 0 && plan.critical.length === 0 && warn.length === 0 && info.length === 0 ? (
              <div className="card-pad small muted" style={{ paddingTop: 0 }} data-testid="nothing-urgent">Nichts Dringendes: keine fälligen Versände, Fall-Fristen, negativen Bestände oder ablaufenden Ansprüche.</div>
            ) : (
              <div className="signal-list">
                {[...urgent, ...warn, ...info].map((s) => (
                  <Link key={s.key} href={s.href} className={`signal signal-${s.level}`} data-testid={`signal-${s.key}`}>
                    <span className="signal-text"><strong>{s.label}</strong>{s.detail && <span className="small"> · {s.detail}</span>}</span>
                    <span className="signal-go">→</span>
                  </Link>
                ))}
                {plan.critical.map((t) => <TaskRow key={t.id} task={t} today={today} step />)}
              </div>
            )}
          </section>

          <section className="card" data-testid="today-next">
            <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
              <h2>Als Nächstes</h2>
              <div className="bucket-bar">
                {BUCKETS.map((b) => (
                  <Link key={b} href={`/?ansicht=liste&zeit=${b}`} className={`bucket-pill${b === "ueberfaellig" && plan.counts[b] ? " danger" : ""}`} data-testid={`count-${b}`}>
                    {BUCKET_LABEL[b]} <strong>{plan.counts[b]}</strong>
                  </Link>
                ))}
              </div>
            </div>
            {plan.top.length === 0 && plan.soonElsewhere === 0 ? (
              <div className="card-pad small muted" style={{ paddingTop: 0 }} data-testid="next-empty">Keine Aufgaben fällig bis in 7 Tagen{plan.noDate.length ? " – unten „Ohne Datum“ ansehen" : ""}.</div>
            ) : (
              plan.top.map((t) => <TaskRow key={t.id} task={t} today={today} step />)
            )}
            {plan.soonElsewhere > 0 && (
              <div className="card-pad small" style={{ paddingTop: plan.top.length ? 8 : 0 }} data-testid="next-elsewhere">
                {plan.top.length ? "Außerdem " : ""}
                <Link href="/?ansicht=liste&zeit=woche">{plan.soonElsewhere} {plan.soonElsewhere === 1 ? "Aufgabe" : "Aufgaben"} bis in 7 Tagen</Link>{" "}
                {plan.bundles.length ? "in den Arbeitsvorräten unten bzw. in der Liste" : "in der Liste"}.
              </div>
            )}
            <div className="card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              <AddTask category="eigene" />
              <Link className="btn btn-small" href="/?ansicht=liste" data-testid="all-tasks-link">{(() => { const ideas = open.filter((t) => isIdeaTask(t)).length; return `Alle Aufgaben (${open.length - ideas}${ideas ? ` · ${ideas} ${ideas === 1 ? "Idee" : "Ideen"}` : ""})`; })()}</Link>
            </div>
          </section>

          {plan.bundles.length > 0 && (
            <section className="card" data-testid="today-bundles">
              <div className="card-head"><h2>Arbeitsvorräte</h2></div>
              <div className="bundle-list">
                {plan.bundles.map((b) => (
                  <details key={b.key} className="bundle" data-testid="bundle">
                    <summary>
                      <span className="bundle-label"><strong>{b.label}</strong> <span className="num">· {b.tasks.length}</span></span>
                      <span className="small muted">{b.overdue ? <span style={{ color: "var(--danger)" }}>{b.overdue} überfällig</span> : b.next ? `nächste ${dueLabel(b.next, today)}` : "ohne Datum"}</span>
                      <Link className="btn btn-small" href={b.href}>Abarbeiten →</Link>
                    </summary>
                    <div>{b.tasks.map((t) => <TaskRow key={t.id} task={t} today={today} />)}</div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* Kennzahlen kompakt, Empfehlungen, Nachbestellen – rechnen länger, kommen nach (die Seite steht sofort). */}
          {(canAccess(session, "geld") || canAccess(session, "wawi")) && (
            <Suspense fallback={<div className="today-insights" aria-busy="true"><div className="skel skel-block" style={{ height: 180 }} /></div>}>
              <TodayInsights session={session} />
            </Suspense>
          )}

          <section className="card" data-testid="today-later">
            <details className="bundle">
              <summary><span className="bundle-label"><strong>Später</strong> <span className="num">· {plan.later.length}</span></span><span className="small muted">fällig in mehr als 7 Tagen</span></summary>
              <div>{plan.later.length ? plan.later.map((t) => <TaskRow key={t.id} task={t} today={today} />) : <div className="card-pad small muted">Nichts.</div>}</div>
            </details>
            <details className="bundle">
              <summary><span className="bundle-label"><strong>Ohne Datum</strong> <span className="num">· {plan.noDate.length}</span></span><span className="small muted">keine Fälligkeit</span></summary>
              <div>{plan.noDate.length ? plan.noDate.map((t) => <TaskRow key={t.id} task={t} today={today} />) : <div className="card-pad small muted">Nichts.</div>}</div>
            </details>
            <details className="bundle">
              <summary><span className="bundle-label"><strong>Ideen, Saison & Content</strong> <span className="num">· {plan.ideas.length}</span></span><span className="small muted">unverbindliche Vorschläge – zählen nicht als fällig</span></summary>
              <div>{plan.ideas.length ? plan.ideas.map((t) => <TaskRow key={t.id} task={t} today={today} idea />) : <div className="card-pad small muted">Nichts.</div>}</div>
            </details>
            <details className="bundle">
              <summary><span className="bundle-label"><strong>Zuletzt erledigt</strong> <span className="num">· {recentlyDone.length}</span></span></summary>
              <div>{recentlyDone.length ? recentlyDone.map((t) => <TaskRow key={t.id} task={t} today={today} />) : <div className="card-pad small muted">Noch nichts erledigt.</div>}</div>
            </details>
          </section>
        </div>

        <div className="col-side">
          {(prefs.favorites?.length ?? 0) > 0 && (
            <section className="card card-pad" data-testid="favorites">
              <h2 style={{ marginBottom: 10 }}>★ Favoriten</h2>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {prefs.favorites!.map((f) => <Link key={f.href} className="chip" href={f.href}>{f.label}</Link>)}
              </div>
            </section>
          )}

          {!restricted && (
            <section className="card card-pad" data-testid="appointments">
              <div className="between" style={{ marginBottom: 12 }}>
                <h2>Termine</h2>
                {calendarLink.n > 0 && calState?.lastSync && <span className="small muted">Kalender {new Date(calState.lastSync).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              {calendarLink.n === 0 ? (
                <div className="small muted">
                  Kalender verbinden (iCloud, Google, Outlook), dann stehen hier deine Termine.{" "}
                  {session.role === "owner" && <Link href="/anbindungen?p=apple_calendar#apple_calendar">Jetzt verbinden</Link>}
                </div>
              ) : calState?.lastError ? (
                <div className="small" style={{ color: "var(--danger)" }}>Kalender: {calState.lastError}</div>
              ) : shownAppointments.length === 0 ? (
                <div className="small muted">Keine Termine in den nächsten 7 Tagen{hidden.size ? " (ausgeblendete Kalender nicht mitgezählt)" : ""}{blockedCalendars ? " – private bzw. nicht freigegebene Kalender sind für dein Konto ausgeblendet" : ""}.</div>
              ) : (
                <div className="stack" style={{ fontSize: 13 }}>
                  {shownAppointments.map((a) => (
                    <div key={a.id} style={{ display: "flex", gap: 10 }}>
                      <span className="num" style={{ width: 64, flexShrink: 0 }}>{dueLabel(a.day, today)}</span>
                      <span style={{ minWidth: 0 }}>
                        <b className="cal-abbr" style={{ ["--c" as string]: calColors.get(a.calendarName), ["--t" as string]: textOn(calColors.get(a.calendarName)) }} title={a.calendarName}>{calAbbr.get(a.calendarName)}</b>
                        {!a.allDay && <span className="num muted">{timeOf(a.startsAt)} </span>}
                        {privatTermin(a.calendarName) ? <span className="muted" data-testid="termin-privat">{PRIVAT_BELEGT}</span> : a.title}
                        {a.location && !privatTermin(a.calendarName) && <span className="muted"> · {a.location}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {blockedCalendars > 0 && shownAppointments.length > 0 && <div className="small muted" style={{ marginTop: 8 }} data-testid="calendars-blocked">Private bzw. nicht freigegebene Kalender sind für dein Konto ausgeblendet.</div>}
              {calendars.length > 1 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }} data-testid="calendar-toggles">
                  {calendars.map((c) => (
                    <form key={c} action={toggleCalendarAction}>
                      <input type="hidden" name="calendar" value={c} />
                      <button type="submit" className={`chip${hidden.has(c) ? "" : " active"}`} aria-pressed={!(hidden.has(c))} title={hidden.has(c) ? "einblenden" : "ausblenden (z. B. private Kalender)"}><b className="cal-abbr" style={{ ["--c" as string]: calColors.get(c), ["--t" as string]: textOn(calColors.get(c)) }}>{calAbbr.get(c)}</b>{hidden.has(c) ? "＋ " : ""}{c}</button>
                    </form>
                  ))}
                </div>
              )}
            </section>
          )}

          {!restricted && (
            <section className="card card-pad" data-testid="data-stand">
              <h2 style={{ marginBottom: 10 }}>Datenstand</h2>
              {problems.length === 0 ? (
                <div className="small muted">Alle Berichte und Abrufe aktuell.</div>
              ) : (
                <div className="stack" style={{ gap: 6, fontSize: 13 }}>
                  {problems.slice(0, 8).map((a) => (
                    <Link key={a.key} href={a.href} className="between" style={{ textDecoration: "none", color: "inherit", gap: 8 }} data-testid="data-problem">
                      <span style={{ minWidth: 0 }}>{a.label}</span>
                      <span className={`tag ${a.error ? "tag-danger" : a.substitute ? "tag-info" : a.missing ? "tag-missing" : "tag-warn"}`} style={{ whiteSpace: "nowrap" }} title={a.error ?? (a.substitute ? `${a.substitute.label} – reicht für ${a.substitute.covers.join(", ")}` : undefined)} data-testid={a.substitute ? "data-problem-substitute" : undefined}>
                        {a.error ? "Fehler" : a.substitute ? `${a.missing ? "fehlt" : "veraltet"} · sellerboard ✓` : a.missing ? "fehlt" : `veraltet ${a.last!.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" })}`}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              <Link className="small" href="/import#datenstand" style={{ display: "inline-block", marginTop: 8 }}>Datenstand je Bereich →</Link>
            </section>
          )}

          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Schnellzugriff</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              <Link className="btn" href="/import">Daten importieren</Link>
              <Link className="btn" href="/produkte">Produkte</Link>
              <Link className="btn" href="/auftraege">Aufträge</Link>
              <Link className="btn" href="/wissen/neu">Wissen notieren</Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
