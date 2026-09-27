"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importFile, type ImportState } from "./actions";

const SOURCE_LABEL = { sellerboard: "Sellerboard-Export", accountone: "AccountOne COG", template: "Eigene Vorlage" };

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importFile, null);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <form action={action} className="card card-pad" style={{ padding: 22, borderWidth: 2, borderStyle: "dashed", borderColor: "var(--border-strong)" }}>
        <label className="label" htmlFor="file">Export aus Arbitrage One (.csv, .xls, .xlsx)</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input id="file" name="file" type="file" accept=".csv,.xls,.xlsx,text/csv" required className="input" style={{ maxWidth: 460 }} />
          <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Wird importiert …" : "Importieren"}</button>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>
          Doppelte Zeilen sind egal: Bekannte SKUs werden aktualisiert, nichts wird doppelt angelegt. Am besten
          regelmäßig die Vorlage „Tool“ (mit FNSKU, Kaufdatum, Menge und EK inkl. Versand) exportieren.
        </p>
      </form>

      {state && !state.ok && <div className="notice notice-error">{state.error}</div>}
      {state?.ok && (
        <div className="card card-pad stack">
          <div className="notice notice-ok">
            <strong>{state.fileName}</strong> importiert ({SOURCE_LABEL[state.stats.source]}): {state.stats.rows} Zeilen,
            {" "}{state.stats.created} neu, {state.stats.updated} aktualisiert.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, fontSize: 13 }}>
            <div><div className="muted">SKU-Schemata</div><div className="num">{Object.entries(state.stats.schemas).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></div>
            <div><div className="muted">Retouren mit geerbtem EK</div><div className="num">{state.stats.returnsInherited}</div></div>
            <div><div className="muted">Retouren ohne Ursprung</div><div className="num">{state.stats.returnsWithoutOrigin > 0 ? <Link href="/chargen?filter=ohne-ek">{state.stats.returnsWithoutOrigin}</Link> : 0}</div></div>
            <div><div className="muted">EK-Abweichungen zwischen Exporten</div><div className="num">{state.stats.costConflicts > 0 ? <Link href="/chargen?filter=abweichung">{state.stats.costConflicts}</Link> : 0}</div></div>
          </div>
          {state.stats.skipped.length > 0 && (
            <div className="notice notice-warn">
              {state.stats.skipped.length} Zeilen übersprungen, z. B. Zeile {state.stats.skipped[0].line}: {state.stats.skipped[0].reason}
            </div>
          )}
          <div className="small muted">Stichtag für SKUs ohne Jahr: {state.stats.referenceDate} (aus dem Dateinamen bzw. heute).</div>
        </div>
      )}
    </div>
  );
}
