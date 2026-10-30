import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { UPLOAD_ART, type UploadArt } from "@/lib/uploads/erkennen";
import { uploadVerlauf } from "@/lib/uploads/service";
import { UploadForm } from "./upload-form";

// Zentrale Uploads: eine Stelle für alle Dateien – das System erkennt die Art und verarbeitet sie wie im Bereich.

const ERKENNT: { was: string; wohin: string }[] = [
  { was: "Kontoauszug Sparkasse (CSV-CAMT, CAMT-XML oder PDF)", wohin: "Buchhaltung + Liquidität" },
  { was: "American Express (CSV)", wohin: "Buchhaltung" },
  { was: "Amazon-Umsatzsteuerbericht", wohin: "Buchhaltung → Auslandsumsätze" },
  { was: "Amazon-Berichte (Abrechnung, Bestand, Retouren, Erstattungen, Transaktionen …)", wohin: "Daten/Amazon" },
  { was: "Arbitrage One / sellerboard-Export, eigene Vorlagen", wohin: "WaWi" },
  { was: "BQool „Manage Listings“", wohin: "Repricer" },
  { was: "Rechnungen und Belege (PDF, Fotos)", wohin: "Rechnungen / Belege" },
  { was: "Call-Transkripte (Word, PDF, Text, Untertitel, ZIP) und Call-Archiv (JSON)", wohin: "Call-Archiv" },
];

export default async function UploadsPage() {
  const session = await requireSession();
  const [verlauf, s] = await Promise.all([uploadVerlauf(session.tenantId), getSettings(session.tenantId)]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Daten</div>
          <h1>Uploads</h1>
          <div className="small muted">Alles an einer Stelle hochladen – Kontoauszüge, Amazon-Berichte, Belege, BQool, Calls. Doppeltes wird erkannt.</div>
        </div>
      </div>
      <div className="row">
        <section style={{ flex: 1, minWidth: 0 }}>
          <UploadForm firmen={s.buchhaltung.firmen} />
          <div className="card table-wrap" style={{ marginTop: 14 }}>
            <div className="card-head"><h2>Verlauf</h2></div>
            <table className="table small" data-testid="upload-verlauf">
              <thead>
                <tr><th>Zeit</th><th>Datei</th><th>Erkannt als</th><th>Ergebnis</th></tr>
              </thead>
              <tbody>
                {verlauf.length === 0 && (
                  <tr><td colSpan={4} className="muted">Noch nichts hochgeladen.</td></tr>
                )}
                {verlauf.map((v) => (
                  <tr key={v.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{v.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{v.dateiname}</td>
                    <td>{v.art ? (v.link ? <Link href={v.link}>{UPLOAD_ART[v.art as UploadArt]?.text ?? v.art}</Link> : UPLOAD_ART[v.art as UploadArt]?.text ?? v.art) : "–"}</td>
                    <td><span className={`tag ${v.ok ? "tag-ok" : "tag-warn"}`}>{v.ok ? "ok" : "offen"}</span> {v.zusammenfassung}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="col-side">
          <div className="card card-pad small">
            <h3 style={{ marginTop: 0 }}>Was erkannt wird</h3>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {ERKENNT.map((e) => <li key={e.was} style={{ marginBottom: 4 }}>{e.was} <span className="muted">→ {e.wohin}</span></li>)}
            </ul>
            <p className="muted" style={{ marginBottom: 0 }}>Was eine Auswahl braucht (Preisliste eines Lieferanten, Amazon-Business-Bericht mit Zeitraum, Echtheits-Belege einer Marke) bleibt im Bereich. Private Kontoauszüge gehören in <Link href="/privat/geld">Privat → Geld</Link>.</p>
          </div>
          <div className="card card-pad small">
            <Link href="/import">Datenstand je Bereich →</Link>
          </div>
        </aside>
      </div>
    </>
  );
}
