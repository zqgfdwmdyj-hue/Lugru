"use client";

import { useActionState } from "react";
import { workerAnlegenAction, type WorkerStand } from "./actions";

// Worker anlegen: das Token (vw_…) erscheint genau einmal – danach nur noch die ersten Zeichen.

export function WorkerAnlegen() {
  const [stand, aktion, laeuft] = useActionState<WorkerStand, FormData>(workerAnlegenAction, null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form action={aktion} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="vw-anlegen">
        <label className="small">Name <input className="input" name="name" placeholder="Arbeits-PC" style={{ width: 180 }} data-testid="vw-name" /></label>
        <button className="btn btn-sm btn-primary" type="submit" disabled={laeuft} data-testid="vw-anlegen-los">Worker anlegen</button>
      </form>
      {stand?.fehler && <div className="notice notice-warn small">{stand.fehler}</div>}
      {stand?.token && (
        <div className="notice notice-ok small" data-testid="vw-token-box">
          <div><strong>Worker-Token für „{stand.name}“ – wird nur jetzt angezeigt.</strong> Am Arbeits-PC als WORKER_TOKEN eintragen (nicht in Chats oder Mails kopieren).</div>
          <code style={{ display: "block", wordBreak: "break-all", margin: "6px 0", userSelect: "all" }} data-testid="vw-token">{stand.token}</code>
        </div>
      )}
    </div>
  );
}
