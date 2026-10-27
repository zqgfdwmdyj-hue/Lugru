import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { loadEventView } from "@/lib/event-view";
import { OUTCOME_LABELS, STOCK_LABELS } from "@/lib/price-logic";
import { setOpenOutcomes, setOutcome } from "@/app/(app)/actions";

const OUTCOMES = Object.entries(OUTCOME_LABELS) as ["weg" | "wenig" | "viel", string][];

/**
 * Nach der Verteilung: je Produkt „alles weg / wenig übrig / viel übrig“ – ein Tipp, sofort gespeichert. „Noch offen“
 * (keine Rückmeldung) ist etwas anderes als „viel übrig“ und zählt in der Statistik nicht mit.
 */
export default async function ErgebnissePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ alle?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const sp = await searchParams;
  const view = await loadEventView(id);
  if (!view) notFound();
  const { rows } = view;
  const open = rows.filter((r) => !r.item.outcome);
  const shown = sp.alle === "1" ? rows : open;
  const counts = OUTCOMES.map(([k, label]) => ({ k, label, n: rows.filter((r) => r.item.outcome === k).length }));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Wie lief es?</h2>
        <div className="small muted">Ein Tipp je Produkt, wird sofort gespeichert. Grundlage der <Link href="/statistik">Statistik</Link>. „Noch offen“ heißt: keine Rückmeldung – das ist nicht dasselbe wie „viel übrig“.</div>
        <div className="summary-chips">
          <span className="chip">{rows.length - open.length} von {rows.length} erfasst</span>
          {counts.map((c) => <span key={c.k} className={`chip outcome-${c.k}`}>{c.n} {c.label}</span>)}
          <span className="chip chip-danger">{open.length} noch offen</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Link href={`/verteilung/${id}/ergebnisse${sp.alle === "1" ? "" : "?alle=1"}`} className="btn btn-small">{sp.alle === "1" ? "Nur offene zeigen" : "Alle zeigen (zum Ändern)"}</Link>
          {open.length > 0 && (
            <form action={setOpenOutcomes.bind(null, id, "weg")}>
              <button className="btn btn-small" type="submit">Alle {open.length} offenen: „alles weg“</button>
            </form>
          )}
        </div>
      </section>
      <section className="card">
        {shown.length === 0 && <div className="card-pad muted">✓ Für alle Produkte ist ein Ergebnis erfasst.</div>}
        <div className="check-list">
          {shown.map((r) => (
            <form key={r.item.id} className="check-row outcome-row">
              {r.product.imageFileId ? <img src={`/datei/${r.product.imageFileId}?w=200`} alt="" className="thumb" style={{ width: 48, height: 48 }} loading="lazy" /> : <span className="thumb thumb-empty" style={{ width: 48, height: 48 }}>–</span>}
              <span className="check-text">
                <strong className="wrap-anywhere">{r.unnamed ? "Ohne Namen" : r.product.name}{r.product.variant ? ` · ${r.product.variant}` : ""}</strong>
                <span className="small muted">{r.item.stock ? `Bestand vorher: ${STOCK_LABELS[r.item.stock]} · ` : ""}{r.item.outcome ? `erfasst: ${OUTCOME_LABELS[r.item.outcome]}` : "noch offen"}</span>
              </span>
              <span className="outcome-buttons" role="group" aria-label="Ergebnis">
                {OUTCOMES.map(([k, label]) => (
                  <button key={k} className={`btn btn-small outcome-${k}${r.item.outcome === k ? " active" : ""}`} formAction={setOutcome.bind(null, r.item.id, k)} aria-pressed={r.item.outcome === k}>{label}</button>
                ))}
                {r.item.outcome && <button className="btn-link small" formAction={setOutcome.bind(null, r.item.id, null)}>zurücksetzen</button>}
              </span>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
