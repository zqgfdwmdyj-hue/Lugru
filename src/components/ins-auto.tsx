"use client";

import { useActionState } from "react";
import { insAutoAction, type InsAutoState } from "./ins-auto-action";

/** Knopf „Ins Auto“ (B13) – schickt das Ziel an den Tesla; optional Klima vorheizen (nur mit Häkchen). */
export function InsAuto({ ziel, klein = true }: { ziel: string; klein?: boolean }) {
  const [state, action, pending] = useActionState<InsAutoState, FormData>(insAutoAction, null);
  return (
    <form action={action} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="ins-auto">
      <input type="hidden" name="ziel" value={ziel} />
      <button className={`btn${klein ? " btn-small" : ""}`} type="submit" disabled={pending} title={`Ziel ans Auto: ${ziel}`}>{pending ? "Sende …" : "🚗 Ins Auto"}</button>
      <label className="small muted"><input type="checkbox" name="klima" /> vorheizen</label>
      {state && <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.text}</span>}
    </form>
  );
}
