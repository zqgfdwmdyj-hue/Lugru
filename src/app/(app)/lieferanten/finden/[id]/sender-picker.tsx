"use client";

import Link from "next/link";
import { useState } from "react";

export type SenderOption = { id: string; address: string; label: string; signature: string; own: boolean };

/** Absender-Postfach wählen; darunter die Signatur, die beim Senden angehängt wird. */
export function SenderPicker({ options, defaultId, canEdit }: { options: SenderOption[]; defaultId: string | null; canEdit: boolean }) {
  const [id, setId] = useState(defaultId ?? options[0]?.id ?? "");
  const cur = options.find((o) => o.id === id);
  if (!options.length) {
    return <div className="notice notice-warn small" data-testid="sender-none">Kein Postfach zum Senden verbunden – unter <Link href="/posteingang/verbinden">Posteingang → Postfach verbinden</Link>.</div>;
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="field">
        <label className="label" htmlFor="c-from">Von</label>
        <select className="select" id="c-from" name="fromId" value={id} onChange={(e) => setId(e.target.value)} data-testid="sender-select">
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {cur && (
        <div className="small" data-testid="sender-signature">
          <div className="muted" style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
            <span>{cur.own ? "Signatur (wird angehängt):" : "Noch keine eigene Signatur – angehängt wird aus den Absenderdaten:"}</span>
            {canEdit && <Link href={`/posteingang/postfaecher/${cur.id}`}>{cur.own ? "Signatur bearbeiten" : "Signatur anlegen"}</Link>}
          </div>
          <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", padding: 8, background: "var(--surface-2)", borderRadius: 6, fontFamily: "inherit" }}>{cur.signature}</pre>
        </div>
      )}
    </div>
  );
}
