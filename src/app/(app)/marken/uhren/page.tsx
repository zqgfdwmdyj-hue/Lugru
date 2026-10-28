import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { LESSONS, nextLesson } from "@/lib/watches/lessons";
import { dealResult, dealStats, DEAL_STATUS_LABEL } from "@/lib/watches/logic";
import { asDealLike, learnProgress, listDeals, listPrices, requireFlip } from "@/lib/watches/service";
import { eur, FlipHead, pct } from "./ui";

/** Uhren Buy & Flip (Zeitlux): Lernstand, eigene Zahlen, offene Deals, nächste Schritte. */
export default async function UhrenPage() {
  const { session, brandName } = await requireFlip();
  const t = session.tenantId;
  const today = todayIso();
  const [deals, progress, prices] = await Promise.all([listDeals(t), learnProgress(t, session.userId), listPrices(t)]);
  const done = progress.filter((p) => p.done).length;
  const next = nextLesson(progress);
  const real = dealStats(deals.filter((d) => !d.practice).map(asDealLike));
  const practice = deals.filter((d) => d.practice);
  const practiceStats = dealStats(practice.map(asDealLike));
  const open = deals.filter((d) => !["verkauft", "verworfen"].includes(d.status)).slice(0, 6);
  const refs = new Set(prices.map((p) => p.refKey)).size;

  return (
    <div className="flip stack" style={{ gap: 16 }}>
      <FlipHead title="Uhren: Buy & Flip" brand={brandName} sub="Lernen, rechnen, üben – gebrauchte und neue Uhren." />

      <section className="card card-pad stack" data-testid="flip-learn">
        <div className="between">
          <h2>Lernpfad</h2>
          <span className="small muted" data-testid="flip-learn-count">{done} von {LESSONS.length} Lektionen</span>
        </div>
        <div className="flip-progress" aria-hidden="true"><span style={{ width: `${Math.round((done / LESSONS.length) * 100)}%` }} /></div>
        {next ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Link className="btn btn-primary" href={`/marken/uhren/lernen/${next.key}`} data-testid="flip-next-lesson">{done ? "Weiter" : "Starten"}: {next.title}</Link>
            <span className="small muted">ca. {next.minutes} Min. · mit Quiz</span>
          </div>
        ) : (
          <div className="notice notice-ok small">Alle Lektionen abgeschlossen. Jetzt zählt die Praxis: Übungs-Deals und Marktpreise.</div>
        )}
      </section>

      <section className="stack" data-testid="flip-stats">
        <h2>Deine Zahlen (echte Deals)</h2>
        <div className="grid-kpi flip-kpis">
          <div className="card card-pad kpi-card" data-testid="flip-kpi-sold"><div className="kpi-label">Verkauft</div><div className="kpi-value">{real.sold}</div><div className="small muted">{real.losses ? `${real.losses} mit Verlust` : "ohne Verlust"}</div></div>
          <div className="card card-pad kpi-card" data-testid="flip-kpi-profit"><div className="kpi-label">Gewinn gesamt</div><div className={`kpi-value${real.profit < 0 ? " flip-neg" : ""}`}>{real.sold ? eur(real.profit) : "–"}</div><div className="small muted">vor Einkommensteuer</div></div>
          <div className="card card-pad kpi-card" data-testid="flip-kpi-margin"><div className="kpi-label">Ø Marge / Standzeit</div><div className="kpi-value">{pct(real.avgMarginPct)}</div><div className="small muted">{real.avgDays !== null ? `Ø ${real.avgDays} Tage bis Verkauf` : "noch keine Verkäufe"}</div></div>
          <div className="card card-pad kpi-card" data-testid="flip-kpi-capital"><div className="kpi-label">Gebundenes Geld</div><div className="kpi-value">{eur(real.openCapital)}</div><div className="small muted">{real.open} Uhr{real.open === 1 ? "" : "en"} gekauft, nicht verkauft</div></div>
        </div>
        <div className="small muted">
          Übungs-Deals (nur auf dem Papier): {practice.length}{practiceStats.sold ? ` · ${practiceStats.sold} „verkauft“, zusammen ${eur(practiceStats.profit)}` : ""} · Marktpreise notiert für {refs} Referenz{refs === 1 ? "" : "en"}.
        </div>
      </section>

      <section className="card card-pad stack">
        <div className="between">
          <h2>Offene Deals</h2>
          <Link className="small" href="/marken/uhren/deals">alle Deals →</Link>
        </div>
        {open.length === 0 ? (
          <p className="small muted">Noch nichts offen. Leg einen Übungs-Deal an: Anzeige aussuchen, Höchstpreis rechnen, später nachsehen, wofür sie verkauft wurde.</p>
        ) : (
          <ul className="flip-list">
            {open.map((d) => {
              const r = dealResult(asDealLike(d), today);
              return (
                <li key={d.id}>
                  <Link href={`/marken/uhren/deals/${d.id}`}><strong>{d.maker} {d.model ?? ""}</strong></Link> {d.reference && <span className="small muted">· {d.reference}</span>}
                  <div className="small muted">
                    {DEAL_STATUS_LABEL[d.status]}{d.practice ? " · Übung" : ""}{r ? ` · ${r.planned ? "geplanter Gewinn" : "Gewinn"} ${eur(r.profit)}` : " · noch nicht gerechnet"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href="/marken/uhren/rechner">Deal durchrechnen</Link>
          <Link className="btn" href="/marken/uhren/deals#neu">Neuer Deal</Link>
          <Link className="btn" href="/marken/uhren/preise">Marktpreis notieren</Link>
        </div>
      </section>

      <p className="small muted">Recht und Steuern nur als Überblick – keine Steuer- oder Rechtsberatung. Konkrete Fragen (Gewerbe, Umsatzsteuer, Differenzbesteuerung) mit Steuerberater klären.</p>
    </div>
  );
}
