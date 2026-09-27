"use client";

import { useActionState } from "react";
import { createLabelAction, type LabelState } from "../actions";

export function LabelForm({ orderId, weightKg, suggestKlein, disabled }: { orderId: string; weightKg: number | null; suggestKlein: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState<LabelState, FormData>(createLabelAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="orderId" value={orderId} />
      <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <div className="field">
          <label className="label" htmlFor="weightKg">Gewicht (kg)</label>
          <input className="input num" id="weightKg" name="weightKg" defaultValue={weightKg !== null ? String(weightKg).replace(".", ",") : ""} placeholder="z. B. 0,8" style={{ width: 110 }} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="product">Produkt</label>
          <select className="select" id="product" name="product" defaultValue={suggestKlein ? "kleinpaket" : "paket"}>
            <option value="kleinpaket">DHL Kleinpaket</option>
            <option value="paket">DHL Paket</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending || disabled}>{pending ? "Erstelle Label …" : "DHL-Label erstellen"}</button>
      {state && (
        <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>
          {state.message} {state.fileId && <a href={`/datei/${state.fileId}`} target="_blank" rel="noreferrer">Label öffnen & drucken</a>}
        </div>
      )}
    </form>
  );
}
