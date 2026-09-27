"use client";

import { useActionState } from "react";
import { batchLabels, type BatchState } from "./actions";

/** Umschließt die Auftragstabelle; erzeugt Labels für die ausgewählten Aufträge. */
export function BatchForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<BatchState, FormData>(batchLabels, null);
  const ok = state?.results.filter((r) => r.ok) ?? [];
  return (
    <form action={action} className="stack">
      {children}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Erstelle Labels …" : "DHL-Labels für Auswahl erstellen"}</button>
        <span className="small muted">Gewicht aus den Artikeldaten + 150 g Verpackung; bis zur Kleinpaket-Grenze automatisch als Kleinpaket.</span>
      </div>
      {state?.results.map((r) => (
        <div key={r.id} className={`notice ${r.ok ? "notice-ok" : "notice-error"}`}>
          <strong>{r.ref}</strong>: {r.message} {r.fileId && <a href={`/datei/${r.fileId}`} target="_blank" rel="noreferrer">Label öffnen</a>}
        </div>
      ))}
      {ok.length > 1 && <div className="small muted">Tipp: Labels einzeln öffnen und mit dem QL-1100 drucken (Papier 103 × 199 mm, Skalierung 100 %).</div>}
    </form>
  );
}
