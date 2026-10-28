"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import type { FormState } from "../actions";
import { endPeriodAction } from "../eintrag-actions";

/** Laufende Periode mit einem Tipp beenden (heute) oder mit Datum. */
export function EndPeriod({ id, today }: { id: string; today: string }) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(endPeriodAction, null);
  const keepDispatch = useKeepForm(state, dispatch);
  return (
    <form action={dispatch} ref={keepDispatch.ref} onSubmit={keepDispatch.onSubmit} className="notice notice-info small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="end-period">
      <input type="hidden" name="id" value={id} />
      <span>Läuft noch. Letzter Tag:</span>
      <input className="input" type="date" name="end" defaultValue={today} max={today} style={{ maxWidth: 170 }} />
      <button className="btn btn-small" type="submit" disabled={pending}>Ende eintragen</button>
      {state && <span role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.message}</span>}
    </form>
  );
}
