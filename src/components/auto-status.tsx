"use client";

import { useActionState } from "react";
import { autoStatusAction, type AutoStatusState } from "./auto-status-action";

/** Fahrzeugstatus (Tesla) im Tagesplan – erst auf Knopfdruck: Akku, Reichweite, Standort grob, verriegelt, Fenster, Reifen, Update. */
export function AutoStatus() {
  const [state, action, pending] = useActionState<AutoStatusState>(autoStatusAction, null);
  return (
    <form action={action} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="auto-status">
      <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Frage Auto …" : "🚗 Auto-Status"}</button>
      {state && <span className="small" role="status" style={{ color: state.ok ? undefined : "var(--danger)" }}>{state.text}</span>}
    </form>
  );
}
