"use client";

import { useActionState } from "react";
import { syncCalendarNow, type SyncState } from "./actions";

export function SyncButton() {
  const [state, action, pending] = useActionState<SyncState, FormData>(syncCalendarNow, null);
  return (
    <form action={action} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {state && <span className={`small ${state.ok ? "muted" : ""}`} style={state.ok ? undefined : { color: "var(--danger)" }}>{state.message}</span>}
      <button className="btn" type="submit" disabled={pending}>{pending ? "Gleiche ab …" : "Jetzt abgleichen"}</button>
    </form>
  );
}
