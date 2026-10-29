import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { markenListe } from "@/lib/echtheit/service";
import { ausSasAction, markeAnlegenAction } from "./actions";

// Echtheits-Ordner: je Marke die Einkaufsrechnungen, Abdeckung gekauft/verkauft, Lücken und offene Amazon-Fälle.

export default async function EchtheitPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const liste = await markenListe(session.tenantId, todayIso());

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon</div>
          <h1>Echtheits-Ordner</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}
      <p className="small muted" style={{ margin: "0 0 14px", maxWidth: 860 }}>
        Je Marke alle Einkaufsrechnungen an einem Ort – gefunden über den Rechnungstext, über die Chargen der Marken-Artikel oder von Hand zugeordnet. Die Abdeckung zeigt, ob die verkauften Stück (12 Monate) durch Einkäufe mit Rechnung gedeckt sind.
        Bei einer Echtheits- oder Rechteinhaber-Beschwerde das <strong>Audit-Paket</strong> (ZIP mit Übersicht-PDF und Rechnungen) herunterladen.
      </p>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <form action={markeAnlegenAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label className="small">Marke<input name="marke" required minLength={2} placeholder="z. B. Markenname" data-testid="echtheit-marke" /></label>
          <label className="small">Weitere Schreibweisen (optional, mit Komma)<input name="aliase" placeholder="z. B. Schreibweise ohne Umlaut" /></label>
          <button className="btn btn-primary" type="submit" data-testid="echtheit-anlegen">Ordner anlegen</button>
        </form>
        <form action={ausSasAction} style={{ marginTop: 8 }}>
          <button className="btn-link small" type="submit">Marken aus der SAS-Auswahl übernehmen</button>
        </form>
      </div>

      {liste.length === 0 ? (
        <div className="card card-pad small muted" data-testid="echtheit-leer">Noch kein Ordner. Marke oben anlegen.</div>
      ) : (
        <div className="table-wrap card">
          <table className="table" data-testid="echtheit-liste">
            <thead>
              <tr>
                <th>Marke</th>
                <th className="right">Rechnungen</th>
                <th className="right">Artikel</th>
                <th className="right">Abdeckung</th>
                <th className="right">Lücken</th>
                <th className="right">Offene Fälle</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((o) => (
                <tr key={o.marke.id} data-testid="echtheit-zeile">
                  <td><Link href={`/echtheit/${o.marke.id}`}>{o.marke.marke}</Link>{o.marke.aliase.length > 0 && <div className="small muted">{o.marke.aliase.join(", ")}</div>}</td>
                  <td className="right num">{o.summe.belege}{o.summe.pruefen > 0 && <div className="small" style={{ color: "var(--warn)" }}>{o.summe.pruefen} prüfen</div>}</td>
                  <td className="right num">{o.summe.skus}</td>
                  <td className="right num" data-testid="echtheit-quote">{o.abdeckung.quote === null ? <span className="muted">kein Verkauf</span> : `${o.abdeckung.quote.toLocaleString("de-DE")} %`}</td>
                  <td className="right num" style={o.abdeckung.luecken ? { color: "var(--danger)" } : undefined}>{o.abdeckung.luecken}</td>
                  <td className="right num">{o.summe.offeneFaelle ? <span className="tag tag-danger">{o.summe.offeneFaelle}</span> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
