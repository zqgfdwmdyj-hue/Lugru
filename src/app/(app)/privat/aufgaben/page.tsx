import { todayIso } from "@/lib/dates";
import { sinceSummary, taskState, type AppointmentEntry, type DateEntry, type IntimEntry, type KidsEntry, type SleepEntry, type TaskEntry } from "@/lib/private/logic";
import { loadEntries, myPartner, privateSettings, requirePrivate, type Entry } from "@/lib/private/service";
import { addAppointmentAction, addTaskAction, deleteEntryAction, saveAppointmentNotesAction, saveTaskNoteAction, toggleTaskAction } from "../actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead, dm, dmy, hoursLabel, weekday } from "../ui";

export default async function AufgabenPage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const s = await privateSettings(session.tenantId);
  const me = myPartner(s, session);
  const tasks = await loadEntries<TaskEntry>(session, ["aufgabe"]);
  const appts = (await loadEntries<AppointmentEntry>(session, ["termin"])).sort((a, b) => a.data.day.localeCompare(b.data.day) || (a.data.time ?? "").localeCompare(b.data.time ?? ""));
  const intim = await loadEntries<IntimEntry>(session, ["intim"]);
  const kids = await loadEntries<KidsEntry>(session, ["kinder"]);
  const dates = await loadEntries<DateEntry>(session, ["paarzeit"]);
  const sleep = await loadEntries<SleepEntry>(session, ["ausschlafen"]);
  const src = { ads: s.therapists.ads, paar: s.therapists.paar, sonst: "sonstige" } as const;
  const forLabel = (f: TaskEntry["forWhom"]) => (f === "a" ? s.partners.a : f === "b" ? s.partners.b : "beide");
  const withLabel = (w: AppointmentEntry["with"]) => (w === "ads" ? s.therapists.ads : w === "paar" ? s.therapists.paar : w === "arzt" ? "Arzt/Ärztin" : "sonstiger Termin");

  const recurring = tasks.filter((t) => t.data.repeat !== "einmal" && !t.data.done);
  const open = tasks.filter((t) => t.data.repeat === "einmal" && !t.data.done).sort((a, b) => (a.data.due ?? "9999").localeCompare(b.data.due ?? "9999"));
  const doneList = tasks.filter((t) => t.data.done).sort((a, b) => (b.data.doneAt ?? "").localeCompare(a.data.doneAt ?? ""));
  const upcoming = appts.filter((a) => a.data.day >= today);
  const past = appts.filter((a) => a.data.day < today).reverse();
  const lastPaar = past.find((a) => a.data.with === "paar")?.data.day;
  const prep = lastPaar ? sinceSummary({ since: lastPaar, today, intim: intim.map((e) => e.data), kids: kids.map((e) => e.data), tasks: tasks.map((e) => e.data), dates: dates.map((e) => e.data), sleep: sleep.map((e) => e.data) }) : null;

  const TaskItem = ({ t }: { t: Entry<TaskEntry> }) => {
    const st = taskState(t.data, today);
    return (
      <div className="card card-pad stack" style={{ gap: 6, padding: 12 }} data-testid="priv-task">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <form action={toggleTaskAction}>
            <input type="hidden" name="id" value={t.id} />
            <button className={`btn btn-small${st.doneNow ? " btn-primary" : ""}`} type="submit" aria-pressed={st.doneNow} title={t.data.repeat === "einmal" ? "erledigt / wieder offen" : "für heute abhaken / zurücknehmen"} style={{ minWidth: 40 }}>
              {st.doneNow ? "✓" : "○"}
            </button>
          </form>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, textDecoration: t.data.done ? "line-through" : undefined }}>{t.data.title}</div>
            <div className="small muted">
              {src[t.data.source]} · für {forLabel(t.data.forWhom)}
              {t.data.repeat === "taeglich" ? " · täglich" : t.data.repeat === "woechentlich" ? " · wöchentlich" : ""}
              {t.data.due ? ` · bis ${dmy(t.data.due)}` : ""} · <span style={{ color: st.label === "überfällig" ? "var(--danger)" : undefined }}>{st.label}</span>
              {st.streak > 1 ? ` · ${st.streak} Tage am Stück 🔥` : ""}
            </div>
            {st.last7.length > 0 && (
              <div className="priv-dots" title={t.data.repeat === "taeglich" ? "letzte 7 Tage" : "letzte 6 Wochen"} style={{ marginTop: 4 }}>
                {st.last7.map((d) => <i key={d.day} className={d.done ? "on" : ""} title={dmy(d.day)} />)}
              </div>
            )}
          </div>
        </div>
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>{t.data.notes || t.data.reflection ? "Notizen & wie lief’s" : "+ Notiz / wie lief’s"}</summary>
          <form action={saveTaskNoteAction} className="stack" style={{ gap: 6, marginTop: 6 }}>
            <input type="hidden" name="id" value={t.id} />
            <textarea className="input" name="notes" rows={2} defaultValue={t.data.notes ?? ""} placeholder="Worum geht’s genau (Anleitung der Therapeutin)" />
            <textarea className="input" name="reflection" rows={2} defaultValue={t.data.reflection ?? ""} placeholder="Wie lief’s? Was war schwer, was hat geholfen?" />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-small" type="submit">Speichern</button>
              <button className="btn-link small" type="submit" formAction={deleteEntryAction} name="kind" value="aufgabe" style={{ color: "var(--danger)" }}>Aufgabe löschen</button>
            </div>
          </form>
        </details>
      </div>
    );
  };

  return (
    <>
      <PrivatHead active="aufgaben" title="Aufgaben & Termine" pin={session.privatePin} />

      {prep && (
        <section className="card card-pad stack" data-testid="since-summary">
          <h2>Seit der letzten Paarsitzung ({dmy(lastPaar!)}, vor {prep.days} Tagen)</h2>
          <div className="priv-grid small">
            <div><div className="kpi-label">Nähe / Intimität</div><strong>{prep.intim}×</strong></div>
            <div><div className="kpi-label">🥂 Paarzeit</div><strong>{prep.dates}×</strong></div>
            <div><div className="kpi-label">😴 Ausgeschlafen</div>{s.partners.a} <strong>{prep.sleepIn.a}×</strong> · {s.partners.b} <strong>{prep.sleepIn.b}×</strong></div>
            <div><div className="kpi-label">{s.partners.a} allein mit Kindern</div><strong>{hoursLabel(prep.kidsHours.a)}</strong> ({prep.kidsCount.a}×)</div>
            <div><div className="kpi-label">{s.partners.b} allein mit Kindern</div><strong>{hoursLabel(prep.kidsHours.b)}</strong> ({prep.kidsCount.b}×)</div>
            <div><div className="kpi-label">Aufgaben</div><strong>{prep.tasksDone}</strong> erledigt · {prep.tasksOpen} offen</div>
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <h2>Laufende Übungen ({recurring.length})</h2>
        {recurring.length === 0 && <div className="small muted">Keine täglichen oder wöchentlichen Übungen.</div>}
        {recurring.map((t) => <TaskItem key={t.id} t={t} />)}
        <h2>Offene Aufgaben ({open.length})</h2>
        {open.length === 0 && <div className="small muted">Nichts offen.</div>}
        {open.map((t) => <TaskItem key={t.id} t={t} />)}
      </section>

      <section className="card card-pad stack">
        <h2>Neue Aufgabe von der Therapie</h2>
        <div className="small muted" data-testid="where-shown">Erscheint nur hier im Privat-Bereich (verschlüsselt) – nicht in den Firmen-Aufgaben, nicht im Kalender des Systems und nicht im Apple-Kalender.</div>
        <StateForm action={addTaskAction} submit="Aufgabe anlegen" testid="task-form">
          <div className="field"><label className="label" htmlFor="ta-title">Aufgabe</label><input className="input" id="ta-title" name="title" required placeholder="z. B. jeden Abend 10 Minuten ungestört reden" /></div>
          <div className="field"><span className="label">Von</span><Choice name="source" value="paar" options={[{ value: "ads", label: s.therapists.ads }, { value: "paar", label: s.therapists.paar }, { value: "sonst", label: "sonstige" }]} /></div>
          <div className="field"><span className="label">Für</span><Choice name="forWhom" value={me ?? undefined} options={[{ value: "a", label: s.partners.a }, { value: "b", label: s.partners.b }, { value: "beide", label: "beide" }]} /></div>
          <div className="field"><span className="label">Wie oft</span><Choice name="repeat" value="einmal" options={[{ value: "einmal", label: "einmal" }, { value: "taeglich", label: "täglich" }, { value: "woechentlich", label: "wöchentlich" }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="ta-due">bis (optional)</label><input className="input" id="ta-due" name="due" type="date" /></div>
          </div>
          <div className="field"><label className="label" htmlFor="ta-notes">Anleitung / Notizen (optional)</label><textarea className="input" id="ta-notes" name="notes" rows={2} /></div>
        </StateForm>
      </section>

      <section className="card card-pad stack" id="termine">
        <h2>Termine</h2>
        {upcoming.length === 0 ? <div className="small muted">Kein Termin eingetragen.</div> : (
          <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="appointments">
            {upcoming.map((a) => (
              <li key={a.id}>
                <strong>{weekday(a.data.day)} {dmy(a.data.day)}{a.data.time ? ` ${a.data.time}` : ""}</strong> · {withLabel(a.data.with)}
                {a.data.day === today && <span className="tag tag-warn" style={{ marginLeft: 6 }}>heute</span>}
                <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}><input type="hidden" name="kind" value="termin" /><input type="hidden" name="id" value={a.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>löschen</button></form>
              </li>
            ))}
          </ul>
        )}
        <div className="small muted">Private Termine stehen nur hier (verschlüsselt) und werden nicht mit dem Kalender abgeglichen. Termine aus deinen verbundenen Kalendern siehst du unter <a href="/kalender">Kalender</a>.</div>
        <StateForm action={addAppointmentAction} submit="Termin speichern" testid="appointment-form">
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="ap-day">Tag</label><input className="input" id="ap-day" name="day" type="date" required /></div>
            <div className="field"><label className="label" htmlFor="ap-time">Uhrzeit</label><input className="input" id="ap-time" name="time" type="time" /></div>
          </div>
          <div className="field"><span className="label">Bei</span><Choice name="with" value="paar" options={[{ value: "ads", label: s.therapists.ads }, { value: "paar", label: s.therapists.paar }, { value: "arzt", label: "Arzt/Ärztin" }, { value: "sonst", label: "sonstiges" }]} /></div>
        </StateForm>
        {past.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Vergangene Termine & Notizen ({past.length})</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              {past.map((a) => (
                <form key={a.id} action={saveAppointmentNotesAction} className="stack" style={{ gap: 4 }}>
                  <input type="hidden" name="id" value={a.id} />
                  <div className="small"><strong>{dm(a.data.day)}{a.data.time ? ` ${a.data.time}` : ""}</strong> · {withLabel(a.data.with)}</div>
                  <textarea className="input" name="notes" rows={2} defaultValue={a.data.notes ?? ""} placeholder="Was wurde besprochen? Was nehmen wir mit?" />
                  <button className="btn btn-small" type="submit" style={{ alignSelf: "flex-start" }}>Notiz speichern</button>
                </form>
              ))}
            </div>
          </details>
        )}
      </section>

      {doneList.length > 0 && (
        <section className="card card-pad">
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Erledigt ({doneList.length})</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>{doneList.map((t) => <TaskItem key={t.id} t={t} />)}</div>
          </details>
        </section>
      )}
    </>
  );
}
