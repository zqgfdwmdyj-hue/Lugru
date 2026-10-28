"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSubmitKey } from "@/lib/use-submit-key";
import { addCharge, markInvoicedAction, markPaidAction, saveLocationsAction, savePalletCustomer, savePalletRates, sendStatementAction, undoInvoicedAction, type ChargeState, type SaveState, type SendState } from "./actions";

const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

/** Zusatzleistung erfassen (Folieren, Umpacken …) – Preis aus der Leistungsliste vorbelegt. */
export function ChargeForm({ customers, services, pallets, today, customer, pallet }: { customers: string[]; services: { name: string; price: number }[]; pallets: string[]; today: string; customer?: string | null; pallet?: { id: string; code: string } }) {
  const [state, action, pending] = useActionState<ChargeState, FormData>(addCharge, null);
  const submitKey = useSubmitKey();
  const price = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state) submitKey.settled();
    if (state?.ok) {
      form.current?.querySelectorAll<HTMLInputElement>("input[name=description], input[name=unitPrice]").forEach((i) => (i.value = ""));
      const q = form.current?.querySelector<HTMLInputElement>("input[name=quantity]");
      if (q) q.value = "1";
    }
  }, [state]);
  return (
    <form ref={form} action={(fd: FormData) => action(submitKey.stamp(fd))} className="stack" style={{ gap: 10 }} data-testid="charge-form">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        {pallet ? (
          <input type="hidden" name="pallet" value={pallet.id} />
        ) : (
          <div className="field">
            <label className="label" htmlFor="ch-pallet">Palette (optional)</label>
            <input className="input" id="ch-pallet" name="pallet" list="ch-pallets" autoComplete="off" placeholder="z. B. P-0012" />
            <datalist id="ch-pallets">{pallets.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="ch-customer">Kunde</label>
          <input className="input" id="ch-customer" name="customer" list="ch-customers" autoComplete="off" defaultValue={customer ?? ""} placeholder={pallet ? "wie Palette" : ""} />
          <datalist id="ch-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label className="label" htmlFor="ch-desc">Leistung</label>
          <input
            className="input"
            id="ch-desc"
            name="description"
            list="ch-services"
            autoComplete="off"
            required
            placeholder="z. B. Folieren"
            onChange={(e) => {
              const s = services.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
              if (s && price.current) price.current.value = num(s.price);
            }}
          />
          <datalist id="ch-services">{services.map((s) => <option key={s.name} value={s.name}>{`${num(s.price)} €`}</option>)}</datalist>
        </div>
        <div className="field">
          <label className="label" htmlFor="ch-qty">Menge</label>
          <input className="input" id="ch-qty" name="quantity" inputMode="decimal" defaultValue="1" />
        </div>
        <div className="field">
          <label className="label" htmlFor="ch-price">Preis je Einheit (€)</label>
          <input ref={price} className="input" id="ch-price" name="unitPrice" inputMode="decimal" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="ch-day">Datum</label>
          <input className="input" id="ch-day" name="day" type="date" defaultValue={today} max={today} />
        </div>
      </div>
      <button className="btn btn-primary btn-small" type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>{pending ? "Speichere …" : "Leistung erfassen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="charge-result">{state.message}</div>}
    </form>
  );
}

/** Monatsaufstellung an den Kunden mailen. */
export function SendStatementButton({ customer, month, email, sentAt, error }: { customer: string; month: string; email: string | null; sentAt: string | null; error: string | null }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendStatementAction, null);
  if (!email) return <span className="small muted">keine E-Mail hinterlegt</span>;
  return (
    <form action={action} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="customer" value={customer} />
      <input type="hidden" name="month" value={month} />
      <button
        className="btn btn-small"
        type="submit"
        disabled={pending}
        title={`An ${email} senden`}
        onClick={(e) => {
          if (sentAt && !confirm(`Die Aufstellung ging schon am ${sentAt} raus. Nochmal an ${email} senden?`)) e.preventDefault();
        }}
        data-testid="send-statement"
      >
        {pending ? "Sende …" : sentAt ? "Nochmal senden" : "Per Mail senden"}
      </button>
      {state ? (
        <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="send-result">{state.message}</span>
      ) : sentAt ? (
        <span className="small muted">gesendet {sentAt}</span>
      ) : error ? (
        <span className="small" style={{ color: "var(--danger)" }}>Fehler: {error}</span>
      ) : null}
    </form>
  );
}

type Rates = { pricePerMonth: number; freeDays: number; mode: "monat" | "anteilig"; inFee: number; outFee: number; capacity: number; longStayDays: number; remindFreeEnd: boolean; shipmentMail?: boolean; servicesText: string; locationsSpec: string; locationsCount: number; pricesAre: "netto" | "brutto"; month: string };

/** „Gilt ab“ für Preisänderungen – frühere Monate behalten die damaligen Konditionen. */
function ValidFrom({ id, month }: { id: string; month: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>Preisänderung gilt ab Monat</label>
      <input className="input" id={id} name="validFrom" type="month" defaultValue={month} min={month} />
    </div>
  );
}

/** Standard-Konditionen und Einstellungen des Palettenlagers (Inhaber). */
export function RatesForm({ rates }: { rates: Rates }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(savePalletRates, null);
  return (
    <form action={action} className="stack" style={{ gap: 12 }} data-testid="rates-form">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div className="field"><label className="label" htmlFor="r-price">Preis je Stellplatz und Monat (€)</label><input className="input" id="r-price" name="pricePerMonth" inputMode="decimal" defaultValue={num(rates.pricePerMonth)} /></div>
        <div className="field"><label className="label" htmlFor="r-free">Kostenfreie Tage</label><input className="input" id="r-free" name="freeDays" type="number" min={0} max={365} defaultValue={rates.freeDays} /></div>
        <div className="field">
          <label className="label" htmlFor="r-mode">Abrechnung</label>
          <select className="select" id="r-mode" name="mode" defaultValue={rates.mode}>
            <option value="monat">Voller Monatspreis je angefangenem Monat</option>
            <option value="anteilig">Tagesgenau anteilig</option>
          </select>
        </div>
        <div className="field"><label className="label" htmlFor="r-in">Gebühr Einlagern je Palette (€)</label><input className="input" id="r-in" name="inFee" inputMode="decimal" defaultValue={num(rates.inFee)} placeholder="0" /></div>
        <div className="field"><label className="label" htmlFor="r-out">Gebühr Auslagern je Palette (€)</label><input className="input" id="r-out" name="outFee" inputMode="decimal" defaultValue={num(rates.outFee)} placeholder="0" /></div>
        <div className="field"><label className="label" htmlFor="r-cap">Stellplätze gesamt</label><input className="input" id="r-cap" name="capacity" type="number" min={0} defaultValue={rates.capacity || ""} placeholder="z. B. 50" /></div>
        <div className="field"><label className="label" htmlFor="r-long">Erinnern ab Standzeit (Tage, 0 = aus)</label><input className="input" id="r-long" name="longStayDays" type="number" min={0} defaultValue={rates.longStayDays} /></div>
      </div>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" name="remindFreeEnd" defaultChecked={rates.remindFreeEnd} /> Aufgabe, wenn die freie Lagerzeit heute oder morgen endet
      </label>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" name="shipmentMail" defaultChecked={rates.shipmentMail} data-testid="rates-shipment-mail" /> Meldungen zu Sendungen (Termin verschoben, angekommen, Problem) zusätzlich per E-Mail an alle mit Zugriff aufs Palettenlager
      </label>
      <div className="field">
        <label className="label" htmlFor="r-services">Zusatzleistungen mit Preis (eine je Zeile: Name = Preis)</label>
        <textarea className="input" id="r-services" name="services" rows={4} defaultValue={rates.servicesText} placeholder={"Folieren = 8\nUmpacken je Stunde = 35\nPalettentausch = 12"} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div className="field">
          <label className="label" htmlFor="r-net">Preise sind</label>
          <select className="select" id="r-net" name="pricesAre" defaultValue={rates.pricesAre}>
            <option value="netto">netto (zzgl. USt)</option>
            <option value="brutto">brutto (inkl. USt)</option>
          </select>
        </div>
        <ValidFrom id="r-from" month={rates.month} />
      </div>
      <div className="small muted">Stellplätze (Lagerplan) richtest du jetzt direkt unter <a href="/paletten/lagerplan#einrichten">Lagerplan</a> ein{rates.locationsCount ? ` – zurzeit ${rates.locationsCount} Plätze` : ""}.</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>Speichern</button>
        {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="rates-result">{state.message}</span>}
      </div>
    </form>
  );
}

/** Lagerplan einrichten (Inhaber) – direkt im Lagerbereich. */
export function LocationsForm({ spec, count, capacity }: { spec: string; count: number; capacity: number }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveLocationsAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }} data-testid="locations-form">
      <div className="field">
        <label className="label" htmlFor="l-spec">Stellplätze – Bereiche wie „A-01..A-20“ oder einzelne Namen, je Zeile oder mit Komma{count ? ` · jetzt ${count} Plätze` : ""}</label>
        <textarea className="input" id="l-spec" name="locations" rows={4} defaultValue={spec} placeholder={"A-01..A-20\nB-01..B-20\nTor 1"} />
      </div>
      <div className="field" style={{ maxWidth: 220 }}>
        <label className="label" htmlFor="l-cap">Stellplätze gesamt (leer = laut Plan)</label>
        <input className="input" id="l-cap" name="capacity" type="number" min={0} defaultValue={capacity || ""} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>Lagerplan speichern</button>
        {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="locations-result">{state.message}</span>}
      </div>
    </form>
  );
}

