"use client";

import { useActionState } from "react";
import { runResearchNow, type RunState } from "./actions";

export function RunButton() {
  const [state, action, pending] = useActionState<RunState, FormData>(runResearchNow, null);
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Suche läuft … (bis zu einer Minute)" : "Jetzt suchen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}
