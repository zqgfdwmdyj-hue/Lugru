"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { einladenAction, type EinladungStand } from "./actions";

export function Einladung({ id, email, schonAktiv }: { id: string; email: string | null; schonAktiv: boolean }) {
  const [stand, aktion] = useActionState<EinladungStand, FormData>(einladenAction, null);
  return (
    <form action={aktion} className="stack" style={{ gap: 8 }} data-testid="einladung">
      <input type="hidden" name="id" value={id} />
      {email ? (
        <label className="check small"><input type="checkbox" name="senden" data-testid="einladung-senden" /> Geprüft – jetzt per Mail an {email} senden</label>
      ) : (
        <div className="small muted">Ohne E-Mail-Adresse beim Kunden keine Einladung möglich.</div>
      )}
      <div><SubmitButton className="btn" label={schonAktiv ? "Neuen Einladungs-Link (Passwort neu setzen)" : "Einladungs-Link erstellen"} pendingLabel="Erstelle …" testId="einladen" /></div>
      {stand && (
        <div className={`notice ${stand.ok ? "notice-ok" : "notice-warn"}`} data-testid="einladung-ergebnis">
          {stand.text}
          {stand.link && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              <code className="small" style={{ wordBreak: "break-all" }} data-testid="einladung-link">{stand.link}</code>
              <CopyButton text={stand.link} />
            </div>
          )}
        </div>
      )}
    </form>
  );
}
