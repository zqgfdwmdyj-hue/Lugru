import { UNITS_SOURCE_LABEL, type UnitsSource } from "@/lib/suppliers/scan";
import { amazonQtyAction } from "./actions";

/** Stück je Amazon-Verkauf anzeigen und korrigieren (leer = automatisch). */
export function QtyEdit({ feedId, offerId, units, source, amazonQty, open }: { feedId: string; offerId: string; units: number; source: UnitsSource; amazonQty: number | null; open?: boolean }) {
  const how = source ? UNITS_SOURCE_LABEL[source] : "keine Stückzahl erkannt – 1 Stück angenommen";
  return (
    <details className="small" data-testid="qty-edit" open={open} style={{ textAlign: "right" }}>
      <summary className="muted" style={{ cursor: "pointer", listStyle: "none" }} title={`Wie viele Einheiten des Lieferanten enthält ein Amazon-Verkauf? (${how})`}>
        {units} Stk je Verkauf{source === "hand" ? " ✎" : ""}
      </summary>
      <form action={amazonQtyAction} style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
        <input type="hidden" name="feedId" value={feedId} />
        <input type="hidden" name="offerId" value={offerId} />
        <input className="input num" name="qty" defaultValue={amazonQty ?? ""} placeholder={source === "hand" ? String(units) : `auto ${units}`} style={{ width: 70 }} aria-label="Stück je Amazon-Verkauf" />
        <button className="btn btn-small" type="submit">OK</button>
      </form>
      <div className="muted" style={{ marginTop: 2 }}>{how}</div>
    </details>
  );
}
