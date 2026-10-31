"use client";

import { useActionState, useState } from "react";
import { decideConsent, type ConsentState } from "./actions";

export function ConsentForm({ hidden, canPrivate, needsPin, wantsPrivate }: { hidden: Record<string, string>; canPrivate: boolean; needsPin: boolean; wantsPrivate: boolean }) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(decideConsent, null);
  const [privat, setPrivat] = useState(canPrivate && wantsPrivate);
  return (
    <form action={action} className="stack" style={{ gap: 12 }} data-testid="consent-form">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="aendern" defaultChecked data-testid="consent-write" style={{ marginTop: 3 }} />
        <span><strong>Ändern erlauben</strong><br /><span className="small muted">Aufgaben anlegen/abhaken, Paletten-Sendungen anlegen und verschieben, Notizen … Claude fragt vor Änderungen nach.</span></span>
      </label>
      {canPrivate && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" name="privat" checked={privat} onChange={(e) => setPrivat(e.target.checked)} data-testid="consent-private" style={{ marginTop: 3 }} />
          <span><strong>Privatbereich einbeziehen</strong><br /><span className="small muted">Privatkalender, Kinderzeit, Auszeit, Termine, Tagebuch – nur für dich, nie für Mitarbeiter.</span></span>
        </label>
      )}
      {canPrivate && privat && needsPin && (
        <div className="field">
          <label className="label" htmlFor="pin">Privat-PIN</label>
          <input className="input" id="pin" name="pin" type="password" inputMode="numeric" autoComplete="off" required data-testid="consent-pin" />
        </div>
      )}
      {state?.error && <div className="notice notice-error" role="alert">{state.error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" name="decision" value="allow" disabled={pending} data-testid="consent-allow">{pending ? "Verbinde …" : "Erlauben"}</button>
        <button className="btn" type="submit" name="decision" value="deny" disabled={pending} formNoValidate data-testid="consent-deny">Ablehnen</button>
      </div>
    </form>
  );
}