/** Stand je Kunde und Monat: in Rechnung gestellt (mit Nummer, nur einmal) und bezahlt. */
export function InvoiceStatus({ customer, month, invoicedAt, invoiceNo, paidAt, invoicedTotal, total, owner }: { customer: string; month: string; invoicedAt: string | null; invoiceNo: string | null; paidAt: string | null; invoicedTotal: number | null; total: number; owner: boolean }) {
  const [state, action, pending] = useActionState<SendState, FormData>(markInvoicedAction, null);
  const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
  if (invoicedAt) {
    const changed = invoicedTotal !== null && Math.abs(invoicedTotal - total) >= 0.005;
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="invoice-status">
        <span className="tag tag-info">in Rechnung gestellt · Nr. {invoiceNo} · {invoicedAt}</span>
        {paidAt ? <span className="tag tag-ok">bezahlt {paidAt}</span> : null}
        <form action={markPaidAction} style={{ display: "inline" }}>
          <input type="hidden" name="customer" value={customer} />
          <input type="hidden" name="month" value={month} />
          {paidAt && <input type="hidden" name="undo" value="1" />}
          <button className="btn btn-small" type="submit" data-testid="mark-paid">{paidAt ? "doch offen" : "als bezahlt markieren"}</button>
        </form>
        {owner && (
          <form action={undoInvoicedAction} style={{ display: "inline" }} onSubmit={(e) => { if (!confirm(`Rechnungsvermerk Nr. ${invoiceNo} zurücknehmen?`)) e.preventDefault(); }}>
            <input type="hidden" name="customer" value={customer} />
            <input type="hidden" name="month" value={month} />
            <button className="btn-link small" type="submit">Vermerk zurücknehmen</button>
          </form>
        )}
        {changed && <span className="small" style={{ color: "var(--danger)" }} data-testid="invoice-changed">Achtung: Abrechnung hat sich seit der Rechnung geändert ({euro(invoicedTotal!)} → {euro(total)}) – Korrektur prüfen.</span>}
      </span>
    );
  }
  return (
    <form action={action} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="invoice-form">
      <input type="hidden" name="customer" value={customer} />
      <input type="hidden" name="month" value={month} />
      <input className="input" name="invoiceNo" placeholder="Rechnungsnr." aria-label={`Rechnungsnummer für ${customer}`} style={{ width: 130, padding: "4px 8px" }} />
      <button className="btn btn-small" type="submit" disabled={pending}>in Rechnung gestellt</button>
      {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="invoice-result">{state.message}</span>}
    </form>
  );
}

