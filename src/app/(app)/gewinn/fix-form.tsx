"use client";

import { useActionState } from "react";
import type { FixState } from "./actions";

/** Ein Betragsfeld mit Speichern und Rückmeldung in der Zeile – für die Liste „fehlende Werte“. */
export function FixForm({
  action,
  hidden,
  name,
  label,
  placeholder,
  testid,
}: {
  action: (prev: FixState, fd: FormData) => Promise<FixState>;
  hidden: Record<string, string>;
  name: string;
  label: string;
  placeholder?: string;
  testid?: string;
}) {
  const [state, dispatch, pending] = useActionState<FixState, FormData>(action, null);
  return (
    <form action={dispatch} className="fix-form" data-testid={testid}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input className="input num" name={name} aria-label={label} placeholder={placeholder ?? label} inputMode="decimal" required />
      <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "…" : "Speichern"}</button>
      {state && <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.message}</span>}
    </form>
  );
}
