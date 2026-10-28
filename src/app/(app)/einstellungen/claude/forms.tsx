"use client";

import { useActionState, useState } from "react";
import { saveAssistantSettings, type ClaudeState } from "./actions";

export function CopyUrl({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <code className="num" style={{ padding: "6px 8px", background: "var(--surface-2, #f3f3f3)", borderRadius: 6, wordBreak: "break-all" }} data-testid="mcp-url">{url}</code>
      <button
        className="btn btn-small btn-primary"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setDone(true);
            setTimeout(() => setDone(false), 2500);
          } catch {
            window.prompt("Adresse kopieren:", url);
          }
        }}
      >
        {done ? "✓ Kopiert" : "Adresse kopieren"}
      </button>
    </div>
  );
}

export function AssistantSettings({ v, hasKey }: { v: { enabled: boolean; model: string; allowWrite: boolean }; hasKey: boolean }) {
  const [state, action, pending] = useActionState<ClaudeState, FormData>(saveAssistantSettings, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }} data-testid="assistant-settings">
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" name="enabled" defaultChecked={v.enabled} /> Fragefeld oben im Seller-System anzeigen (für alle Konten)
      </label>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" name="allowWrite" defaultChecked={v.allowWrite} /> Änderungen erlauben (jede Änderung muss im Fragefeld bestätigt werden; Nur-ansehen-Konten nie)
      </label>
      <div className="field" style={{ maxWidth: 360 }}>
        <label className="label" htmlFor="as-model">Modell</label>
        <select className="select" id="as-model" name="model" defaultValue={v.model}>
          <option value="claude-opus-5-5">Claude Opus 5.5 – beste Antworten (Standard)</option>
          <option value="claude-sonnet-5-5">Claude Sonnet 5.5 – schneller, etwa halb so teuer</option>
          <option value="claude-haiku-5-5">Claude Haiku 5.5 – am günstigsten, für einfache Fragen</option>
        </select>
      </div>
      {!hasKey && <div className="notice notice-warn">Für das Fragefeld fehlt noch der KI-Schlüssel: Anbindungen → „KI (Claude)“ → API-Key eintragen.</div>}
      <button className="btn btn-small btn-primary" type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>Speichern</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}
