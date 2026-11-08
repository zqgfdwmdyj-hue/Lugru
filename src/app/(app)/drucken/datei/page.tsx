import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { druckDateien } from "@/lib/druck/dateien";
import { DruckerSymbol } from "@/components/drucker-symbol";
import { pdfAction } from "../actions";
import { PdfAblage } from "./pdf-ablage";

// Drucken → Datei: PDFs aus Seller Central (bis die SP-API die Labels selbst holt). Erkennt FBA-Kartonlabels
// (102 × 152 mm → QL-1100) und FNSKU-Bögen (A4 mit 27/40 Etiketten → einzelne 62-mm-Etiketten → QL-800), liest die
// Sendungsnummer (FBA…) und ordnet die Datei der FBA-Sendung zu. Auch per Drag-and-Drop und vom iPhone (Kurzbefehl).

const ART: Record<string, string> = { kartonlabel: "FBA-Kartonlabels", fnsku_bogen: "FNSKU-Bogen", label_102: "Label 102 mm", unbekannt: "unbekannt" };

export default async function DruckDateiPage({ searchParams }: { searchParams: Promise<{ druck?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const dateien = await druckDateien(s.tenantId);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/drucken">Drucken</Link></div><h1>PDF drucken</h1></div>
        <div className="stack" style={{ gap: 4 }}>
          <DruckerSymbol tenantId={s.tenantId} modell="QL-800" />
          <DruckerSymbol tenantId={s.tenantId} modell="QL-1100" />
        </div>
      </div>
      {sp.druck && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="pdf-ergebnis">{sp.druck}</div>}
      {!s.readOnly && (
        <form action={pdfAction} className="card card-pad stack" data-testid="pdf-form">
          <PdfAblage />
          <div className="row small" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label><input type="checkbox" name="drucken" value="1" defaultChecked data-testid="pdf-drucken" /> gleich drucken</label>
            <label>Anzahl je Etikett <input className="input" type="number" name="anzahl" min={1} max={20} defaultValue={1} style={{ width: 60 }} /></label>
            <label>FNSKU-Bogen <select className="input" name="raster" defaultValue=""><option value="">automatisch</option><option value="27">27 je A4</option><option value="40">40 je A4</option></select></label>
            <button className="btn btn-primary" type="submit" data-testid="pdf-los">Hochladen</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Seller Central: „Drucken“ → als PDF speichern → hier ablegen. Vom iPhone: Kurzbefehl „PDF drucken“ (Einstellungen → Handy, Endpunkt <code>/api/mobil/drucken</code>).</p>
        </form>
      )}
      <section className="card" style={{ marginTop: 12, overflow: "auto" }}>
        {dateien.length ? (
          <table className="table small" data-testid="pdf-liste">
            <thead><tr><th>Datei</th><th>Art</th><th className="right">Seiten</th><th className="right">Etiketten</th><th>FBA-Sendung</th></tr></thead>
            <tbody>
              {dateien.map((d) => (
                <tr key={d.id} data-testid="pdf-zeile" data-art={d.art}>
                  <td>{d.name}</td>
                  <td>{ART[d.art] ?? d.art}{d.raster ? ` (${d.raster}er)` : ""}</td>
                  <td className="right">{d.seiten}</td>
                  <td className="right">{d.etiketten}</td>
                  <td>{d.sendungsnummer ? (d.inboundShipmentId ? <Link href={`/inbound/${d.inboundShipmentId}`}>{d.sendungsnummer}</Link> : <span>{d.sendungsnummer} <span className="muted">(nicht im System)</span></span>) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="card-pad small muted">Noch keine PDFs.</div>
        )}
      </section>
    </>
  );
}
