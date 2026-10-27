import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { careOverview, dateReminder, dateStats, intimStats, kidsOverview, nextSleeper, routineState, taskState, weekStart, addDays, type CareTask, type DateEntry, type DiaryEntry, type IntimEntry, type KidsEntry, type MoodEntry, type Routine, type SleepEntry, type TaskEntry } from "@/lib/private/logic";
import { INTIMATE_KINDS, itemsByDay } from "@/lib/private/kalender";
import { privateCalendar } from "@/lib/private/calendar-data";
import { loadEntries, myMedPlan, myPartner, requirePrivate } from "@/lib/private/service";
import { toggleTaskAction } from "./actions";
import { IntakeCard } from "./intake";
import { ItemChip, StatusButtons } from "./kalender/items";
import { WhoAmI } from "./who-am-i";
import { PrivatHead, dm, dmy, hoursLabel, monthLabel, weekday } from "./ui";

/** Zeile „zu erledigen“: Bereich, Stand in Worten, Link zum Bereich. */
function TodayRow({ icon, label, state, tone = "muted", href, testid, children }: { icon: string; label: string; state: string; tone?: "ok" | "warn" | "muted"; href: string; testid?: string; children?: React.ReactNode }) {
  return (
    <li className="today-row" data-testid={testid}>
      <Link href={href} className="today-link">
        <span aria-hidden="true">{icon}</span>
        <span className="today-label">{label}</span>
        <span className={`today-state today-${tone}`}>{state}</span>
      </Link>
      {children}
    </li>
  );
}

/**
 * Privat-Startseite: nur „Heute“, „Diese Woche“ und ein zentraler Knopf „Eintragen“. Monatszahlen und
 * Erklärungen eingeklappt darunter. Alles kommt aus dem gemeinsamen Privatkalender.
 */
