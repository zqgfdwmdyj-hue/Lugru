import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { listReceipts } from "@/lib/invoices/receipts";
import { stotaxConfig } from "@/lib/invoices/stotax";
import { formatEuro } from "@/lib/numbers";
import { AutoRefresh } from "../../lieferanten/finden/refresh";
import { deleteAction, resendAction } from "./actions";
import { Scanner } from "./scanner";

const fmtDate = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");

export default async function BelegePage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const t = session.tenantId;
  const [rows, cfg, ai] = await Promise.all([listReceipts(t), stotaxConfig(t), getIntegration(t, "anthropic")]);
  // Frische Belege: KI und Versand laufen noch im Hintergrund → Seite aktualisiert sich selbst.
  const busy = rows.some((r) => !r.stotaxTriedAt && Date.now() - new Date(r.createdAt).getTime() < 3 * 60_000 && (cfg?.auto || (!r.vendor && ai?.apiKey)));
  const sum = rows.filter((r) => r.invoiceDate?.slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((s, r) => s + (r.totalGross ?? 0), 0);
  return (
    <>
      <AutoRefresh active={busy} everyMs={3000} />
      <div className="page-head">
        <div><div className="crumb">Einkauf & Buchhaltung</div><h1>Belege scannen</h1></div>
        <Link className="btn" href="/rechnungen?ansicht=kosten">Betriebskosten</Link>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="beleg-msg">{sp.meldung}</div>}
      {!cfg && <div className="notice notice-warn small">Stotax Select ist noch nicht eingerichtet – Belege werden gespeichert, aber nicht gesendet. <Link href="/anbindungen?p=stotax#stotax">Einrichten</Link></div>}
      {cfg && !cfg.auto && <div className="notice notice-info small">Stotax steht auf „nur per Knopf“ – Belege mit „Senden“ in der Liste übertragen.</div>}
      {!ai?.apiKey && <div className="small muted">Tipp: Mit KI-Schlüssel (Anbindungen → KI) werden Händler, Datum und Betrag automatisch gelesen.</div>}
      <Scanner stotax={cfg ? `Stotax (${cfg.address})` : null} />

      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <div className="card-head"><h2>Belege</h2><span className="small muted">diesen Monat {formatEuro(sum)}</span></div>
        <table className="table">
          <thead><tr><th>Datum</th><th>Händler</th><th className="right">Betrag</th><th>Art / Notiz</th><th>Stotax</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Belege.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid="beleg-row" data-vendor={r.vendor ?? ""}>
                <td className="num">{fmtDate(r.invoiceDate)}</td>
                <td>{r.vendor ?? <span className="muted">{busy && !r.stotaxTriedAt ? "wird gelesen …" : "–"}</span>}</td>
                <td className="num right">{r.totalGross !== null ? formatEuro(r.totalGross) : "–"}</td>
                <td className="small" style={{ maxWidth: 260 }}>{r.textExcerpt ?? ""}</td>
                <td className="small" style={{ maxWidth: 240 }}>
                  {r.stotaxSentAt ? (
                    <span className="tag tag-ok" title={`gesendet ${new Date(r.stotaxSentAt).toLocaleString("de-DE")}`}>übertragen</span>
                  ) : cfg ? (
                    <form action={resendAction} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={r.id} />
                      {r.stotaxError && <div style={{ color: "var(--danger)" }}>{r.stotaxError}</div>}
                      <button className="btn btn-small" type="submit" data-testid="beleg-send">{r.stotaxError ? "Erneut senden" : "Senden"}</button>
                    </form>
                  ) : <span className="muted">–</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.fileId && <a className="btn btn-small" href={`/datei/${r.fileId}`} target="_blank" rel="noreferrer">PDF</a>}
                  {!r.stotaxSentAt && (
                    <form action={deleteAction} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><button className="btn-link small" type="submit" style={{ marginLeft: 6, color: "var(--muted)" }}>löschen</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
