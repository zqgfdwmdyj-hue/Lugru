"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { hochladenAction, type UploadState } from "./actions";

const alleOk = (s: UploadState) => Boolean(s?.ergebnisse.length && s.ergebnisse.every((r) => r.ok));

export function UploadForm({ firmen }: { firmen: string[] }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(hochladenAction, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: alleOk });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} data-testid="upload-form" className="card card-pad" style={{ padding: 22, borderWidth: 2, borderStyle: "dashed", borderColor: "var(--border-strong)" }}>
        <label className="label" htmlFor="dateien">Dateien auswählen (mehrere oder ZIP) – das System erkennt selbst, was es ist</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input id="dateien" name="dateien" type="file" multiple required className="input" style={{ maxWidth: 520 }} data-testid="upload-dateien" />
          <button className="btn btn-primary" type="submit" disabled={pending} data-testid="upload-los">{pending ? "Wird verarbeitet …" : "Hochladen"}</button>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="small">Angaben für Kontoauszüge (optional)</summary>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }} className="small">
            <label>
              Firma
              <select name="firma" defaultValue={firmen[0]}>
                {firmen.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label>Saldo laut Bank (nur CSV ohne Saldo)<input name="saldo" inputMode="decimal" style={{ width: 120 }} /></label>
          </div>
        </details>
      </form>
      {state?.ergebnisse.map((r, i) => (
        <div key={i} className={`notice ${r.ok ? "notice-ok" : "notice-warn"}`} data-testid="upload-ergebnis" data-art={r.art ?? ""}>
          <strong>{r.datei}</strong> – {r.artText}: {r.text}
          {r.hinweise.length > 0 && <div className="small" style={{ marginTop: 4 }}>{r.hinweise.join(" · ")}</div>}
          {r.link && r.ok && <div className="small"><Link href={r.link}>Ansehen →</Link></div>}
        </div>
      ))}
    </div>
  );
}
