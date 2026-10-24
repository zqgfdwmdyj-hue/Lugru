import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays, careOverview, dateReminder, dateStats, intimStats, kidsOverview, nextSleeper, routineState, taskState, type AppointmentEntry, type CareTask, type DateEntry, type DiaryEntry, type IntimEntry, type KidsEntry, type MoodEntry, type PrivateSettings, type Routine, type SleepEntry, type TaskEntry } from "@/lib/private/logic";
import type { Session } from "@/lib/auth/session";
import { loadEntries, myMedPlan, myPartner, privateSettings, requirePrivate } from "@/lib/private/service";
import { toggleTaskAction } from "./actions";
import { IntakeCard } from "./intake";
import { QuickEntry } from "./quick-entry";
import { PrivatHead, dm, dmy, hoursLabel, monthLabel, weekday } from "./ui";

/** Zeile der Tagesübersicht: Bereich, Stand in Worten, Link zum Bereich. */
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

export default async function PrivatStartPage({ searchParams }: { searchParams: Promise<{ nurfamilie?: string }> }) {
  const session = await requirePrivate();
  const today = todayIso();
  const month = today.slice(0, 7);
  const s = await privateSettings(session.tenantId);
  if (session.privateScope === "familie") return <FamilyOverview session={session} settings={s} today={today} blocked={(await searchParams).nurfamilie === "1"} />;
  const [intim, kids, tasks, appts, diary, dates, sleep, routines, care, moods, med] = await Promise.all([
    loadEntries<IntimEntry>(session, ["intim"]),
    loadEntries<KidsEntry>(session, ["kinder"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
    loadEntries<AppointmentEntry>(session, ["termin"]),
    loadEntries<DiaryEntry>(session, ["tagebuch"]),
    loadEntries<DateEntry>(session, ["paarzeit"]),
    loadEntries<SleepEntry>(session, ["ausschlafen"]),
    loadEntries<Routine>(session, ["routine"]),
    loadEntries<CareTask>(session, ["zustaendig"]),
    loadEntries<MoodEntry>(session, ["stimmung"]),
    myMedPlan(session),
  ]);
  const myRoutines = routines.filter((r) => r.userId === session.userId);
  const routinesOpen = myRoutines.filter((r) => !routineState(r.data, today).doneToday);
  const careDue = careOverview(care.map((e) => e.data), today).due.filter((t) => t.next! <= today);
  const moodDone = moods.some((e) => e.userId === session.userId && e.data.day === today);
  const so = kidsOverview(sleep.map((e) => e.data), month);
  const nextSleep = nextSleeper(sleep.map((e) => ({ ...e.data, at: e.createdAt.getTime() })));
  const ds = dateStats(dates.map((e) => e.data), month, today);
  const remind = dateReminder(ds.last, today, s.dateReminderDays);
  const myDiary = diary.filter((e) => e.userId === session.userId);
  const todayEntry = myDiary.find((e) => e.data.day === today)?.data;
  const usesDiary = myDiary.length > 0 || Boolean(med.id);
  const rated = Boolean(todayEntry && (todayEntry.focus || todayEntry.mood || todayEntry.sleepQuality || todayEntry.note || todayEntry.sideEffects?.length));
  const stats = intimStats(intim.map((e) => e.data), month, today);
  const ov = kidsOverview(kids.map((e) => e.data), month);
  const openTasks = tasks.filter((t) => taskState(t.data, today).open).sort((a, b) => (a.data.repeat === "einmal" ? 1 : 0) - (b.data.repeat === "einmal" ? 1 : 0));
  const week = addDays(today, 7);
  const next = appts.filter((a) => a.data.day >= today && a.data.day <= week).sort((a, b) => a.data.day.localeCompare(b.data.day) || (a.data.time ?? "").localeCompare(b.data.time ?? ""));
  const withLabel = (w: AppointmentEntry["with"]) => (w === "ads" ? s.therapists.ads : w === "paar" ? s.therapists.paar : w === "arzt" ? "Arzt/Ärztin" : "Termin");

  return (
    <>
      <PrivatHead active="start" title="Heute" pin={session.privatePin} />
      {!session.privatePin && (
        <div className="notice notice-info small">Tipp: Unter <Link href="/privat/einstellungen">Einstellungen</Link> eine PIN setzen – dann fragt „Privat“ zusätzlich danach.</div>
      )}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card card-pad stack" style={{ flex: "1 1 320px", minWidth: 0 }} data-testid="today">
          <h2>{weekday(today)}, {dmy(today)}</h2>
          <ul className="today-list">
            {usesDiary && (
              <TodayRow icon="📓" label="ADHS-Tagebuch" href="/privat/tagebuch" testid="today-diary" tone={rated ? "ok" : "warn"} state={rated ? "heute eingetragen" : todayEntry ? "Einnahme erfasst, Tag noch nicht bewertet" : "heute nicht erfasst"} />
            )}
            {myRoutines.length > 0 && (
              <TodayRow icon="✅" label="Routinen" href="/privat/routinen" testid="today-routines" tone={routinesOpen.length ? "warn" : "ok"} state={routinesOpen.length ? `offen: ${routinesOpen.map((r) => `${r.data.title} (${routineState(r.data, today).today.length}/${r.data.items.length})`).join(", ")}` : "heute komplett"} />
            )}
            <TodayRow icon="☑️" label="Aufgaben" href="/privat/aufgaben" testid="today-tasks" tone={openTasks.length ? "warn" : "ok"} state={openTasks.length ? `${openTasks.length} offen` : "Keine offenen Aufgaben"}>
              {openTasks.length > 0 && (
                <div className="stack" style={{ gap: 4, margin: "4px 0 0 28px" }}>
                  {openTasks.slice(0, 6).map((t) => (
                    <form key={t.id} action={toggleTaskAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn btn-small" type="submit" aria-label={`${t.data.title} abhaken`}>○</button>
                      <span className="small">{t.data.title}<span className="muted"> · {t.data.repeat === "taeglich" ? "heute" : t.data.repeat === "woechentlich" ? "diese Woche" : t.data.due ? `bis ${dmy(t.data.due)}` : "offen"}</span></span>
                    </form>
                  ))}
                </div>
              )}
            </TodayRow>
            <TodayRow icon="📅" label="Termine (7 Tage)" href="/privat/aufgaben#termine" testid="today-appts" state={next.length ? next.slice(0, 3).map((a) => `${a.data.day === today ? "heute" : `${weekday(a.data.day)} ${dm(a.data.day)}`}${a.data.time ? ` ${a.data.time}` : ""} · ${withLabel(a.data.with)}`).join(" · ") : "Keine Termine in den nächsten 7 Tagen"} tone={next.some((a) => a.data.day === today) ? "warn" : "muted"} />
            {careDue.length > 0 && <TodayRow icon="👨‍👩‍👧" label="Familie fällig" href="/privat/familie" testid="today-care" tone="warn" state={careDue.map((t) => t.title).join(", ")} />}
            <TodayRow icon="💬" label="Paar-Stimmung" href="/privat/paar/wertschaetzung#stimmung" testid="today-mood" tone={moodDone ? "ok" : "muted"} state={moodDone ? "heute eingetragen" : "heute nicht erfasst"} />
            {remind !== null && <TodayRow icon="🥂" label="Paarzeit" href="/privat/paar/paarzeit#ideen" state={`letztes Date vor ${remind} Tagen`} />}
          </ul>
        </section>
        <div className="stack" style={{ flex: "1 1 320px", minWidth: 0 }}>
          <IntakeCard session={session} />
          <section className="card card-pad stack">
            <h2>Schnell eintragen</h2>
            <QuickEntry kinds={["kinder", "ausschlafen", "auszeit", "paarzeit", "intim"]} partners={s.partners} me={myPartner(s, session)} today={today} yesterday={addDays(today, -1)} wakeTime={s.wakeTime} />
          </section>
        </div>
      </div>

      <h2 style={{ margin: "6px 0 0" }}>{monthLabel(month)} – erfasst</h2>
      <div className="grid-kpi">
        <Link href="/privat/paar" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="kpi-label">Nähe</div>
          <div className="kpi-value">{stats.inMonth ? `${stats.inMonth}×` : <span className="muted" style={{ fontSize: 18 }}>nicht erfasst</span>}</div>
          <div className="small muted">{stats.daysSinceLast === null ? "noch nichts eingetragen" : stats.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${stats.daysSinceLast} Tagen`}</div>
        </Link>
        <Link href="/privat/paar/paarzeit" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-dates">
          <div className="kpi-label">🥂 Paarzeit</div>
          <div className="kpi-value">{ds.inMonth ? `${ds.inMonth}×` : <span className="muted" style={{ fontSize: 18 }}>nicht erfasst</span>}</div>
          <div className="small muted">{ds.daysSinceLast === null ? "noch kein Date eingetragen" : ds.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${ds.daysSinceLast} Tagen`}</div>
        </Link>
        <Link href="/privat/ausschlafen" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-sleep">
          <div className="kpi-label">😴 Ausschlafen</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{so.totals.a.count + so.totals.b.count ? `${s.partners.a} ${so.totals.a.count}× · ${s.partners.b} ${so.totals.b.count}×` : <span className="muted" style={{ fontSize: 18 }}>nicht erfasst</span>}</div>
          <div className="small muted">{nextSleep ? `im Wechsel als Nächstes: ${s.partners[nextSleep]}` : "noch nichts eingetragen"}</div>
        </Link>
        <Link href="/privat/kinder" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="kpi-label">Kinderzeit</div>
          {ov.totals.a.count + ov.totals.b.count ? (
            <>
              <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.a} {ov.totals.a.count ? hoursLabel(ov.totals.a.hours) : "–"}</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.b} {ov.totals.b.count ? hoursLabel(ov.totals.b.hours) : "–"}</div>
            </>
          ) : <div className="kpi-value muted" style={{ fontSize: 18 }}>nicht erfasst</div>}
        </Link>
      </div>
      <div className="small muted">„nicht erfasst“ heißt: nichts eingetragen – nicht „keine Zeit gehabt“.</div>
      <div className="small"><Link href="/privat/wissen">Wichtig in der Einstellungsphase & Warnzeichen →</Link></div>
    </>
  );
}

/** Übersicht für Umfang „nur Familie“: Kinderzeit, Ausschlafen, Auszeit, Zuständigkeiten – sonst nichts. */
async function FamilyOverview({ session, settings: s, today, blocked }: { session: Session; settings: PrivateSettings; today: string; blocked: boolean }) {
  const month = today.slice(0, 7);
  const [kids, sleep, timeout, care] = await Promise.all([
    loadEntries<KidsEntry>(session, ["kinder"]),
    loadEntries<SleepEntry>(session, ["ausschlafen"]),
    loadEntries<SleepEntry>(session, ["auszeit"]),
    loadEntries<CareTask>(session, ["zustaendig"]),
  ]);
  const ko = kidsOverview(kids.map((e) => e.data), month);
  const so = kidsOverview(sleep.map((e) => e.data), month);
  const to = kidsOverview(timeout.map((e) => e.data), month);
  const due = careOverview(care.map((e) => e.data), today).due;
  const Card = ({ href, label, a, b, recorded, testid }: { href: string; label: string; a: string; b: string; recorded: boolean; testid?: string }) => (
    <Link href={href} className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid={testid}>
      <div className="kpi-label">{label} · {monthLabel(month)}</div>
      {recorded ? (
        <>
          <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.a} {a}</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.b} {b}</div>
        </>
      ) : <div className="kpi-value muted" style={{ fontSize: 18 }}>nicht erfasst</div>}
    </Link>
  );
  const c = (t: { count: number; hours: number }, unit: "h" | "x") => (t.count ? (unit === "h" ? hoursLabel(t.hours) : `${t.count}×`) : "–");
  return (
    <>
      <PrivatHead active="start" title="Privat · Familie" pin={session.privatePin} />
      {blocked && <div className="notice notice-info small">Diese Ansicht gehört zu Partnerschaft oder Gesundheit – dein Zugang umfasst nur die Familieninfos.</div>}
      <section className="card card-pad stack">
        <h2>Schnell eintragen</h2>
        <QuickEntry kinds={["kinder", "ausschlafen", "auszeit"]} partners={s.partners} me={myPartner(s, session)} today={today} yesterday={addDays(today, -1)} wakeTime={s.wakeTime} />
      </section>
      <div className="grid-kpi">
        <Card href="/privat/kinder" label="Kinderzeit" a={c(ko.totals.a, "h")} b={c(ko.totals.b, "h")} recorded={ko.totals.a.count + ko.totals.b.count > 0} />
        <Card href="/privat/ausschlafen" label="😴 Ausschlafen" a={c(so.totals.a, "x")} b={c(so.totals.b, "x")} recorded={so.totals.a.count + so.totals.b.count > 0} />
        <Card href="/privat/auszeit" label="Auszeit" a={c(to.totals.a, "x")} b={c(to.totals.b, "x")} recorded={to.totals.a.count + to.totals.b.count > 0} />
      </div>
      <section className="card card-pad stack">
        <h2>Wer kümmert sich – demnächst</h2>
        {due.length === 0 ? <div className="small muted">Nichts fällig in den nächsten 7 Tagen.</div> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>{due.map((t) => <li key={t.title} className="small">{t.title}{t.next ? ` · ${dmy(t.next)}` : ""}</li>)}</ul>
        )}
        <Link className="small" href="/privat/familie">Alle Zuständigkeiten →</Link>
      </section>
    </>
  );
}
