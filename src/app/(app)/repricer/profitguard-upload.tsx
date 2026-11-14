"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { PG_MAERKTE } from "@/lib/repricing/profitguard-logic";
import { importProfitguardAction, type PgImportState } from "./actions";

/** ProfitGuard-Export hochladen. Nach Erfolg leert sich die Dateiauswahl, bei Fehlern bleibt alles stehen. */
export function ProfitguardUpload() {
  const [state, action, pending] = useActionState<PgImportState, FormData>(importProfitguardAction, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: (s) => Boolean(s?.ok) });
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 8 }} data-testid="profitguard-upload">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" type="file" name="datei" accept=".csv,.tsv,.txt,.xlsx,.xls" required style={{ maxWidth: 340 }} aria-label="ProfitGuard-Export" />
        <select className="select" name="markt" defaultValue="" aria-label="Marktplatz der Datei" style={{ width: "auto" }}>
          <option value="">Marktplatz aus der Datei</option>
          {PG_MAERKTE.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Liest ein …" : "ProfitGuard-Export einlesen"}</button>
      </div>
      <div className="small muted">In ProfitGuard: „Export & Import“ → Export (CSV oder XLSX). Der Marktplatz gilt nur, wenn die Datei keine Marktplatz-Spalte hat. Ein neuer Export ersetzt den Stand dieses Marktplatzes; das Format merkt sich das System für die Importdatei.</div>
      {state && (
        <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid="profitguard-result">
          {state.message}
          {state.erkannt?.length ? <details style={{ marginTop: 4 }}><summary>Erkannte Spalten</summary>{state.erkannt.join(" · ")}</details> : null}
        </div>
      )}
    </form>
  );
}
