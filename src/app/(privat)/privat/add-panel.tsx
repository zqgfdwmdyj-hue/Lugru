"use client";

import { useEffect, useState } from "react";

/**
 * Klarer Knopf „＋ … eintragen“, der das Formular aufklappt. Bleibt nach dem Speichern offen
 * (ein normales `<details open>` klappt beim Neurendern zu). Felder bleiben im Formular, auch zugeklappt.
 */
export function AddPanel({ label, children, defaultOpen = false, testid }: { label: string; children: React.ReactNode; defaultOpen?: boolean; testid?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen((o) => o || defaultOpen), [defaultOpen]);
  return (
    <details className="add-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid={testid}>
      <summary className={`btn ${open ? "" : "btn-primary"}`}>{open ? "Schließen" : `＋ ${label}`}</summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}
