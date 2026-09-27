"use client";

import { useActionState, useEffect, useRef } from "react";
import { countScan, type CountState } from "../../actions";

export function CountScan({ countId }: { countId: string }) {
  const [state, action, pending] = useActionState<CountState, FormData>(countScan, null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), [state]);
  return (
    <form action={action} className="card" style={{ padding: 16, borderWidth: 2, borderColor: "var(--accent)" }}>
      <input type="hidden" name="countId" value={countId} />
      <label htmlFor="cc" className="label">Scannen oder SKU eingeben – Menge davor möglich („5*…“)</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input num" name="quantity" defaultValue="1" aria-label="Menge" style={{ width: 70, fontSize: 20, textAlign: "center" }} />
        <input ref={ref} id="cc" name="code" className="input num" autoFocus autoComplete="off" disabled={pending} style={{ fontSize: 20 }} />
      </div>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`} style={{ marginTop: 10 }}>{state.message}</div>}
    </form>
  );
}