export default async function PrivatStartPage({ searchParams }: { searchParams: Promise<{ nurfamilie?: string }> }) {
  const session = await requirePrivate();
  const today = todayIso();
  const month = today.slice(0, 7);
  const family = session.privateScope === "familie";
  const blocked = (await searchParams).nurfamilie === "1";
  const wFrom = weekStart(today);
  const wTo = addDays(wFrom, 6);
  const cal = await privateCalendar(session, wFrom, wTo, today);
  const s = cal.settings;
  const items = cal.items.filter((i) => !family || !INTIMATE_KINDS.has(i.kind));
  const byDay = itemsByDay(items, wFrom, wTo);
  const todays = byDay.get(today) ?? [];
  // Vergangene, noch geplante Einträge dieser Woche: bestätigen oder als ausgefallen markieren.
  const open = items.filter((i) => i.status === "geplant" && i.day < today);

  const [intim, kids, tasks, diary, dates, sleep, timeout, routines, care, moods, med] = await Promise.all([
    loadEntries<IntimEntry>(session, ["intim"]),
    loadEntries<KidsEntry>(session, ["kinder"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
    loadEntries<DiaryEntry>(session, ["tagebuch"]),
    loadEntries<DateEntry>(session, ["paarzeit"]),
    loadEntries<SleepEntry>(session, ["ausschlafen"]),
    loadEntries<SleepEntry>(session, ["auszeit"]),
    loadEntries<Routine>(session, ["routine"]),
    loadEntries<CareTask>(session, ["zustaendig"]),
    loadEntries<MoodEntry>(session, ["stimmung"]),
    family ? Promise.resolve(null) : myMedPlan(session),
  ]);
  const myRoutines = routines.filter((r) => r.userId === session.userId);
  const routinesOpen = myRoutines.filter((r) => !routineState(r.data, today).doneToday);
  const careDue = careOverview(care.map((e) => e.data), today).due.filter((t) => t.next! <= today);
  const moodDone = moods.some((e) => e.userId === session.userId && e.data.day === today);
  const myDiary = diary.filter((e) => e.userId === session.userId);
  const todayEntry = myDiary.find((e) => e.data.day === today)?.data;
  const usesDiary = myDiary.length > 0 || Boolean(med?.id);
  const rated = Boolean(todayEntry && (todayEntry.focus || todayEntry.mood || todayEntry.sleepQuality || todayEntry.note || todayEntry.sideEffects?.length));
  const openTasks = tasks.filter((t) => taskState(t.data, today).open).sort((a, b) => (a.data.repeat === "einmal" ? 1 : 0) - (b.data.repeat === "einmal" ? 1 : 0));
  const ds = dateStats(dates.map((e) => e.data), month, today);
  const remind = family ? null : dateReminder(ds.last, today, s.dateReminderDays);
  // Monatszahlen (eingeklappt): nur Stattgefundenes.
  const stats = intimStats(intim.map((e) => e.data), month, today);
  const ko = kidsOverview(kids.map((e) => e.data), month);
  const so = kidsOverview(sleep.map((e) => e.data), month);
  const to = kidsOverview(timeout.map((e) => e.data), month);
  const nextSleep = nextSleeper(sleep.map((e) => ({ ...e.data, at: e.createdAt.getTime() })));
  const pair = (t: { a: { count: number; hours: number }; b: { count: number; hours: number } }, unit: "h" | "x") =>
    t.a.count + t.b.count ? `${s.partners.a} ${t.a.count ? (unit === "h" ? hoursLabel(t.a.hours) : `${t.a.count}×`) : "–"} · ${s.partners.b} ${t.b.count ? (unit === "h" ? hoursLabel(t.b.hours) : `${t.b.count}×`) : "–"}` : null;

  return (
    <>
      <PrivatHead active="start" title={`${weekday(today)}, ${dmy(today)}`} sub={<Link className="big-add" href="/privat/eintragen" data-testid="start-add">＋ Eintragen</Link>} />
      {!myPartner(s, session) && <WhoAmI partners={s.partners} account={session.name ?? session.email} tenantId={session.tenantId} userId={session.userId} userPartner={s.userPartner} />}
      {blocked && <div className="notice notice-info small">Diese Ansicht gehört zu Partnerschaft oder Gesundheit – dein Zugang umfasst nur die Familieninfos.</div>}

      <section className="card card-pad stack" data-testid="today">
        <h2>Heute</h2>
        {todays.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Im Privatkalender steht heute nichts.</p>
        ) : (
          <ul className="pk-list">
            {todays.map((i) => (
              <li key={i.key}>
                <ItemChip item={i} />
                <StatusButtons item={i} today={today} />
              </li>
            ))}
          </ul>
        )}
        {cal.rhythm && !family && (
          <div className="small" data-testid="today-rhythm">
            <strong>{cal.ritual?.data.title}:</strong> {cal.rhythm.count}/{cal.rhythm.target} Streicheleinheiten seit der letzten Massage{cal.rhythm.due ? " – Massage ist dran" : ""} <span className="muted">(nur Bestätigtes)</span>
          </div>
        )}
        <ul className="today-list">
          {usesDiary && <TodayRow icon="📓" label="ADHS-Tagebuch" href="/privat/tagebuch" testid="today-diary" tone={rated ? "ok" : "warn"} state={rated ? "heute eingetragen" : todayEntry ? "Einnahme erfasst, Tag noch nicht bewertet" : "heute nicht erfasst"} />}
          {myRoutines.length > 0 && <TodayRow icon="✅" label="Routinen" href="/privat/routinen" testid="today-routines" tone={routinesOpen.length ? "warn" : "ok"} state={routinesOpen.length ? `offen: ${routinesOpen.map((r) => `${r.data.title} (${routineState(r.data, today).today.length}/${r.data.items.length})`).join(", ")}` : "heute komplett"} />}
          {!family && (
            <TodayRow icon="☑️" label="Aufgaben" href="/privat/aufgaben" testid="today-tasks" tone={openTasks.length ? "warn" : "ok"} state={openTasks.length ? `${openTasks.length} offen` : "Keine offenen Aufgaben"}>
              {openTasks.length > 0 && (
                <div className="stack" style={{ gap: 4, margin: "4px 0 0 28px" }}>
                  {openTasks.slice(0, 4).map((t) => (
                    <form key={t.id} action={toggleTaskAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn btn-small" type="submit" aria-label={`${t.data.title} abhaken`}>○</button>
                      <span className="small">{t.data.title}<span className="muted"> · {t.data.repeat === "taeglich" ? "heute" : t.data.repeat === "woechentlich" ? "diese Woche" : t.data.due ? `bis ${dmy(t.data.due)}` : "offen"}</span></span>
                    </form>
                  ))}
                </div>
              )}
            </TodayRow>
          )}
          {careDue.length > 0 && <TodayRow icon="👨‍👩‍👧" label="Familie fällig" href="/privat/familie" testid="today-care" tone="warn" state={careDue.map((t) => t.title).join(", ")} />}
          {!family && <TodayRow icon="💬" label="Paar-Stimmung" href="/privat/paar/wertschaetzung#stimmung" testid="today-mood" tone={moodDone ? "ok" : "muted"} state={moodDone ? "heute eingetragen" : "heute nicht erfasst"} />}
          {remind !== null && <TodayRow icon="🥂" label="Paarzeit" href="/privat/paar/paarzeit#ideen" state={`letztes Date vor ${remind} Tagen`} />}
        </ul>
        {!family && <IntakeCard session={session} />}
      </section>

      <section className="card card-pad stack" data-testid="week">
        <div className="between">
          <h2>Diese Woche</h2>
          <Link className="small" href="/privat/kalender">Kalender öffnen →</Link>
        </div>
        {open.length > 0 && (
          <div className="notice notice-warn small" data-testid="week-open">
            {open.length} geplante{open.length === 1 ? "r Eintrag" : " Einträge"} aus den letzten Tagen noch nicht bestätigt – zählt erst nach „stattgefunden“.
          </div>
        )}
        <ul className="pk-list">
          {Array.from({ length: 7 }, (_, k) => addDays(wFrom, k)).map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <li key={d} data-testid={`week-${d}`} style={d < today ? { opacity: 0.75 } : undefined}>
                <div className="pk-row">
                  <Link href={`/privat/kalender?ansicht=tag&tag=${d}`} className="small" style={{ fontWeight: d === today ? 700 : 600, color: "inherit" }}>{weekday(d)} {dm(d)}{d === today ? " · heute" : ""}</Link>
                  <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                    {list.length === 0 ? <span className="small muted">–</span> : list.map((i) => <ItemChip key={`${i.key}:${d}`} item={i} />)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <details className="card card-pad" data-testid="month-stats">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>{monthLabel(month)} – Monatsübersicht</summary>
        <div className="grid-kpi" style={{ marginTop: 12 }}>
          {!family && (
            <Link href="/privat/paar" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="kpi-label">Nähe</div>
              <div className="kpi-value">{stats.inMonth ? `${stats.inMonth}×` : <span className="muted">nicht erfasst</span>}</div>
              <div className="small muted">{stats.daysSinceLast === null ? "noch nichts eingetragen" : stats.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${stats.daysSinceLast} Tagen`}</div>
            </Link>
          )}
          {!family && (
            <Link href="/privat/paar/paarzeit" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-dates">
              <div className="kpi-label">🥂 Paarzeit</div>
              <div className="kpi-value">{ds.inMonth ? `${ds.inMonth}×` : <span className="muted">nicht erfasst</span>}</div>
              <div className="small muted">{ds.daysSinceLast === null ? "noch kein Date eingetragen" : ds.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${ds.daysSinceLast} Tagen`}</div>
            </Link>
          )}
          <Link href="/privat/kinder" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-kids">
            <div className="kpi-label">Kinderzeit</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>{pair(ko.totals, "h") ?? <span className="muted">nicht erfasst</span>}</div>
            {ko.planned.a + ko.planned.b > 0 && <div className="small muted">dazu {ko.planned.a + ko.planned.b} geplant (zählt noch nicht)</div>}
          </Link>
          <Link href="/privat/ausschlafen" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-sleep">
            <div className="kpi-label">😴 Ausschlafen</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>{pair(so.totals, "x") ?? <span className="muted">nicht erfasst</span>}</div>
            <div className="small muted">{nextSleep ? `im Wechsel als Nächstes: ${s.partners[nextSleep]}` : "noch nichts eingetragen"}</div>
          </Link>
          <Link href="/privat/auszeit" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-timeout">
            <div className="kpi-label">Auszeit</div>
            <div className="kpi-value" style={{ fontSize: 18 }}>{pair(to.totals, "x") ?? <span className="muted">nicht erfasst</span>}</div>
          </Link>
        </div>
      </details>

      <details className="small" data-testid="start-help">
        <summary style={{ cursor: "pointer" }}>Erklärungen</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li>Gestrichelt = geplant (zählt in keiner Auswertung), gefüllt = stattgefunden, durchgestrichen = ausgefallen.</li>
          <li>„nicht erfasst“ heißt: nichts eingetragen – nicht „keine Zeit gehabt“.</li>
          <li>Termin aus dem Familienkalender antippen („übernehmen ›“) → als Paarzeit, Kinderzeit (auch „beide zusammen“), Auszeit … übernehmen. Tag, Uhrzeit und Titel sind schon eingetragen; danach steht er nur noch als diese Art im Privatkalender.</li>
          <li>Private Einträge gehen nie automatisch in einen geschäftlichen oder geteilten Kalender.</li>
          {!family && <li><Link href="/privat/wissen">Wichtig in der Einstellungsphase & Warnzeichen →</Link></li>}
          {!session.privatePin && <li>Tipp: Unter <Link href="/privat/einstellungen">Einstellungen</Link> eine PIN setzen – dann fragt „Privat“ zusätzlich danach.</li>}
        </ul>
      </details>
    </>
  );
}
