import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { SystemLoad } from "./system-load";
import { REPORT_KINDS } from "@/lib/reports/amazon";
import { ImportForm } from "./import-form";
import { areaStep } from "@/lib/today/logic";
import { dataAreas } from "@/lib/today/service";

const SOURCES: { name: string; where: string }[] = [
  { name: "Arbitrage One – Vorlage „Tool“, AccountOne COG, Sellerboard-Export", where: "Arbitrage One → Export" },
  { name: REPORT_KINDS.ledger, where: "Seller Central → Berichte → Versand durch Amazon → Bestandsprotokoll → Ansicht „Detailliert“ → CSV herunterladen" },
  { name: REPORT_KINDS.reimbursements, where: "Berichte → Versand durch Amazon → Zahlungen → Erstattungen" },
  { name: REPORT_KINDS.customerReturns, where: "Berichte → Versand durch Amazon → Kundenservice → FBA-Kundenrücksendungen" },
  { name: `${REPORT_KINDS.removalOrders} und ${REPORT_KINDS.removalShipments}`, where: "Berichte → Versand durch Amazon → Remissionen" },
  { name: REPORT_KINDS.inventory, where: "Berichte → Versand durch Amazon → Bestand → Bestand verwalten (FBA)" },
  { name: REPORT_KINDS.fees, where: "Berichte → Versand durch Amazon → Zahlungen → Gebührenvorschau" },
  { name: REPORT_KINDS.transactions, where: "Berichte → Zahlungen → Berichts-Repository → Berichtstyp „Transaktion“ (Datumsbereich) – am einfachsten jeden Monat den Vormonat" },
  { name: REPORT_KINDS.fbmReturns, where: "Berichte → Retourenberichte → Bericht anfordern (letzte 2–3 Monate)" },
  { name: REPORT_KINDS.settlement, where: "Berichte → Zahlungen → Alle Abrechnungen → Flat File V2 herunterladen" },
  { name: REPORT_KINDS.orders, where: "Berichte → Versand durch Amazon → Verkäufe → Alle Bestellungen" },
  { name: REPORT_KINDS.feedback, where: "Leistung → Feedback → Feedback-Manager → Bericht herunterladen" },
  { name: "Aufträge anderer Kanäle (eBay, TikTok, Temu …)", where: "Eigene CSV-Vorlage – siehe Aufträge" },
  { name: "Planposten für den Cash Flow", where: "Eigene CSV-Vorlage – siehe Cash Flow" },
];

const LABELS: Record<string, string> = { ...REPORT_KINDS, sellerboard: "Arbitrage One – Sellerboard", accountone: "Arbitrage One – AccountOne", template: "Arbitrage One – Vorlage" };

export default async function ImportPage() {
  const session = await requireSession();
  const [runs, reports, areas] = await Promise.all([
    db.select().from(schema.importRuns).where(eq(schema.importRuns.tenantId, session.tenantId)).orderBy(desc(schema.importRuns.createdAt)).limit(15),
    db.select().from(schema.reportImports).where(eq(schema.reportImports.tenantId, session.tenantId)).orderBy(desc(schema.reportImports.createdAt)).limit(30),
    dataAreas(session.tenantId),
  ]);
  const history = [
    ...runs.map((r) => ({ at: r.createdAt, type: r.source, file: r.fileName, rows: (r.stats as { rows?: number }).rows ?? 0, inserted: (r.stats as { created?: number }).created ?? 0, via: "upload" })),
    ...reports.map((r) => ({ at: r.createdAt, type: r.reportType, file: r.fileName, rows: r.rows, inserted: r.inserted, via: r.via })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);

  return (
    <>
      <div className="page-head"><div><div className="crumb">Daten</div><h1>Daten importieren</h1></div></div>
      <div className="notice notice-info small" style={{ marginBottom: 12 }}>Alle Dateien an einer Stelle (auch Kontoauszüge, Belege, BQool, Calls): <Link href="/uploads">Uploads</Link>.</div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card" id="datenstand" data-testid="data-areas" style={{ overflow: "auto" }}>
            <div className="card-head"><h2>Datenstand je Bereich</h2></div>
            <div className="card-pad small muted" style={{ paddingTop: 0 }}>Letzter Stand je Bericht bzw. Abruf – egal ob hochgeladen oder automatisch über die Schnittstelle geholt. Veraltet = älter als üblich für diesen Bericht.</div>
            <table className="table">
              <thead><tr><th>Bereich</th><th>Zuletzt</th><th>Weg</th><th>Zustand</th><th>Nächster Schritt</th></tr></thead>
              <tbody>
                {areas.map((a) => {
                  const st = areaStep(a);
                  return (
                  <tr key={a.key} data-testid="data-area" data-state={st.state}>
                    <td>{a.label}</td>
                    <td className="num">{a.last ? a.last.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–"}</td>
                    <td className="small">{a.key.startsWith("job:") ? "Hintergrund-Abruf" : a.key === "uploads" ? "Upload" : a.via === "api" ? "Schnittstelle" : a.last ? "Upload" : "–"}</td>
                    <td>
                      {a.error ? <span className="tag tag-danger" title={a.error}>Fehler: {a.error.slice(0, 80)}</span> : st.state === "ersatz" ? <span className="tag tag-info" data-testid="data-area-substitute">{a.missing ? "Bericht fehlt" : "Bericht veraltet"} · sellerboard ✓</span> : a.missing ? <span className="tag tag-missing">fehlt</span> : a.empty ? <span className="tag tag-warn">unvollständig</span> : a.stale ? <span className="tag tag-warn">veraltet (älter als {a.maxAgeDays} Tag{a.maxAgeDays === 1 ? "" : "e"})</span> : <span className="tag tag-ok">aktuell</span>}
                    </td>
                    <td className="small" data-testid="data-area-step">
                      {st.state === "ersatz" && a.substitute ? (
                        <>
                          <div>{a.substitute.label}.</div>
                          <div><span className="muted">Reicht für:</span> {a.substitute.covers.join(", ")}.</div>
                          <div><span className="muted">Bericht weiter nötig für:</span> {a.substitute.needs.join("; ")} – <Link href={st.href ?? "/import#upload"}>Bericht automatisch holen lassen</Link> oder unten hochladen.</div>
                        </>
                      ) : st.step ? (st.href ? <Link href={st.href}>{st.step} →</Link> : st.step) : <span className="muted">–</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {session.role === "owner" && <SystemLoad tenantId={session.tenantId} />}
          <div id="upload"><ImportForm /></div>
          <section className="card" style={{ overflow: "auto" }}>
            <div className="card-head"><h2>Letzte Importe</h2></div>
            {history.length === 0 ? <div className="card-pad muted">Noch keine Importe.</div> : (
              <table className="table">
                <thead><tr><th>Zeitpunkt</th><th>Art</th><th>Datei</th><th className="right">Zeilen</th><th className="right">Neu</th><th>Weg</th></tr></thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td className="num">{h.at.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td>
                      <td>{LABELS[h.type] ?? h.type}</td>
                      <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.file ?? "–"}</td>
                      <td className="num right">{h.rows}</td>
                      <td className="num right">{h.inserted}</td>
                      <td>{h.via === "api" ? "Schnittstelle" : "Upload"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <aside className="col-side" style={{ width: 400 }}>
          <section className="card card-pad">
            <h2 style={{ marginBottom: 10 }}>Was erkannt wird</h2>
            <div className="stack" style={{ gap: 10, fontSize: 13 }}>
              {SOURCES.map((s) => (
                <div key={s.name}><div style={{ fontWeight: 600 }}>{s.name}</div><div className="muted small">{s.where}</div></div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
