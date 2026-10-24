"use client";

import { useState } from "react";

/**
 * Aufklappbereich, der nach einem Speichern offen bleibt. Ein normales `<details open={…}>`
 * würde beim Neurendern vom Server wieder zuklappen und die Erfolgsmeldung verstecken.
 */
export function Disclosure({ summary, defaultOpen = false, children }: { summary: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="small" style={{ cursor: "pointer" }}>{summary}</summary>
      {children}
    </details>
  );
}
