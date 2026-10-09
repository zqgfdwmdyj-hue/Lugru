import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { COUNTRY_NAMES } from "@/lib/ebay/invoices/b2b";
import { listCustomers, nextCustomerNumber } from "@/lib/invoices/customers";
import { formatEuro } from "@/lib/numbers";
import { saveCustomerAction } from "./actions";
import { CustomerFields } from "./customer-fields";

export default async function KundenPage({ searchParams }: { searchParams: Promise<{ q?: string; meldung?: string; fehler?: string; neu?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const [rows, nextNo] = await Promise.all([listCustomers(session.tenantId, sp.q), nextCustomerNumber(session.tenantId)]);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/rechnungen/ausgang">Ausgangsrechnungen</Link></div><h1>Kunden</h1></div>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className="btn btn-primary" href="/rechnungen/kunden?neu=1#neu">Neuer Kunde</Link>
          <Link className="btn" href="/rechnungen/ausgang/neu">Neue B2B-Rechnung</Link>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="cust-msg">{sp.meldung}</div>}
      {sp.fehler && <div className="notice notice-error" data-testid="cust-error">{sp.fehler}</div>}

      <form action="/rechnungen/kunden" style={{ maxWidth: 340 }}>
        <label htmlFor="kq" className="sr-only">Suche</label>
        <input className="input" id="kq" name="q" defaultValue={sp.q} placeholder="Name, Ort, Kundennummer, E-Mail" />
      </form>
      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Kunde</th><th>Ort</th><th>USt-IdNr.</th><th className="right">Rechnungen</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{sp.q ? "Kein Kunde gefunden." : "Noch keine Kunden – unten anlegen oder beim Rechnungschreiben speichern."}</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} data-testid="cust-row" data-name={c.name}>
                <td>
                  <Link href={`/rechnungen/kunden/${c.id}`}><strong>{c.name}</strong></Link>
                  {c.customerNumber && <span className="small muted num"> · {c.customerNumber}</span>}
                  {c.email && <div className="small muted">{c.email}</div>}
                </td>
                <td className="small">{c.zip} {c.city}{c.country !== "DE" && <div className="muted">{COUNTRY_NAMES[c.country] ?? c.country}</div>}</td>
                <td className="small num">{c.vatId ?? <span className="muted">–</span>}</td>
                <td className="num right small">{c.invoices ? <>{c.invoices} · {formatEuro(c.total)}</> : <span className="muted">–</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link className="btn btn-small btn-primary" href={`/rechnungen/ausgang/neu?kunde=${c.id}`}>Rechnung schreiben</Link>
                  <Link className="btn-link small" href={`/rechnungen/kunden/${c.id}`} style={{ marginLeft: 8 }}>bearbeiten</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form action={saveCustomerAction} className="card card-pad stack" style={{ gap: 8 }} id="neu" data-testid="cust-new">
        <h2>Neuer Kunde</h2>
        <CustomerFields v={{ customerNumber: nextNo }} />
        {nextNo && <div className="small muted">Kundennummer {nextNo} ist nach deinem bisherigen Muster vorgeschlagen.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="submit">Kunde anlegen</button>
          <button className="btn" type="submit" name="next" value="rechnung">Anlegen und Rechnung schreiben</button>
        </div>
      </form>
    </>
  );
}
