import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/session";
import type { InvoiceData } from "@/lib/ebay/invoices/types";
import { customerInvoices, getCustomer } from "@/lib/invoices/customers";
import { formatEuro } from "@/lib/numbers";
import { deleteCustomerAction, saveCustomerAction } from "../actions";
import { CustomerFields } from "../customer-fields";

export default async function KundePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const session = await requireArea("buchhaltung");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await getCustomer(session.tenantId, id);
  if (!c) notFound();
  const invoices = await customerInvoices(session.tenantId, c.name);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/rechnungen/kunden">Kunden</Link></div><h1>{c.name}</h1></div>
        <Link className="btn btn-primary" href={`/rechnungen/ausgang/neu?kunde=${c.id}`}>Rechnung schreiben</Link>
      </div>
      {sp.fehler && <div className="notice notice-error" data-testid="cust-error">{sp.fehler}</div>}
      <form action={saveCustomerAction} className="card card-pad stack" style={{ gap: 8 }} data-testid="cust-edit">
        <input type="hidden" name="id" value={c.id} />
        <h2>Angaben</h2>
        <CustomerFields v={c} />
        <div className="small muted">Änderungen gelten für neue Rechnungen; geschriebene Rechnungen bleiben, wie sie sind.</div>
        <div><button className="btn btn-primary" type="submit">Speichern</button></div>
      </form>
      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <div className="card-head"><h2>Rechnungen</h2></div>
        <table className="table">
          <thead><tr><th>Nummer</th><th>Datum</th><th className="right">Brutto</th><th></th></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={4} className="muted">Noch keine Rechnungen.</td></tr>}
            {invoices.map((r) => {
              const d = r.data as InvoiceData;
              return (
                <tr key={r.id}>
                  <td className="num">{r.number}{r.kind === "storno" && <span className="tag tag-critical" style={{ marginLeft: 6 }}>STORNO</span>}{r.cancelledById && <span className="small muted"> · storniert</span>}</td>
                  <td className="num">{new Date(d.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                  <td className="num right">{formatEuro(d.totalGross)}</td>
                  <td><a className="btn btn-small" href={`/rechnungen/ausgang/${r.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <form action={deleteCustomerAction}>
        <input type="hidden" name="id" value={c.id} />
        <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} data-testid="cust-delete">Kunde löschen</button>
        <span className="small muted"> – die Rechnungen bleiben erhalten.</span>
      </form>
    </>
  );
}
