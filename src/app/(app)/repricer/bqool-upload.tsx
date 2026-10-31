"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { BQOOL_MAERKTE } from "@/lib/bqool/logic";
import { importBqoolAction, type BqoolState } from "./actions";

/** BQool-Export hochladen. Nach Erfolg leert sich die Dateiauswahl, bei Fehlern bleibt alles stehen. */
export function BqoolUpload() {
  const [state, action, pending] = useActionState<BqoolState, FormData>(importBqoolAction, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: (s) => Boolean(s?.ok) });
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 8 }} data-testid="bqool-upload">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" type="file" name="datei" accept=".csv,.tsv,.txt,.xlsx,.xls" required style={{ maxWidth: 340 }} aria-label="BQool-Export" />
        <select className="select" name="markt" defaultValue="DE" aria-label="Marktplatz der Datei" style={{ width: "auto" }}>
          {BQOOL_MAERKTE.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Liest ein …" : "BQool-Export einlesen"}</button>
      </div>
      <div className="small muted">In BQool: Repricing Central → Manage Listings → Export. Der Marktplatz gilt nur, wenn die Datei keine Marktplatz-Spalte hat. Ein neuer Export ersetzt den Stand dieses Marktplatzes.</div>
      {state && (
        <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`} role="status" data-testid="bqool-result">
          {state.message}
          {state.erkannt?.length ? <details style={{ marginTop: 4 }}><summary>Erkannte Spalten</summary>{state.erkannt.join(" · ")}</details> : null}
        </div>
      )}
    </form>
  );
}
