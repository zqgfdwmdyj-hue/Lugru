"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { batchLabels, type BatchState } from "./actions";

/** Umschließt die Auftragstabelle; erzeugt Labels für die ausgewählten Aufträge. */
export function BatchForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<BatchState, FormData>(batchLabels, null);
  const keepAction = useKeepForm(state, action);
  const ok = state?.results.filter((r) => r.ok) ?? [];
  return (
    <form action={action} ref={keepAction.ref} onSubmit={keepAction.onSubmit} className="stack">
      {children}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          type="button"
          data-testid="auto-labels"
          onClick={(e) => {
            const ids = [...(e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked') ?? [])].map((c) => c.value);
            if (!ids.length) return alert("Bitte Aufträge auswählen.");
            window.location.href = `/auftraege/lieferschein?ids=${ids.join(",")}`;
          }}
        >
          Labels automatisch (Warensendung, wenn sie passt – sonst DHL) …
        </button>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Erstelle Labels …" : "Nur DHL-Labels für Auswahl"}</button>
        <span className="small muted">Gewicht aus den Artikeldaten + 150 g Verpackung; bis zur Kleinpaket-Grenze automatisch als Kleinpaket.</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn"
          type="button"
          data-testid="address-labels"
          onClick={(e) => {
            const ids = [...(e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked') ?? [])].map((c) => c.value);
            if (!ids.length) return alert("Bitte Aufträge auswählen.");
            window.open(`/auftraege/adressetiketten?ids=${ids.join(",")}`, "_blank");
          }}
        >
          Adressetiketten 62 × 29 mm (Auswahl)
        </button>
        <span className="small muted">Nur Name und Anschrift – z. B. für Bücher- und Warensendungen. Drucken mit dem QL-800: Papier 62 mm × 29 mm, Skalierung 100 % (tatsächliche Größe).</span>
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
