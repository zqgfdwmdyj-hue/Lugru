"use client";

import { useActionState } from "react";
import { addItemAction, createPoAction, draftsFromSuggestions, receiveAction, updatePoAction, type PoState } from "./actions";

function Notice({ state }: { state: PoState }) {
  if (!state) return null;
  return <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>;
}

export function NewPoForm({ suppliers, today }: { suppliers: { code: string; name: string | null }[]; today: string }) {
  const [state, action, pending] = useActionState<PoState, FormData>(createPoAction, null);
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 10 }}>
      <h2>Neue Bestellung</h2>
      <div className="field">
        <label className="label" htmlFor="supplier">Lieferant / Shop (Kürzel)</label>
        <input className="input" id="supplier" name="supplier" list="supplier-list" required placeholder="z. B. KAUFL, AMZIT, SMY" />
        <datalist id="supplier-list">{suppliers.map((s) => <option key={s.code} value={s.code}>{s.name ?? ""}</option>)}</datalist>
        <span className="small muted">Das Kürzel steht später vorn in der SKU.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="supplierOrderNo">Bestellnummer beim Shop</label>
        <input className="input" id="supplierOrderNo" name="supplierOrderNo" placeholder="für die automatische Rechnungszuordnung" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="field"><label className="label" htmlFor="orderDate">Bestellt am</label><input className="input" id="orderDate" name="orderDate" type="date" defaultValue={today} /></div>
        <div className="field"><label className="label" htmlFor="expectedDate">Lieferung erwartet</label><input className="input" id="expectedDate" name="expectedDate" type="date" /></div>
      </div>
      <Notice state={state} />
      <div><button className="btn btn-primary" type="submit" disabled={pending}>Anlegen</button></div>
    </form>
  );
}

export function AddItemForm({ poId }: { poId: string }) {
  const [state, action, pending] = useActionState<PoState, FormData>(addItemAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 8, padding: 14, borderTop: "1px solid var(--border)" }}>
      <input type="hidden" name="poId" value={poId} />
      <div className="po-add">
        <input className="input" name="asin" required placeholder="ASIN" aria-label="ASIN" maxLength={10} style={{ fontFamily: "var(--mono)" }} />
        <input className="input" name="title" placeholder="Bezeichnung (optional)" aria-label="Bezeichnung" />
        <input className="input" name="quantity" required inputMode="numeric" placeholder="Menge" aria-label="Menge" />
        <input className="input" name="unitCostGross" required inputMode="decimal" placeholder="EK brutto" aria-label="EK brutto je Stück" />
        <select className="input" name="vatRate" defaultValue="19" aria-label="MwSt"><option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option></select>
        <input className="input" name="targetPrice" inputMode="decimal" placeholder="VK geplant" aria-label="Geplanter Verkaufspreis" />
        <button className="btn" type="submit" disabled={pending}>+ Position</button>
      </div>
      <Notice state={state?.ok ? null : state} />
    </form>
  );
}

type PoFields = { id: string; supplierOrderNo: string | null; orderDate: string | null; expectedDate: string | null; carrier: string | null; trackingNumber: string | null; shippingCostGross: number | null; notes: string | null };

export function PoEditForm({ po }: { po: PoFields }) {
  const [state, action, pending] = useActionState<PoState, FormData>(updatePoAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="poId" value={po.id} />
      <div className="field"><label className="label" htmlFor="po-no">Bestellnummer beim Shop</label><input className="input" id="po-no" name="supplierOrderNo" defaultValue={po.supplierOrderNo ?? ""} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="field"><label className="label" htmlFor="po-od">Bestellt am</label><input className="input" id="po-od" name="orderDate" type="date" defaultValue={po.orderDate ?? ""} /></div>
        <div className="field"><label className="label" htmlFor="po-ed">Lieferung erwartet</label><input className="input" id="po-ed" name="expectedDate" type="date" defaultValue={po.expectedDate ?? ""} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8 }}>
        <div className="field"><label className="label" htmlFor="po-c">Versand</label><input className="input" id="po-c" name="carrier" defaultValue={po.carrier ?? ""} placeholder="DHL" /></div>
        <div className="field"><label className="label" htmlFor="po-t">Sendungsnummer</label><input className="input" id="po-t" name="trackingNumber" defaultValue={po.trackingNumber ?? ""} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="po-s">Versandkosten brutto</label><input className="input" id="po-s" name="shippingCostGross" inputMode="decimal" defaultValue={po.shippingCostGross ?? ""} /></div>
      <div className="field"><label className="label" htmlFor="po-n">Notiz</label><textarea className="textarea" id="po-n" name="notes" defaultValue={po.notes ?? ""} style={{ minHeight: 60 }} /></div>
      <Notice state={state} />
      <div><button className="btn btn-small" type="submit" disabled={pending}>Speichern</button></div>
    </form>
  );
}

export function ReceiveForm({ poId, items }: { poId: string; items: { id: string; asin: string; title: string | null; open: number }[] }) {
  const [state, action, pending] = useActionState<PoState, FormData>(receiveAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="poId" value={poId} />
      <div className="small muted">Gelieferte Menge je Position eintragen (vorbelegt mit dem offenen Rest). Es entstehen Chargen mit SKU und der Bestand im eigenen Lager steigt.</div>
      {items.map((i) => (
        <label key={i.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input className="input" name={`qty:${i.id}`} inputMode="numeric" defaultValue={i.open} style={{ width: 70 }} aria-label={`Menge ${i.asin}`} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="num">{i.asin}</span> {i.title}</span>
        </label>
      ))}
      <input className="input" name="location" placeholder="Lagerplatz (optional), z. B. Regal A3" />
      <Notice state={state} />
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Buche …" : "Wareneingang buchen"}</button></div>
    </form>
  );
}

export function SuggestSubmit({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<PoState, FormData>(draftsFromSuggestions, null);
  return (
    <form action={action} className="stack">
      {children}
      <Notice state={state} />
      <div><button className="btn btn-primary" type="submit" disabled={pending}>Angekreuzte als Bestellentwurf anlegen</button></div>
    </form>
  );
}
