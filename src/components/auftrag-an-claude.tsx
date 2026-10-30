"use client";

import { useState } from "react";
import { ASST_AUFTRAG } from "./assistant-bar";

/** Feld „Auftrag an Claude“ auf Listen: öffnet das Fragefeld mit dem Auftrag (Änderungen erst nach Vorschau und Klick). */
export function AuftragAnClaude({ beispiel, kontext }: { beispiel: string; kontext?: string }) {
  const [t, setT] = useState("");
  return (
    <form
      className="card card-pad small"
      style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!t.trim()) return;
        window.dispatchEvent(new CustomEvent(ASST_AUFTRAG, { detail: kontext ? `${t.trim()} (${kontext})` : t.trim() }));
        setT("");
      }}
      data-testid="auftrag-an-claude"
    >
      <span aria-hidden="true">✨</span>
      <input className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder={`Auftrag an Claude, z. B. „${beispiel}“`} aria-label="Auftrag an Claude" style={{ flex: "1 1 260px" }} data-testid="auftrag-text" />
      <button className="btn btn-small" type="submit" data-testid="auftrag-senden">An Claude</button>
      <span className="muted" style={{ flexBasis: "100%" }}>Claude zeigt erst eine Vorschau – geändert wird nur nach deinem Klick auf „Ausführen“.</span>
    </form>
  );
}
