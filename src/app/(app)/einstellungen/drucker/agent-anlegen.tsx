"use client";

import { useActionState } from "react";
import { agentAnlegenAction, type AnlegenStand } from "./actions";

// Agent anlegen: Der Gerätetoken erscheint genau einmal – danach nur noch die ersten Zeichen.

export function AgentAnlegen() {
  const [stand, aktion, laeuft] = useActionState<AnlegenStand, FormData>(agentAnlegenAction, null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form action={aktion} className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "end" }} data-testid="agent-anlegen">
        <label className="small">Name{" "}<input className="input" name="name" placeholder="Arbeits-PC Lager" style={{ width: 200 }} data-testid="agent-name" /></label>
        <label className="small"><input type="checkbox" name="umzug" value="1" data-testid="agent-umzug" /> Umzug: andere Agenten deaktivieren</label>
        <button className="btn btn-primary" type="submit" disabled={laeuft} data-testid="agent-anlegen-los">Agent anlegen</button>
      </form>
      {stand?.fehler && <div className="notice notice-warn small">{stand.fehler}</div>}
      {stand?.token && (
        <div className="notice notice-ok small" data-testid="agent-token-box">
          <div><strong>Gerätetoken für „{stand.name}“ – wird nur jetzt angezeigt.</strong> Bei der Installation eingeben (nicht in Chats oder Mails kopieren).</div>
          <code style={{ display: "block", wordBreak: "break-all", margin: "6px 0", userSelect: "all" }} data-testid="agent-token">{stand.token}</code>
          {stand.deaktiviert ? <div>{stand.deaktiviert} alte{stand.deaktiviert === 1 ? "r Agent" : " Agenten"} deaktiviert (Umzug).</div> : null}
        </div>
      )}
    </div>
  );
}
