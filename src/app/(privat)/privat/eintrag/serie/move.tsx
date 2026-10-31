"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import type { FormState } from "../../actions";
import { moveOccurrenceAction } from "../../eintrag-actions";

/** Nur diesen Termin auf einen anderen Tag (und/oder eine andere Uhrzeit) legen. */
export function MoveOccurrence({ occurrence, day, time, today }: { occurrence: string; day: string; time?: string; today: string }) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(moveOccurrenceAction, null);
  const keepDispatch = useKeepForm(state, dispatch);
  return (
    <form action={dispatch} ref={keepDispatch.ref} onSubmit={keepDispatch.onSubmit} className="stack" style={{ gap: 8 }} data-testid="occ-move">
      <input type="hidden" name="vorkommen" value={occurrence} />
      <div className="label">Verschieben</div>
      <div className="pk-form-grid">
        <div className="field"><label className="label small" htmlFor="m-day">neuer Tag</label><input className="input" id="m-day" type="date" name="day" defaultValue={day} required /></div>
        <div className="field"><label className="label small" htmlFor="m-time">Uhrzeit (optional)</label><input className="input" id="m-time" type="time" name="time" defaultValue={time} /></div>
      </div>
      <label className="check small"><input type="checkbox" name="status" value="stattgefunden" /> hat am neuen Tag schon stattgefunden (nur bis heute, {today.split("-").reverse().join(".")})</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={pending}>Nur diesen Termin verschieben</button>
        {state && <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.message}</span>}
      </div>
    </form>
  );
}
