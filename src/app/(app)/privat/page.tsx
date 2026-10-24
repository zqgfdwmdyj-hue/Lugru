import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { careOverview, dateReminder, dateStats, intimStats, kidsOverview, nextSleeper, routineState, taskState, type AppointmentEntry, type CareTask, type DateEntry, type DiaryEntry, type IntimEntry, type KidsEntry, type MoodEntry, type Routine, type SleepEntry, type TaskEntry } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { toggleTaskAction } from "./actions";
import { IntakeCard } from "./intake";
import { PrivatHead, dmy, hoursLabel, monthLabel, weekday } from "./ui";

export default async function PrivatStartPage() {
  const session = await requirePrivate();
  const today = todayIso();
  const month = today.slice(0, 7);
  const s = await privateSettings(session.tenantId);
  const [intim, kids, tasks, appts, diary, dates, sleep] = await Promise.all([
    loadEntries<IntimEntry>(session, ["intim"]),
    loadEntries<KidsEntry>(session, ["kinder"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
    loadEntries<AppointmentEntry>(session, ["termin"]),
    loadEntries<DiaryEntry>(session, ["tagebuch"]),
    loadEntries<DateEntry>(session, ["paarzeit"]),
    loadEntries<SleepEntry>(session, ["ausschlafen"]),
  ]);
  const [routines, care, moods] = await Promise.all([
    loadEntries<Routine>(session, ["routine"]),
    loadEntries<CareTask>(session, ["zustaendig"]),
    loadEntries<MoodEntry>(session, ["stimmung"]),
  ]);
  const routinesOpen = routines.filter((r) => r.userId === session.userId && !routineState(r.data, today).doneToday);
  const careDue = careOverview(care.map((e) => e.data), today).due.filter((t) => t.next! <= today);
  const moodDone = moods.some((e) => e.userId === session.userId && e.data.day === today);
  const so = kidsOverview(sleep.map((e) => e.data), month);
  const nextSleep = nextSleeper(sleep.map((e) => ({ ...e.data, at: e.createdAt.getTime() })), month);
  const ds = dateStats(dates.map((e) => e.data), month, today);
  const remind = dateReminder(ds.last, today, s.dateReminderDays);
  const myDiary = diary.filter((e) => e.userId === session.userId);
  const todayEntry = myDiary.find((e) => e.data.day === today)?.data;
  const stats = intimStats(intim.map((e) => e.data), month, today);
  const ov = kidsOverview(kids.map((e) => e.data), month);
  const openTasks = tasks.filter((t) => taskState(t.data, today).open).sort((a, b) => (a.data.repeat === "einmal" ? 1 : 0) - (b.data.repeat === "einmal" ? 1 : 0));
  const next = appts.filter((a) => a.data.day >= today).sort((a, b) => a.data.day.localeCompare(b.data.day) || (a.data.time ?? "").localeCompare(b.data.time ?? "")).slice(0, 3);
  const withLabel = (w: AppointmentEntry["with"]) => (w === "ads" ? s.therapists.ads : w === "paar" ? s.therapists.paar : w === "arzt" ? "Arzt/Ärztin" : "Termin");

  return (
    <>
      <PrivatHead active="start" title="Privat" pin={session.privatePin} />
      {!session.privatePin && (
        <div className="notice notice-info small">Tipp: Unter <Link href="/privat/einstellungen">Einstellungen</Link> eine PIN setzen – dann fragt „Privat“ zusätzlich danach.</div>
      )}

      <IntakeCard session={session} />
      {(remind !== null || routinesOpen.length > 0 || careDue.length > 0 || !moodDone) && (
        <div className="stack" style={{ gap: 6 }} data-testid="ov-reminders">
          {routinesOpen.length > 0 && <Link className="notice notice-info small" href="/privat/routinen" style={{ textDecoration: "none", color: "inherit" }}>✅ Heute noch offen: {routinesOpen.map((r) => r.data.title).join(", ")}</Link>}
          {careDue.length > 0 && <Link className="notice notice-warn small" href="/privat/familie" style={{ textDecoration: "none", color: "inherit" }}>👨‍👩‍👧 Fällig: {careDue.map((t) => t.title).join(", ")}</Link>}
          {remind !== null && <Link className="notice notice-info small" href="/privat/paar#ideen" style={{ textDecoration: "none", color: "inherit" }}>🥂 Euer letztes Date ist {remind} Tage her – Zeit für das nächste?</Link>}
          {!moodDone && <Link className="notice notice-info small" href="/privat/paar#stimmung" style={{ textDecoration: "none", color: "inherit" }}>Wie geht’s euch heute als Paar? Kurz 1–5 eintragen.</Link>}
        </div>
      )}

      <div className="grid-kpi">
        <Link href="/privat/tagebuch" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-diary">
          <div className="kpi-label">ADHS-Tagebuch heute</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>{todayEntry ? "✓ eingetragen" : "noch offen"}</div>
          <div className="small muted">{todayEntry ? [todayEntry.doseMg !== undefined ? `${String(todayEntry.doseMg).replace(".", ",")} mg` : "", todayEntry.focus ? `Konzentration ${todayEntry.focus}/5` : ""].filter(Boolean).join(" · ") || "gespeichert" : "kurz eintragen – dauert 1 Minute"}</div>
        </Link>
        <Link href="/privat/paar" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="kpi-label">Paar · {monthLabel(month)}</div>
          <div className="kpi-value">{stats.inMonth}×</div>
          <div className="small muted">{stats.daysSinceLast === null ? "noch nichts eingetragen" : stats.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${stats.daysSinceLast} Tagen`}</div>
        </Link>
        <Link href="/privat/paar#paarzeit" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-dates">
          <div className="kpi-label">🥂 Paarzeit · {monthLabel(month)}</div>
          <div className="kpi-value">{ds.inMonth}×</div>
          <div className="small muted">{ds.daysSinceLast === null ? "noch kein Date eingetragen" : ds.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${ds.daysSinceLast} Tagen`}</div>
        </Link>
        <Link href="/privat/ausschlafen" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }} data-testid="ov-sleep">
          <div className="kpi-label">😴 Ausschlafen · {monthLabel(month)}</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.a} {so.totals.a.count}× · {s.partners.b} {so.totals.b.count}×</div>
          <div className="small muted">{nextSleep ? `als Nächstes: ${s.partners[nextSleep]}` : "noch nichts eingetragen"}</div>
        </Link>
        <Link href="/privat/kinder" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="kpi-label">Kinderzeit · {monthLabel(month)}</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.a} {hoursLabel(ov.totals.a.hours)}</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{s.partners.b} {hoursLabel(ov.totals.b.hours)}</div>
        </Link>
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card card-pad stack" style={{ flex: 1, minWidth: 260 }}>
          <h2>Heute zu tun ({openTasks.length})</h2>
          {openTasks.length === 0 ? <div className="small muted">Alles erledigt.</div> : (
            <div className="stack" style={{ gap: 6 }}>
              {openTasks.slice(0, 8).map((t) => (
                <form key={t.id} action={toggleTaskAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="btn btn-small" type="submit" aria-label={`${t.data.title} abhaken`}>○</button>
                  <span className="small">{t.data.title}<span className="muted"> · {t.data.repeat === "taeglich" ? "heute" : t.data.repeat === "woechentlich" ? "diese Woche" : t.data.due ? `bis ${dmy(t.data.due)}` : "offen"}</span></span>
                </form>
              ))}
            </div>
          )}
          <Link className="small" href="/privat/aufgaben">Alle Aufgaben & neue anlegen →</Link>
        </section>
        <section className="card card-pad stack" style={{ flex: 1, minWidth: 260 }}>
          <h2>Nächste Termine</h2>
          {next.length === 0 ? <div className="small muted">Kein Termin eingetragen.</div> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {next.map((a) => <li key={a.id} className="small"><strong>{weekday(a.data.day)} {dmy(a.data.day)}{a.data.time ? ` ${a.data.time}` : ""}</strong> · {withLabel(a.data.with)}</li>)}
            </ul>
          )}
          <Link className="small" href="/privat/aufgaben#termine">Termin eintragen →</Link>
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
          <Link className="small" href="/privat/wissen">Wichtig in der Einstellungsphase & Warnzeichen →</Link>
        </section>
      </div>
    </>
  );
}
