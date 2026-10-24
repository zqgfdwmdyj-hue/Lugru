"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormState } from "./actions";

/**
 * Formular mit Rückmeldung (gespeichert / Fehler). Nach dem Speichern werden die Felder geleert,
 * außer `keep` ist gesetzt (z. B. Tagebuch – dort bleibt der Tag stehen).
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
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !keep) form.current?.reset();
  }, [state, keep]);
  return (
    <form ref={form} action={dispatch} className={className} style={{ gap: 12 }} data-testid={testid}>
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
