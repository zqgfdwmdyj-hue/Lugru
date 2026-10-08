"use client";

import { useActionState } from "react";
import { applyPriceCheck, type ApplyState } from "@/app/(app)/actions";

/** Formular „KI-Ergebnis übernehmen“ mit sichtbarer Rückmeldung. */
export function ApplyForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(applyPriceCheck, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        {children}
      </fieldset>
      {pending && <div className="notice notice-info">Wird übernommen …</div>}
      {!pending && state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.ok ? "✓ " : ""}{state.message}</div>}
    </form>
  );
}
