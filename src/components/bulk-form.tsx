"use client";

import { useActionState, useEffect, useRef, useState } from "react";

export type BulkResult = { ok: boolean; message: string } | null;
export type BulkOp = { op: string; label: string; confirm?: string; primary?: boolean; danger?: boolean };

/**
 * Sammelbearbeitung für Listen: Zeilen mit `<input type="checkbox" name="ids" value=…>` auswählen,
 * oben erscheint die Leiste mit Anzahl und Aktionen. Seltene oder folgenreiche Aktionen fragen nach.
 * „Alle auswählen“: ein Kontrollkästchen mit `data-select-all` im Tabellenkopf.
 */
export function BulkForm({ action, ops, children, testid = "bulk" }: { action: (prev: BulkResult, fd: FormData) => Promise<BulkResult>; ops: BulkOp[]; children: React.ReactNode; testid?: string }) {
  const [state, dispatch, pending] = useActionState<BulkResult, FormData>(action, null);
  const [count, setCount] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const recount = () => setCount(form.current?.querySelectorAll('input[name="ids"]:checked').length ?? 0);
  // Nach der Aktion verschwinden Zeilen ggf. aus der Liste – Anzahl neu zählen.
  useEffect(recount, [state]);
  return (
    <form
      ref={form}
      action={dispatch}
      className="stack"
      data-testid={testid}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.dataset.selectAll !== undefined) form.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => (c.checked = t.checked));
        recount();
      }}
    >
      <div className={`bulk-bar${count ? " active" : ""}`} role="toolbar" aria-label="Auswahl bearbeiten" data-testid={`${testid}-bar`}>
        <span className="small" data-testid={`${testid}-count`}>{count ? `${count} ausgewählt` : "Zeilen auswählen für Sammelbearbeitung"}</span>
        {ops.map((o) => (
          <button
            key={o.op}
            type="submit"
            name="op"
            value={o.op}
            className={`btn btn-small${o.primary ? " btn-primary" : ""}${o.danger ? " btn-danger-soft" : ""}`}
            disabled={!count || pending}
            onClick={(e) => {
              if (o.confirm && !window.confirm(o.confirm.replace("{n}", String(count)))) e.preventDefault();
            }}
          >
            {o.label}
          </button>
        ))}
        {pending && <span className="small muted">Wird ausgeführt …</span>}
      </div>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid={`${testid}-result`}>{state.message}</div>}
      {children}
    </form>
  );
}
