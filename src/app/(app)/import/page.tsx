import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { REPORT_KINDS } from "@/lib/reports/amazon";
import { ImportForm } from "./import-form";

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
  const [runs, reports] = await Promise.all([
    db.select().from(schema.importRuns).where(eq(schema.importRuns.tenantId, session.tenantId)).orderBy(desc(schema.importRuns.createdAt)).limit(15),
    db.select().from(schema.reportImports).where(eq(schema.reportImports.tenantId, session.tenantId)).orderBy(desc(schema.reportImports.createdAt)).limit(30),
  ]);
  const history = [
    ...runs.map((r) => ({ at: r.createdAt, type: r.source, file: r.fileName, rows: (r.stats as { rows?: number }).rows ?? 0, inserted: (r.stats as { created?: number }).created ?? 0, via: "upload" })),
    ...reports.map((r) => ({ at: r.createdAt, type: r.reportType, file: r.fileName, rows: r.rows, inserted: r.inserted, via: r.via })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);

  return (
    <>
      <div className="page-head"><div><div className="crumb">Daten</div><h1>Daten importieren</h1></div></div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <ImportForm />
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
