import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { AMPEL_EMOJI } from "@/lib/deal-eingang/logic";
import { eingaenge, quellen, STATUS_TEXT } from "@/lib/deal-eingang/service";
import { AutoRefresh } from "../lieferanten/finden/refresh";
import { eingangAction } from "./actions";

// Deal-Eingang: Angebote aus WhatsApp & Co. einfügen bzw. teilen → KI erkennt → Deal-Ampel je Angebot.

const WEG = { manuell: "von Hand", teilen: "geteilt", kurzbefehl: "Kurzbefehl", mail: "Mail", claude: "Claude" } as const;

export default async function DealEingangPage({ searchParams }: { searchParams: Promise<{ meldung?: string; quelle?: string; ampel?: string; status?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const [liste, q] = await Promise.all([eingaenge(session.tenantId, { quelle: sp.quelle, ampel: sp.ampel, status: sp.status, limit: 60 }), quellen(session.tenantId)]);
  const laeuft = liste.some((e) => e.pruefung === "offen" || e.pruefung === "laeuft");
  return (
    <>
      <AutoRefresh active={laeuft} />
      <div className="page-head">
        <div><div className="crumb">Einkauf</div><h1>Deal-Eingang</h1></div>
        <Link className="btn" href="/deal-eingang/kurzbefehl">iPhone-Kurzbefehl &amp; Teilen</Link>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      {!session.readOnly && (
        <form action={eingangAction} className="card card-pad stack" style={{ gap: 8 }} data-testid="de-form">
          <textarea name="text" rows={4} placeholder="Nachricht aus WhatsApp einfügen (Text, mehrere Angebote möglich) …" style={{ width: "100%" }} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" name="datei" multiple accept="image/*,.pdf,.xlsx,.xls,.csv" />
            <input name="quelle" placeholder="Absender (optional, z. B. Konrad)" style={{ width: 220 }} />
            <button className="btn btn-primary" type="submit" data-testid="de-pruefen">Deal prüfen</button>
          </div>
          <div className="small muted">Screenshots und PDFs liest die KI. Tabellen (XLSX/CSV) und lange Listen gehen als Preisliste an den Preislisten-Scanner. Inhalte bleiben nur hier (nicht im Wissen) und werden nach der eingestellten Frist gelöscht.</div>
        </form>
      )}

      <section className="card card-pad" style={{ marginTop: 12 }} data-testid="de-liste">
        <div className="row small" style={{ gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <Link href="/deal-eingang">alle</Link>
          {(["gruen", "gelb", "rot"] as const).map((a) => <Link key={a} href={`?ampel=${a}`}>{AMPEL_EMOJI[a]}</Link>)}
          <Link href="?status=neu">offen</Link>
        </div>
        {liste.length ? (
          <table className="table small">
            <tbody>
              {liste.map((e) => (
                <tr key={e.id} data-testid="de-eintrag" data-ampel={e.ampel ?? ""}>
                  <td style={{ whiteSpace: "nowrap" }}>{e.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{e.ampel ? AMPEL_EMOJI[e.ampel] : e.pruefung === "fehler" ? "⚠️" : "⏳"}</td>
                  <td><Link href={`/deal-eingang/${e.id}`}>{e.pruefung === "fertig" ? (e.zusammenfassung ?? "–") : e.pruefung === "fehler" ? `Fehler: ${e.fehler ?? ""}` : "wird geprüft …"}</Link></td>
                  <td>{e.quelle ?? "–"}</td>
                  <td className="muted">{WEG[e.weg]} · {STATUS_TEXT[e.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="small muted">Noch keine Eingänge.</div>
        )}
      </section>

      {q.length > 0 && (
        <section className="card card-pad" style={{ marginTop: 12 }} data-testid="de-quellen">
          <h2 style={{ marginTop: 0 }}>Trefferquote je Absender</h2>
          <table className="table small">
            <thead><tr><th>Absender</th><th>Eingänge</th><th>Angebote</th><th>grün</th><th>gekauft</th><th>verworfen</th><th>Ø ROI (Prognose)</th></tr></thead>
            <tbody>
              {q.map((x) => (
                <tr key={x.quelle}><td><Link href={`?quelle=${encodeURIComponent(x.quelle)}`}>{x.quelle}</Link></td><td>{x.eingaenge}</td><td>{x.angebote}</td><td>{x.gruen}</td><td>{x.gekauft}</td><td>{x.verworfen}</td><td>{x.roiPrognose !== null ? `${x.roiPrognose} %` : "–"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
