"use client";

import { useFormStatus } from "react-dom";

/** Absende-Knopf, der während des Sendens sichtbar reagiert (und nicht doppelt auslöst). */
export function SubmitButton({ label, pendingLabel, className = "btn btn-primary", testId }: { label: string; pendingLabel: string; className?: string; testId?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending} data-testid={testId}>
      {pending ? pendingLabel : label}
    </button>
  );
}
