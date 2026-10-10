"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { computeB2b, looksLikeRc13bGoods, RC13B_THRESHOLD, suggestTaxCase, TAX_CASE_LABEL, COUNTRY_NAMES, EU_COUNTRIES } from "@/lib/ebay/invoices/b2b";
import type { TaxCase } from "@/lib/ebay/invoices/types";
import { parseAmount } from "@/lib/numbers";

export type DraftPrefill = {
  id: string;
  ticket: string;
  customerId: string | null;
  serviceDate: string;
  serviceDateTo?: string;
  paymentDays: number;
  reference?: string;
  note?: string;
  rcWhole: boolean;
  mailCustomer: boolean;
  lines: { desc: string; qty: string; unit: string; price: string; vat: string; device: boolean }[];
  warnings: string[];
};
type Customer = { id: string; name: string; contact: string; street: string; zip: string; city: string; country: string; vatId: string; email: string; customerNumber: string };
/** `device`: § 13b-Ware; `deviceSet`: von Hand gesetzt – dann kein automatischer Vorschlag mehr. */
type Line = { key: number; desc: string; qty: string; unit: string; price: string; vat: string; device: boolean; deviceSet?: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const EMPTY: Omit<Customer, "id"> = { name: "", contact: "", street: "", zip: "", city: "", country: "DE", vatId: "", email: "", customerNumber: "" };
const COUNTRIES = [...new Set(["DE", "AT", "CH", "NL", "BE", "LU", "FR", "IT", "ES", "PL", "CZ", "DK", "SE", ...EU_COUNTRIES, "GB", "NO", "US"])];

function CreateButton({ nextNumber }: { nextNumber: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" type="submit" disabled={pending} data-testid="create-invoice">
      {pending ? "Wird erstellt …" : `Rechnung ${nextNumber} erstellen`}
    </button>
  );
}

export function B2bForm(props: {
  action: (fd: FormData) => Promise<void>;
  customers: Customer[];
  nextNumber: string;
  paymentDays: number;
  kleinunternehmer: boolean;
  sellerVatId: string;
  stotax: string | null;
  hasIban: boolean;
  /** Aus der Kundenliste „Rechnung schreiben“ – Kunde vorausgewählt. */
  initialCustomerId?: string;
  /** Entwurf aus dem Rechnungshelfer: alles vorausgefüllt, beim Erstellen wird er abgehakt. */
  draft?: DraftPrefill;
}) {
  const d = props.draft;
  const initial = props.customers.find((x) => x.id === (d?.customerId ?? props.initialCustomerId));
  const [c, setC] = useState<Omit<Customer, "id">>(initial ? { ...EMPTY, ...initial } : EMPTY);
  const [taxCase, setTaxCase] = useState<TaxCase>(initial ? suggestTaxCase(initial.country, initial.vatId) : "domestic");
  const [manualTax, setManualTax] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    d?.lines.length
      ? d.lines.map((l, i) => ({ key: i + 1, desc: l.desc, qty: l.qty, unit: l.unit, price: l.price, vat: l.vat, device: l.device, deviceSet: true }))
      : [{ key: 1, desc: "", qty: "1", unit: "Stk", price: "", vat: "19", device: false }],
  );
  const [rcWhole, setRcWhole] = useState(Boolean(d?.rcWhole));

  const setField = (k: keyof typeof EMPTY, v: string) => {
    const next = { ...c, [k]: v };
    setC(next);
    if (!manualTax && (k === "country" || k === "vatId")) setTaxCase(suggestTaxCase(next.country, next.vatId));
  };
  const pick = (id: string) => {
    const found = props.customers.find((x) => x.id === id);
    const next = found ? { ...EMPTY, ...found } : EMPTY;
    setC(next);
    if (!manualTax) setTaxCase(suggestTaxCase(next.country, next.vatId));
  };
  // Bezeichnung geändert → § 13b-Ware vorschlagen, solange der Haken nicht von Hand gesetzt wurde.
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch, ...(patch.desc !== undefined && !l.deviceSet ? { device: looksLikeRc13bGoods(patch.desc) } : {}) } : l)));

  const totals = useMemo(
    () =>
      computeB2b(
        {
          taxCase,
          rcWhole,
          lines: lines.map((l) => ({ description: l.desc, quantity: parseAmount(l.qty) ?? 0, unitNet: parseAmount(l.price) ?? 0, vatRate: Number(l.vat), device: l.device })),
        },
        props.kleinunternehmer,
      ),
    [lines, taxCase, rcWhole, props.kleinunternehmer],
  );
  const free = props.kleinunternehmer || taxCase !== "domestic";
  const field = (k: keyof typeof EMPTY, label: string, opts: { req?: boolean; width?: string; placeholder?: string; type?: string } = {}) => (
    <div className="field" style={{ flex: opts.width ?? "1 1 180px", minWidth: 0 }}>
      <label className="label" htmlFor={`c-${k}`}>{label}</label>
      <input className="input" id={`c-${k}`} name={k} type={opts.type ?? "text"} value={c[k]} required={opts.req} placeholder={opts.placeholder} onChange={(e) => setField(k, e.target.value)} />
    </div>
  );

  return (
    <form action={props.action} className="stack" data-testid="b2b-form">
      {d && (
        <div className={`notice ${d.warnings.length ? "notice-warn" : "notice-info"} small`} data-testid="draft-note">
          <strong>Aus dem Rechnungshelfer: Ticket {d.ticket}</strong> – Positionen, Sendungen, Leistungsdatum und Zahlungsziel sind übernommen.
          {d.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          <input type="hidden" name="draftId" value={d.id} />
        </div>
      )}
      <section className="card card-pad stack" style={{ gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <h2>Kunde</h2>
          {props.customers.length > 0 && (
            <div className="field" style={{ minWidth: 220 }}>
              <label className="label" htmlFor="c-pick">Gespeicherter Kunde</label>
              <select className="select" id="c-pick" defaultValue={initial?.id ?? ""} onChange={(e) => pick(e.target.value)}>
                <option value="">– neu –</option>
                {props.customers.map((x) => <option key={x.id} value={x.id}>{x.name}{x.city ? `, ${x.city}` : ""}</option>)}
              </select>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {field("name", "Firma", { req: true, width: "2 1 260px" })}
          {field("contact", "Ansprechpartner (optional)")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {field("street", "Straße und Nr.", { req: true, width: "2 1 240px" })}
          {field("zip", "PLZ", { req: true, width: "0 1 100px" })}
          {field("city", "Ort", { req: true })}
          <div className="field" style={{ flex: "0 1 170px" }}>
            <label className="label" htmlFor="c-country">Land</label>
            <select className="select" id="c-country" name="country" value={c.country} onChange={(e) => setField("country", e.target.value)}>
              {COUNTRIES.map((k) => <option key={k} value={k}>{k} – {COUNTRY_NAMES[k] ?? k}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {field("vatId", "USt-IdNr. des Kunden", { placeholder: "z. B. ATU12345678" })}
          {field("email", "E-Mail für die Rechnung", { type: "email" })}
          {field("customerNumber", "Kundennummer (optional)", { width: "0 1 160px" })}
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Rechnung</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "2 1 300px" }}>
            <label className="label" htmlFor="r-tax">Steuerfall</label>
            <select className="select" id="r-tax" name="taxCase" value={taxCase} onChange={(e) => { setTaxCase(e.target.value as TaxCase); setManualTax(true); }} disabled={props.kleinunternehmer}>
              {(Object.keys(TAX_CASE_LABEL) as TaxCase[]).map((k) => <option key={k} value={k}>{TAX_CASE_LABEL[k]}</option>)}
            </select>
            {props.kleinunternehmer && <input type="hidden" name="taxCase" value="domestic" />}
          </div>
          <div className="field" style={{ flex: "0 1 160px" }}><label className="label" htmlFor="r-sd">Liefer-/Leistungsdatum</label><input className="input" type="date" id="r-sd" name="serviceDate" defaultValue={d?.serviceDate ?? today()} required /></div>
          <div className="field" style={{ flex: "0 1 160px" }}><label className="label" htmlFor="r-sd2">bis (Zeitraum, optional)</label><input className="input" type="date" id="r-sd2" name="serviceDateTo" defaultValue={d?.serviceDateTo ?? ""} /></div>
          <div className="field" style={{ flex: "0 1 110px" }}><label className="label" htmlFor="r-pd">Zahlungsziel (Tage)</label><input className="input num" id="r-pd" name="paymentDays" defaultValue={d?.paymentDays ?? props.paymentDays} /></div>
          <div className="field" style={{ flex: "1 1 180px" }}><label className="label" htmlFor="r-ref">Ihre Referenz / Bestellnr. (optional)</label><input className="input" id="r-ref" name="reference" defaultValue={d?.reference ?? ""} /></div>
        </div>
        {(taxCase === "eu_supply" || taxCase === "reverse_charge") && !props.sellerVatId && (
          <div className="notice notice-warn small">Für steuerfreie EU-Rechnungen brauchst du eine eigene USt-IdNr. (Einstellungen → Rechnungen).</div>
        )}
        {!props.hasIban && <div className="small muted">Tipp: Bankverbindung in der Übersicht hinterlegen – dann steht sie auf der Rechnung und in der E-Rechnung.</div>}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Positionen (Preise netto)</h2>
        {lines.map((l, i) => (
          <div key={l.key} data-testid="line" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
            <div className="field" style={{ flex: "3 1 260px", minWidth: 0 }}><label className="label" htmlFor={`l-d-${l.key}`}>{i + 1}. Bezeichnung</label><input className="input" id={`l-d-${l.key}`} name="l_desc" value={l.desc} onChange={(e) => setLine(l.key, { desc: e.target.value })} /></div>
            <div className="field" style={{ flex: "0 1 80px" }}><label className="label" htmlFor={`l-q-${l.key}`}>Menge</label><input className="input num" id={`l-q-${l.key}`} name="l_qty" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></div>
            <div className="field" style={{ flex: "0 1 80px" }}><label className="label" htmlFor={`l-u-${l.key}`}>Einheit</label><input className="input" id={`l-u-${l.key}`} name="l_unit" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} /></div>
            <div className="field" style={{ flex: "0 1 120px" }}><label className="label" htmlFor={`l-p-${l.key}`}>Einzelpreis € netto</label><input className="input num" id={`l-p-${l.key}`} name="l_price" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} /></div>
            <div className="field" style={{ flex: "0 1 90px" }}>
              <label className="label" htmlFor={`l-v-${l.key}`}>USt</label>
              <select className="select" id={`l-v-${l.key}`} name="l_vat" value={free ? "0" : l.vat} disabled={free} onChange={(e) => setLine(l.key, { vat: e.target.value })}>
                <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option>
              </select>
              {free && <input type="hidden" name="l_vat" value="0" />}
            </div>
            <label className="small" style={{ display: "flex", gap: 4, alignItems: "center", paddingBottom: 8 }} title="§ 13b Abs. 2 Nr. 10 UStG: Mobilfunkgeräte, Tablets, Spielekonsolen, integrierte Schaltkreise (z. B. Prozessoren)">
              <input type="checkbox" checked={l.device} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, device: e.target.checked, deviceSet: true } : x)))} data-testid="line-rc" />
              § 13b-Ware
            </label>
            <input type="hidden" name="l_rc" value={l.device ? "1" : "0"} />
            {lines.length > 1 && <button type="button" className="btn-link small" style={{ color: "var(--muted)", paddingBottom: 8 }} onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={`Position ${i + 1} entfernen`}>entfernen</button>}
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-small" onClick={() => setLines([...lines, { key: Math.max(...lines.map((x) => x.key)) + 1, desc: "", qty: "1", unit: "Stk", price: "", vat: lines[lines.length - 1]?.vat ?? "19", device: false }])}>+ Position</button>
        </div>
        {taxCase === "domestic" && !props.kleinunternehmer && lines.some((l) => l.device) && (
          <div className={`notice ${totals.rc13b.applies ? "notice-info" : "notice-warn"} small`} data-testid="rc-hint">
            {totals.rc13b.applies
              ? `§ 13b Abs. 2 Nr. 10: Handys/Tablets/Konsolen/Chips zusammen ${euro(totals.rc13b.deviceNet)} netto${totals.rc13b.deviceNet < RC13B_THRESHOLD ? " (Teil eines Vorgangs ab 5.000 €)" : ""} – diese Positionen ohne USt („RC“), der Kunde schuldet die Steuer. Hinweis und USt-IdNr. des Kunden kommen auf die Rechnung.`
              : `§ 13b-Ware zusammen ${euro(totals.rc13b.deviceNet)} netto – unter 5.000 €, daher normale Umsatzsteuer.`}
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
              <input type="checkbox" name="rcWhole" checked={rcWhole} onChange={(e) => setRcWhole(e.target.checked)} />
              Gehört zu einer Bestellung, bei der diese Waren insgesamt ≥ 5.000 € netto ausmachen (z. B. Teillieferung)
            </label>
          </div>
        )}
        <div className="small" style={{ alignSelf: "flex-end", textAlign: "right" }} data-testid="totals">
          <div>Netto: <strong className="num">{euro(totals.totalNet)}</strong></div>
          {totals.vat.filter((v) => v.rate > 0).map((v) => <div key={v.rate}>USt {v.rate} %: <span className="num">{euro(v.vat)}</span></div>)}
          {totals.vat.filter((v) => v.rc).map((v) => <div key="rc">§ 13b (Steuer schuldet der Kunde) auf <span className="num">{euro(v.net)}</span>: <span className="num">0,00 €</span></div>)}
          {free && <div className="muted">ohne Umsatzsteuer ({props.kleinunternehmer ? "§ 19 UStG" : TAX_CASE_LABEL[taxCase]})</div>}
          <div style={{ fontSize: 15 }}>Rechnungsbetrag: <strong className="num">{euro(totals.totalGross)}</strong></div>
        </div>
        <div className="field"><label className="label" htmlFor="r-note">Hinweis auf der Rechnung (optional)</label><textarea className="textarea" id="r-note" name="note" style={{ minHeight: 50 }} defaultValue={d?.note ?? ""} /></div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="saveCustomer" defaultChecked /> Kunde für die nächste Rechnung speichern</label>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="mailCustomer" disabled={!c.email} defaultChecked={Boolean(d?.mailCustomer)} /> Rechnung gleich an den Kunden mailen (PDF + E-Rechnung)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" type="submit" formAction="/rechnungen/ausgang/vorschau" formTarget="_blank" formMethod="post" data-testid="preview">Vorschau (PDF)</button>
          <CreateButton nextNumber={props.nextNumber} />
        </div>
        <div className="small muted">
          Mit dem Erstellen wird die Nummer {props.nextNumber} vergeben; danach ist die Rechnung unveränderlich (Korrektur nur per Storno).{props.stotax ? ` Sie ${props.stotax}.` : ""}
        </div>
      </section>
    </form>
  );
}
