"use client";

import { useActionState, useState } from "react";
import { tokenAction, type TokenState } from "./actions";

export function Copy({ value, testId }: { value: string; testId?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
      <input className="input num" readOnly value={value} data-testid={testId} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} aria-label="Zum Kopieren" />
      <button type="button" className="btn btn-small" onClick={() => navigator.clipboard?.writeText(value).then(() => setDone(true))}>{done ? "Kopiert" : "Kopieren"}</button>
    </div>
  );
}


export function TokenForm({ hint, createdAt }: { hint?: string; createdAt?: string }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(tokenAction, null);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="label">Auth-Header</div>
      {state?.token ? (
        <>
          <Copy value={`Bearer ${state.token}`} testId="rh-token" />
          <div className="notice notice-warn small">Jetzt kopieren und in Discord eintragen – der Schlüssel wird nur dieses eine Mal angezeigt.</div>
        </>
      ) : hint ? (
        <div className="small">Bearer rh_…{hint} <span className="muted">· erzeugt am {new Date(createdAt ?? "").toLocaleDateString("de-DE")}</span></div>
      ) : (
        <div className="small muted">Noch kein Schlüssel – ohne Schlüssel nimmt das System nichts an.</div>
      )}
      <form action={action}>
        <button className={`btn btn-small${hint ? "" : " btn-primary"}`} type="submit" disabled={pending} data-testid="rh-token-new">
          {pending ? "Erzeuge …" : hint ? "Neuen Schlüssel erzeugen (alter gilt dann nicht mehr)" : "Schlüssel erzeugen"}
        </button>
      </form>
    </div>
  );
}
