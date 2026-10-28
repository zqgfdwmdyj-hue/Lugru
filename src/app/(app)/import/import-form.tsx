"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { importFiles, type ImportAllState } from "./actions";

const allOk = (s: ImportAllState) => Boolean(s?.results.length && s.results.every((r) => r.ok));

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportAllState, FormData>(importFiles, null);
  // Auswahl erst leeren, wenn alle Dateien übernommen wurden – sonst stehen sie für einen zweiten Versuch noch da.
  const keep = useKeepForm(state, action, { resetOnSuccess: allOk });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} data-testid="import-form" className="card card-pad" style={{ padding: 22, borderWidth: 2, borderStyle: "dashed", borderColor: "var(--border-strong)" }}>
        <label className="label" htmlFor="files">Dateien auswählen (mehrere möglich) – das System erkennt selbst, was es ist</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input id="files" name="files" type="file" multiple accept=".csv,.txt,.tsv,.xls,.xlsx,text/csv,text/plain" required className="input" style={{ maxWidth: 520 }} />
          <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Wird importiert …" : "Importieren"}</button>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>Doppelte Zeilen sind egal – bereits bekannte Daten werden erkannt und nicht doppelt angelegt.</p>
      </form>
      {state?.results.map((r, i) => (
        <div key={i} className={`notice ${r.ok ? "notice-ok" : "notice-error"}`}>
          <strong>{r.fileName}</strong>{r.label ? ` – ${r.label}` : ""}: {r.summary}
          {r.hints && r.hints.length > 0 && <div className="small" style={{ marginTop: 4 }}>{r.hints.join(" · ")}</div>}
        </div>
      ))}
    </div>
  );
}
