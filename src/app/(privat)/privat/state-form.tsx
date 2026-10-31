"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import type { FormState } from "./actions";

/**
 * Formular mit Rückmeldung (gespeichert / Fehler). Nach dem Speichern werden die Felder geleert,
 * außer `keep` ist gesetzt (z. B. Tagebuch, Bearbeiten – dort bleibt alles stehen). Bei Fehlern bleibt immer alles stehen.
 */
export function StateForm({
  action,
  submit,
  children,
  testid,
  keep = false,
  className = "stack",
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  submit: string;
  children: React.ReactNode;
  testid?: string;
  keep?: boolean;
  className?: string;
}) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(action, null);
  // Bei Fehlern bleibt alles stehen; mit `keep` auch nach dem Speichern (Auswahlfelder springen nicht zurück).
  const form = useKeepForm(state, dispatch, { resetOnSuccess: !keep });
  return (
    <form ref={form.ref} action={dispatch} onSubmit={form.onSubmit} className={className} style={{ gap: 12 }} data-testid={testid}>
      {children}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Speichere …" : submit}</button>
        {state && (
          <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} role="status" data-testid={testid ? `${testid}-result` : undefined}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
