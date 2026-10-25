"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

/** Knopf mit Rückmeldung (z. B. „Angebote laden“, „KI-Vorschlag holen“). */
export function ActionButton({
  action,
  label,
  pending: pendingLabel,
  itemId,
  primary = false,
  testid,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: string;
  pending: string;
  itemId?: string;
  primary?: boolean;
  testid?: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={dispatch} style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid={testid}>
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      <button className={`btn ${primary ? "btn-primary" : ""}`} type="submit" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state && (
        <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid={testid ? `${testid}-result` : undefined}>
          {state.message}
        </span>
      )}
    </form>
  );
}
