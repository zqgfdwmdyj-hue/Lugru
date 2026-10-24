import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { medStock, type DiaryEntry } from "@/lib/private/logic";
import { loadEntries, myMedPlan } from "@/lib/private/service";
import { saveMedPlanAction, stockAction, takeNowAction, undoIntakeAction } from "./actions";
import { StateForm } from "./state-form";
import { Disclosure } from "@/components/disclosure";

const n = (v: number | undefined) => (v === undefined ? "" : String(v).replace(".", ","));

/**
 * Einnahme mit einem Tipp + Vorrat. `full` zeigt auch die Einstellungen (Tagebuch-Seite).
 */
export async function IntakeCard({ session, full = false }: { session: Session; full?: boolean }) {
  const today = todayIso();
  const { id, plan } = await myMedPlan(session);
  const diary = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).filter((e) => e.userId === session.userId).map((e) => e.data);
  const todayEntry = diary.find((e) => e.day === today);
  const intakes = todayEntry?.intakes ?? (todayEntry?.takenAt ? [todayEntry.takenAt] : []);
  const stock = medStock(plan, diary);
  if (!full && !id) return null;

  return (
    <section className="card card-pad stack" data-testid="intake-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>💊 {plan.med || "Medikament"}{plan.doseMg !== undefined ? ` ${n(plan.doseMg)} mg` : ""}</h2>
          <div className="small muted" data-testid="intake-today">
            {intakes.length ? `Heute genommen: ${intakes.join(", ")} Uhr${plan.intakesPerDay > 1 ? ` (${intakes.length} von ${plan.intakesPerDay})` : ""}` : "Heute noch nicht eingetragen."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <form action={takeNowAction}>
            <button className="btn btn-primary" type="submit" disabled={!plan.med && full} data-testid="take-now" style={{ fontSize: 16, padding: "12px 18px" }}>
              Jetzt genommen
            </button>
          </form>
          {intakes.length > 0 && (
            <form action={undoIntakeAction}>
              <button className="btn-link small" type="submit" title="Letzte Einnahme von heute zurücknehmen">rückgängig</button>
            </form>
          )}
        </div>
      </div>
      {stock && (
        <div className={`notice ${stock.low ? "notice-warn" : "notice-info"} small`} data-testid="stock">
          Vorrat: <strong>{n(stock.remaining)} Stück</strong> – reicht noch etwa <strong>{stock.daysLeft} Tag{stock.daysLeft === 1 ? "" : "e"}</strong>.
          {stock.low && <> Rechtzeitig ein neues Rezept besorgen – Rezepte für ADHS-Medikamente sind oft Betäubungsmittel-Rezepte und nur wenige Tage gültig, also zeitnah einlösen.</>}
        </div>
      )}
      {!full && <Link className="small" href="/privat/tagebuch">Zum Tagebuch →</Link>}
      {full && (
        <Disclosure defaultOpen={!plan.med} summary={plan.med ? "Medikament & Vorrat einstellen" : "Erst einmal Medikament eintragen"}>
          <div className="stack" style={{ gap: 14, marginTop: 10 }}>
            <StateForm action={saveMedPlanAction} submit="Medikament speichern" testid="medplan-form" keep>
              <div className="priv-grid">
                <div className="field"><label className="label" htmlFor="mp-med">Medikament</label><input className="input" id="mp-med" name="med" defaultValue={plan.med} required placeholder="z. B. Methylphenidat retard" /></div>
                <div className="field"><label className="label" htmlFor="mp-dose">Dosis je Einnahme (mg)</label><input className="input" id="mp-dose" name="doseMg" inputMode="decimal" defaultValue={n(plan.doseMg)} /></div>
                <div className="field"><label className="label" htmlFor="mp-pieces">Stück je Einnahme</label><input className="input" id="mp-pieces" name="piecesPerIntake" inputMode="decimal" defaultValue={n(plan.piecesPerIntake)} /></div>
                <div className="field"><label className="label" htmlFor="mp-per-day">Einnahmen am Tag</label><input className="input" id="mp-per-day" name="intakesPerDay" inputMode="numeric" defaultValue={n(plan.intakesPerDay)} /></div>
                <div className="field"><label className="label" htmlFor="mp-warn">Warnen ab … Tagen Rest</label><input className="input" id="mp-warn" name="warnDays" inputMode="numeric" defaultValue={n(plan.warnDays)} /></div>
              </div>
              <div className="small muted">Ändert die Ärztin die Dosis, hier anpassen – das Tagebuch übernimmt sie ab dann automatisch.</div>
            </StateForm>
            {id && (
              <StateForm action={stockAction} submit="Vorrat speichern" testid="stock-form">
                <div className="priv-grid">
                  <div className="field"><label className="label" htmlFor="st-count">Stück</label><input className="input" id="st-count" name="count" inputMode="decimal" required /></div>
                  <div className="field">
                    <span className="label">Das ist …</span>
                    <div className="pick-chips">
                      <label><input type="radio" name="mode" value="add" defaultChecked /><span>neue Packung (dazu)</span></label>
                      <label><input type="radio" name="mode" value="set" /><span>jetzt im Haus (gezählt)</span></label>
                    </div>
                  </div>
                </div>
              </StateForm>
            )}
          </div>
        </Disclosure>
      )}
    </section>
  );
}
