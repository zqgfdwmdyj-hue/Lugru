"use client";

import { useActionState } from "react";
import type { FeedMapping } from "@/db/schema";
import { uploadFeed, type FeedState } from "../actions";

const FIELDS: [keyof FeedMapping, string][] = [["supplierSku", "Artikelnummer Lieferant *"], ["ean", "EAN"], ["asin", "ASIN"], ["title", "Titel"], ["price", "EK-Preis"], ["stock", "Bestand"], ["moq", "Mindestabnahme"]];

export function FeedUpload({ feedId, mapping }: { feedId: string; mapping: FeedMapping }) {
  const [state, action, pending] = useActionState<FeedState, FormData>(uploadFeed, null);
  const headers = state?.headers;
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 10 }}>
      <input type="hidden" name="feedId" value={feedId} />
      <h2>Feed hochladen (CSV/XLSX)</h2>
      <input className="input" name="file" type="file" accept=".csv,.txt,.xls,.xlsx" required aria-label="Feed-Datei" />
      <div className="small muted">Spalten (EAN/GTIN, Preis, Bestand, Mindestabnahme …) werden automatisch erkannt – auch beim Qogita-Katalog-Export.</div>
      <label className="small" style={{ display: "flex", gap: 6 }}><input type="checkbox" name="full" defaultChecked /> Vollständige Liste – was fehlt, ist nicht mehr lieferbar</label>
      <label className="small" style={{ display: "flex", gap: 6 }}><input type="checkbox" name="keepa" defaultChecked /> Danach neue und geänderte Preise mit Keepa prüfen</label>
      {headers && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {FIELDS.map(([k, label]) => (
            <div className="field" key={k}>
              <label className="label" htmlFor={`m-${k}`}>{label}</label>
              <select className="select" id={`m-${k}`} name={`map_${k}`} defaultValue={mapping[k] ?? ""}>
                <option value="">–</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Lese …" : headers ? "Mit dieser Zuordnung importieren (Datei erneut wählen)" : "Hochladen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
      {FIELDS.some(([k]) => mapping[k]) && <div className="small muted">Gespeicherte Zuordnung: {FIELDS.filter(([k]) => mapping[k]).map(([k, l]) => `${l.replace(" *", "")} = „${mapping[k]}“`).join(", ")}</div>}
    </form>
  );
}
