"use client";

import { useActionState } from "react";
import { importAction, refreshAction, type TodoState } from "./actions";

export function RefreshButton() {
  const [state, action, pending] = useActionState<TodoState, FormData>(refreshAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Prüfe Mails … (bis zu einer Minute)" : "↻ Mails prüfen"}</button>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} style={{ maxWidth: 520 }}>{state.message}</div>}
    </form>
  );
}

export function ImportForm() {
  const [state, action, pending] = useActionState<TodoState, FormData>(importAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <label className="label" htmlFor="appdb">Aus dem Retouren-Tool übernehmen (app.db)</label>
      <input className="input" id="appdb" name="file" type="file" accept=".db,.sqlite,application/octet-stream" required />
      <span className="small muted">Übernimmt alle Amazon-ToDos mit Status und Notiz sowie die Liste verworfener Mails. Doppelte werden übersprungen – mehrfaches Hochladen schadet nicht.</span>
      <div><button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Übernehme …" : "Übernehmen"}</button></div>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}
