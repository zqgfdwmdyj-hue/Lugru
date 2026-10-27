import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { TAX_SHORT } from "@/lib/watches/calc";
import { dealHints, dealResult, normRef, PRICE_KIND_LABEL, PRICE_KINDS, priceSummary, SET_LABEL } from "@/lib/watches/logic";
import { asDealLike, asNote, costSum, getDeal, listPrices, requireFlip } from "@/lib/watches/service";
import { addCheckAction, deleteDealAction, saveDealAction, toggleCheckAction } from "../../actions";
import { DealFields } from "../../deal-fields";
import { CoachButton, FlipForm } from "../../forms";
import { ConfirmButton } from "@/components/confirm-button";
import { dmy, eur, FlipHead, pct, StatusTag } from "../../ui";

/** Ein Deal: Rechnung, Lern-Hinweise, Ankauf-Prüfliste, Vergleichspreise, KI-Coach und alle Angaben. */
export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { session, brandName } = await requireFlip();
  const sp = await searchParams;
  const d = await getDeal(session.tenantId, id);
  if (!d) notFound();
  const today = todayIso();
  const [notes, ai] = await Promise.all([d.reference ? listPrices(session.tenantId, normRef(d.reference)) : Promise.resolve([]), getIntegration(session.tenantId, "anthropic")]);
  const prices = d.reference ? priceSummary(notes.map(asNote), d.reference) : {};
  const like = asDealLike(d);
  const r = dealResult(like, today);
  const hints = dealHints({ ...like, checklist: d.checklist, reference: d.reference }, prices);
  const doneChecks = d.checklist.filter((c) => c.done).length;

  return (
    <div className="flip stack" style={{ gap: 16 }}>
      <FlipHead title={`${d.maker} ${d.model ?? ""}`.trim()} brand={brandName} sub={[d.reference, d.year, d.condition === "neu" ? "neu / ungetragen" : "gebraucht", SET_LABEL[d.watchSet]].filter(Boolean).join(" · ")} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <StatusTag status={d.status} practice={d.practice} />
        <span className="small muted">{TAX_SHORT[d.taxMode]}{d.source ? ` · Quelle: ${d.source}` : ""}</span>
        {d.url && <a className="small" href={d.url} target="_blank" rel="noopener noreferrer">Anzeige öffnen ↗</a>}
        <Link className="small" href="/marken/uhren/deals">← alle Deals</Link>
      </div>
      {sp.neu && <div className="notice notice-ok small" role="status">Deal angelegt. Jetzt Prüfliste abarbeiten, Vergleichspreise notieren und Ankauf/Ziel-Verkauf eintragen.</div>}

      <section className="card card-pad stack" data-testid="deal-result">
        <h2>{r ? (r.planned ? "Geplante Rechnung" : "Ergebnis") : "Rechnung"}</h2>
        {!r ? (
          <p className="small muted">Ankaufspreis und Ziel-Verkaufspreis (bzw. Verkaufspreis) eintragen – dann rechnet es hier.</p>
        ) : (
          <>
            <div className="grid-kpi flip-kpis">
              <div className="card card-pad kpi-card"><div className="kpi-label">{r.planned ? "Gewinn (geplant)" : "Gewinn"}</div><div className={`kpi-value${r.profit < 0 ? " flip-neg" : ""}`} data-testid="deal-profit">{eur(r.profit)}</div></div>
              <div className="card card-pad kpi-card"><div className="kpi-label">Marge</div><div className="kpi-value">{pct(r.marginPct)}</div></div>
              <div className="card card-pad kpi-card"><div className="kpi-label">Rendite</div><div className="kpi-value">{pct(r.roiPct)}</div><div className="small muted">{r.roiPerMonthPct !== null ? `${pct(r.roiPerMonthPct)} je Monat` : r.days !== null ? `seit ${r.days} Tagen gebunden` : ""}</div></div>
              <div className="card card-pad kpi-card"><div className="kpi-label">Break-even</div><div className="kpi-value">{eur(r.breakEven)}</div></div>
            </div>
            <div className="small muted">
              Ankauf {eur(d.buyPrice)} ({dmy(d.buyDate)}) · Nebenkosten {eur(costSum(d))} · Gebühren {eur(r.fees)} · Versand {eur(d.shipping)} · Umsatzsteuer {eur(r.vat)} · {r.planned ? `Ziel-Verkauf ${eur(d.targetSell)}` : `Verkauf ${eur(d.sellPrice)} (${dmy(d.sellDate)})`}
            </div>
          </>
        )}
        {hints.length > 0 && (
          <div className="notice notice-info small" data-testid="deal-hints">
            <strong>Lern-Hinweise</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{hints.map((h) => <li key={h}>{h}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="card card-pad stack" data-testid="deal-checklist">
        <div className="between"><h2>Ankauf-Prüfliste</h2><span className="small muted">{doneChecks}/{d.checklist.length} erledigt</span></div>
        <ul className="flip-checklist">
          {d.checklist.map((c, i) => (
            <li key={i} className={c.done ? "on" : ""}>
              <form action={toggleCheckAction}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="i" value={i} />
                <button type="submit" aria-pressed={c.done} data-testid={`check-${i}`}><span className="box" aria-hidden="true">{c.done ? "✓" : ""}</span><span className="t small">{c.text}</span></button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addCheckAction} style={{ display: "flex", gap: 6 }}>
          <input type="hidden" name="id" value={d.id} />
          <input className="input" name="text" placeholder="Eigener Prüfpunkt" maxLength={160} style={{ flex: 1, minWidth: 0 }} />
          <button className="btn btn-small" type="submit">Hinzufügen</button>
        </form>
      </section>

      <section className="card card-pad stack" data-testid="deal-prices">
        <div className="between"><h2>Vergleichspreise</h2><Link className="small" href={`/marken/uhren/preise${d.reference ? `?ref=${encodeURIComponent(d.reference)}` : ""}`}>notieren →</Link></div>
        {!d.reference ? (
          <p className="small muted">Referenz eintragen – dann erscheinen hier deine notierten Preise.</p>
        ) : PRICE_KINDS.every((k) => !prices[k]) ? (
          <p className="small muted">Für {d.reference} ist noch nichts notiert. Mindestens drei verkaufte Preise suchen.</p>
        ) : (
          <ul className="flip-list">
            {PRICE_KINDS.filter((k) => prices[k]).map((k) => {
              const s = prices[k]!;
              return (
                <li key={k} className="small">
                  <strong>{PRICE_KIND_LABEL[k]}</strong>
                  <div>Median <strong>{eur(s.median)}</strong> · {s.n}× · Spanne {eur(s.min)} – {eur(s.max)} · zuletzt {dmy(s.last)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card card-pad stack" data-testid="deal-coach">
        <h2>KI-Coach</h2>
        <CoachButton id={d.id} hasKey={Boolean(ai?.apiKey)} again={Boolean(d.aiFeedback)} />
        {d.aiFeedback && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="small muted">Stand {d.aiAt ? d.aiAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : ""} – nutzt nur deine Angaben und Preis-Notizen, erfindet keine Marktpreise. Eine zweite Meinung, keine Garantie.</div>
            <div className="flip-ai small">{d.aiFeedback}</div>
          </div>
        )}
      </section>

      <section className="card card-pad stack">
        <h2>Angaben ändern</h2>
        <FlipForm action={saveDealAction} submit="Speichern" testid="deal-edit">
          <DealFields d={d} />
        </FlipForm>
      </section>

      <form action={deleteDealAction} className="small">
        <input type="hidden" name="id" value={d.id} />
        <ConfirmButton confirm={`Deal „${d.maker} ${d.model ?? ""}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`} className="btn btn-small btn-danger-soft" testid="deal-delete">Deal löschen</ConfirmButton>
      </form>
    </div>
  );
}