type Customer = { id?: string; name: string; email: string | null; pricePerMonth: number | null; freeDays: number | null; mode: "monat" | "anteilig" | null; inFee: number | null; outFee: number | null; monthlyMail: boolean };

/** Eigene Konditionen und E-Mail eines Kunden (leer = Standard). */
export function CustomerForm({ customer, defaults, month }: { customer: Customer | null; defaults: Pick<Rates, "pricePerMonth" | "freeDays" | "mode" | "inFee" | "outFee">; month: string }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(savePalletCustomer, null);
  const [email, setEmail] = useState(customer?.email ?? "");
  const c = customer;
  const p = c?.id ?? "neu";
  return (
    <form action={action} className="stack" style={{ gap: 10 }} data-testid={c ? "customer-form-edit" : "customer-form-new"}>
      {c?.id && <input type="hidden" name="id" value={c.id} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {c ? <input type="hidden" name="name" value={c.name} /> : (
          <div className="field"><label className="label" htmlFor={`c-name-${p}`}>Kunde</label><input className="input" id={`c-name-${p}`} name="name" required /></div>
        )}
        <div className="field" style={{ gridColumn: "span 2" }}><label className="label" htmlFor={`c-mail-${p}`}>E-Mail für die Monatsaufstellung</label><input className="input" id={`c-mail-${p}`} name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" /></div>
        <div className="field"><label className="label" htmlFor={`c-price-${p}`}>€ je Stellplatz/Monat</label><input className="input" id={`c-price-${p}`} name="pricePerMonth" inputMode="decimal" defaultValue={num(c?.pricePerMonth)} placeholder={`Standard ${num(defaults.pricePerMonth)}`} /></div>
        <div className="field"><label className="label" htmlFor={`c-free-${p}`}>Freie Tage</label><input className="input" id={`c-free-${p}`} name="freeDays" type="number" min={0} max={365} defaultValue={c?.freeDays ?? ""} placeholder={`Standard ${defaults.freeDays}`} /></div>
        <div className="field">
          <label className="label" htmlFor={`c-mode-${p}`}>Abrechnung</label>
          <select className="select" id={`c-mode-${p}`} name="mode" defaultValue={c?.mode ?? ""}>
            <option value="">Standard ({defaults.mode === "monat" ? "je Monat" : "anteilig"})</option>
            <option value="monat">je angefangenem Monat</option>
            <option value="anteilig">tagesgenau anteilig</option>
          </select>
        </div>
        <div className="field"><label className="label" htmlFor={`c-in-${p}`}>Einlagern (€)</label><input className="input" id={`c-in-${p}`} name="inFee" inputMode="decimal" defaultValue={num(c?.inFee)} placeholder={`Standard ${num(defaults.inFee)}`} /></div>
        <div className="field"><label className="label" htmlFor={`c-out-${p}`}>Auslagern (€)</label><input className="input" id={`c-out-${p}`} name="outFee" inputMode="decimal" defaultValue={num(c?.outFee)} placeholder={`Standard ${num(defaults.outFee)}`} /></div>
        <ValidFrom id={`c-from-${p}`} month={month} />
      </div>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <input type="checkbox" name="monthlyMail" defaultChecked={c?.monthlyMail ?? false} disabled={!email.trim()} style={{ marginTop: 3 }} />
        <span>Monatsaufstellung automatisch senden – am 1. des Monats geht die Aufstellung des Vormonats als PDF an diese Adresse (über dein Standard-Postfach){email.trim() ? "" : " – erst E-Mail eintragen"}.</span>
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary btn-small" type="submit" disabled={pending}>{c ? "Speichern" : "Kunde anlegen"}</button>
        {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="customer-result">{state.message}</span>}
      </div>
    </form>
  );
}
