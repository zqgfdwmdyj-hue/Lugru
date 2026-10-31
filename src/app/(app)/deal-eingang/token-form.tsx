"use client";

import { useActionState } from "react";
import { tokenAnlegenAction, type TokenState } from "./actions";

export function TokenForm() {
  const [state, action, pending] = useActionState<TokenState, FormData>(tokenAnlegenAction, null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form action={action} className="row" style={{ gap: 8, flexWrap: "wrap" }} data-testid="de-token-form">
        <input name="name" placeholder="Gerät, z. B. iPhone Ludwig" style={{ width: 220 }} />
        <button className="btn" type="submit" disabled={pending}>Schlüssel erzeugen</button>
      </form>
      {state && "token" in state && (
        <div className="notice notice-ok small" data-testid="de-token-neu">
          Schlüssel für „{state.name}“ – jetzt in den Kurzbefehl kopieren, er wird nicht noch einmal angezeigt:
          <pre style={{ userSelect: "all", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "6px 0 0" }} data-testid="de-token-wert">{state.token}</pre>
        </div>
      )}
      {state && "fehler" in state && <div className="notice notice-warn small">{state.fehler}</div>}
    </div>
  );
}
