import { COUNTRY_NAMES, EU_COUNTRIES } from "@/lib/ebay/invoices/b2b";

const COUNTRIES = [...new Set(["DE", "AT", "CH", "NL", "BE", "LU", "FR", "IT", "ES", "PL", "CZ", "DK", "SE", ...EU_COUNTRIES, "GB", "NO", "US"])];

type Values = { name?: string; contact?: string | null; street?: string; zip?: string; city?: string; country?: string; vatId?: string | null; email?: string | null; customerNumber?: string | null };

/** Eingabefelder eines Kunden – für „Neuer Kunde“ und „Kunde bearbeiten“. */
export function CustomerFields({ v = {} }: { v?: Values }) {
  const f = (k: keyof Values, label: string, opts: { req?: boolean; flex?: string; type?: string; placeholder?: string } = {}) => (
    <div className="field" style={{ flex: opts.flex ?? "1 1 180px", minWidth: 0 }}>
      <label className="label" htmlFor={`k-${k}`}>{label}</label>
      <input className="input" id={`k-${k}`} name={k} type={opts.type ?? "text"} defaultValue={v[k] ?? ""} required={opts.req} placeholder={opts.placeholder} />
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {f("name", "Firma", { req: true, flex: "2 1 240px" })}
        {f("contact", "Ansprechpartner (optional)")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {f("street", "Straße und Nr.", { req: true, flex: "2 1 220px" })}
        {f("zip", "PLZ", { req: true, flex: "0 1 100px" })}
        {f("city", "Ort", { req: true })}
        <div className="field" style={{ flex: "0 1 170px" }}>
          <label className="label" htmlFor="k-country">Land</label>
          <select className="select" id="k-country" name="country" defaultValue={v.country ?? "DE"}>
            {COUNTRIES.map((k) => <option key={k} value={k}>{k} – {COUNTRY_NAMES[k] ?? k}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {f("vatId", "USt-IdNr.", { placeholder: "z. B. DE123456789" })}
        {f("email", "E-Mail für Rechnungen", { type: "email" })}
        {f("customerNumber", "Kundennummer (optional)", { flex: "0 1 170px", placeholder: "z. B. K-1001" })}
      </div>
    </>
  );
}
