"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { erfassenAction, mobilTokenAction, type ErfassenState, type SchluesselState } from "./actions";

export function SchluesselForm() {
  const [state, action, pending] = useActionState<SchluesselState, FormData>(mobilTokenAction, null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form action={action} className="row" style={{ gap: 8, flexWrap: "wrap" }} data-testid="mobil-token-form">
        <input className="input" name="name" placeholder="Gerät, z. B. iPhone Ludwig" style={{ width: 220 }} aria-label="Gerät" />
        <button className="btn" type="submit" disabled={pending}>Schlüssel erzeugen</button>
      </form>
      {state && "token" in state && (
        <div className="notice notice-ok small" data-testid="mobil-token-neu">
          Schlüssel für „{state.name}“ – jetzt in den Kurzbefehl kopieren, er wird nicht noch einmal angezeigt:
          <pre style={{ userSelect: "all", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "6px 0 0" }} data-testid="mobil-token-wert">{state.token}</pre>
        </div>
      )}
      {state && "fehler" in state && <div className="notice notice-warn small">{state.fehler}</div>}
    </div>
  );
}

export function ErfassenForm() {
  const [state, action, pending] = useActionState<ErfassenState, FormData>(erfassenAction, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: true });
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 8 }} data-testid="schnell-form">
      <label className="label" htmlFor="schnell-text">Diktat (wie per Siri)</label>
      <input className="input" id="schnell-text" name="text" placeholder="z. B. Aufgabe: morgen DHL Geschäftskunden anrufen" maxLength={1000} required />
      <div><button className="btn btn-primary btn-small" type="submit" disabled={pending}>{pending ? "Ordne ein …" : "Erfassen"}</button></div>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid="schnell-antwort">{state.message}</div>}
    </form>
  );
}
