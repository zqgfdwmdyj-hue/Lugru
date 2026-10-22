"use client";

import { useActionState } from "react";
import type { IdeasState } from "@/app/(app)/actions";

/** Themen antippen und/oder einen eigenen Wunsch eingeben, dann erzeugt die KI Pakete, Rezepte und einen Werbetext. */
export function IdeasForm({ action, themes, cost, modes }: { action: (prev: IdeasState, fd: FormData) => Promise<IdeasState>; themes: string[]; cost: string; modes: { key: string; label: string; hint: string }[] }) {
  const [state, run, pending] = useActionState<IdeasState, FormData>(action, null);
  return (
    <form action={run} className="card card-pad stack" style={{ gap: 10 }}>
      <h2>Ideen für diese Verteilung</h2>
      <div className="small muted">Die KI liest die Produkte des Tages und schlägt Themenpakete, Rezepte und einen fertigen Werbetext vor. Produkte mit bald ablaufendem MHD plant sie bevorzugt ein.</div>
      <div>
        <div className="label">Was soll die KI vorschlagen?</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {modes.map((m, i) => (
            <label key={m.key} className="chip idea-chip" title={m.hint}>
              <input type="radio" name="modus" value={m.key} defaultChecked={i === 0} /> {m.label}
              <span className="small muted idea-hint">{m.hint}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="label">Themen (beliebig viele, optional)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {themes.map((t) => (
            <label key={t} className="chip idea-chip">
              <input type="checkbox" name="thema" value={t} /> {t}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="wunsch">Eigene Idee (optional)</label>
        <textarea className="input" id="wunsch" name="wunsch" rows={2} placeholder="z. B. „Paket für Leute ohne Herd“ oder „Was kann man für ein Kindergeburtstag zusammenstellen?“" />
      </div>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "KI denkt nach … (ca. 30 Sekunden)" : "✨ Ideen erzeugen"}</button>
        <span className="small muted">kostet ca. {cost} je Durchlauf</span>
      </div>
    </form>
  );
}
