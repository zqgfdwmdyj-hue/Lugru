import { todayIso } from "@/lib/dates";
import { routineState, type Routine } from "@/lib/private/logic";
import { loadEntries, requirePrivate } from "@/lib/private/service";
import { addRoutineAction, deleteEntryAction, toggleRoutineItemAction } from "../actions";
import { StateForm } from "../state-form";
import { PrivatHead, dmy } from "../ui";

const TEMPLATES = [
  { title: "Morgenroutine", items: ["Medikament genommen", "Frühstück gegessen", "Schlüssel, Handy, Geldbörse eingepackt", "Tagesplan angeschaut"] },
  { title: "Abendroutine", items: ["Tasche für morgen gepackt", "Kleidung rausgelegt", "Tagebuch eingetragen", "Handy weggelegt"] },
];

export default async function RoutinenPage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const routines = (await loadEntries<Routine>(session, ["routine"])).filter((e) => e.userId === session.userId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const existing = new Set(routines.map((r) => r.data.title));

  return (
    <>
      <PrivatHead active="routinen" title="Routinen" pin={session.privatePin} />
      <div className="small muted">Feste Abläufe helfen bei ADHS, Dinge nicht zu vergessen. Schritt antippen = erledigt. Deine Routinen siehst nur du.</div>

      {routines.length === 0 && <div className="notice notice-info small">Noch keine Routine – unten eine Vorlage übernehmen oder eigene anlegen.</div>}
      {routines.map((r) => {
        const st = routineState(r.data, today);
        return (
          <section key={r.id} className="card card-pad stack" style={{ gap: 10 }} data-testid="routine">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{r.data.title} {st.doneToday && <span className="tag tag-ok">heute komplett</span>}</h2>
              <span className="small muted">
                {st.streak > 1 ? `${st.streak} Tage am Stück 🔥 · ` : ""}
                <span className="priv-dots" title="letzte 7 Tage">{st.last7.map((d) => <i key={d.day} className={d.done ? "on" : ""} title={dmy(d.day)} />)}</span>
              </span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {r.data.items.map((it) => {
                const done = st.today.includes(it);
                return (
                  <form key={it} action={toggleRoutineItemAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="item" value={it} />
                    <button type="submit" className={`btn${done ? " btn-primary" : ""}`} style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }} aria-pressed={done} data-testid="routine-item">
                      {done ? "✓" : "○"} {it}
                    </button>
                  </form>
                );
              })}
            </div>
            <form action={deleteEntryAction}>
              <input type="hidden" name="kind" value="routine" />
              <input type="hidden" name="id" value={r.id} />
              <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Routine löschen</button>
            </form>
          </section>
        );
      })}

      <section className="card card-pad stack">
        <h2>Neue Routine</h2>
        <div className="stack" style={{ gap: 8 }}>
          {TEMPLATES.filter((t) => !existing.has(t.title)).map((t) => (
            <StateForm key={t.title} action={addRoutineAction} submit={`Vorlage „${t.title}“ übernehmen`} testid={`routine-template-${t.title === "Morgenroutine" ? "morgen" : "abend"}`} className="">
              <input type="hidden" name="title" value={t.title} />
              <input type="hidden" name="items" value={t.items.join("\n")} />
              <div className="small muted">{t.items.join(" · ")}</div>
            </StateForm>
          ))}
        </div>
        <StateForm action={addRoutineAction} submit="Routine anlegen" testid="routine-form">
          <div className="field"><label className="label" htmlFor="r-title">Name</label><input className="input" id="r-title" name="title" required placeholder="z. B. Arbeitsbeginn" /></div>
          <div className="field"><label className="label" htmlFor="r-items">Schritte (einer je Zeile)</label><textarea className="input" id="r-items" name="items" rows={4} required placeholder={"Wasser hinstellen\nHandy auf lautlos\nWichtigste Aufgabe zuerst"} /></div>
        </StateForm>
      </section>
    </>
  );
}
