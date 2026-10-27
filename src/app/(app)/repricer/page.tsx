import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { repricerRows } from "@/lib/repricer";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/numbers";
import { fbaReport } from "@/lib/stock/fba-report";
import { breakdownText } from "@/lib/stock/breakdown";
import { COST_SOURCE_LABEL } from "@/lib/money/profit-logic";
import { isEstimated, repricerCoverage } from "@/lib/repricer-logic";

export default async function RepricerPage({ searchParams }: { searchParams: Promise<{ nur?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const s = await getSettings(session.tenantId);
  const all = await repricerRows(session.tenantId);
  // Ohne FBA-Bericht ist unbekannt, welche SKUs bei Amazon liegen – nicht „0 SKUs“.
  const fr = await fbaReport(session.tenantId);
  const below = all.filter((r) => r.min !== null && r.price !== null && r.price < r.min);
  const cov = repricerCoverage(all);
  const rows = sp.nur === "unter" ? below : sp.nur === "ohne-ek" ? all.filter((r) => r.unitCost === null) : sp.nur === "ohne-preis" ? all.filter((r) => r.price === null) : sp.nur === "geschaetzt" ? all.filter((r) => r.min !== null && isEstimated(r)) : all;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Einkauf & Buchhaltung</div><h1>Repricer (BQool)</h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn-primary" href="/repricer/export?format=bqool" title="Nur Mindestpreise mit echten Gebühren aus der Gebührenvorschau" data-testid="export-exact">BQool-CSV ({cov.exact} mit echten Gebühren)</a>
          {cov.estimated > 0 && <a className="btn" href="/repricer/export?format=bqool&geschaetzt=1" title="Enthält Mindestpreise mit pauschaler FBA-Gebühr bzw. Provision – vor dem Einsatz prüfen" data-testid="export-estimated">inkl. {cov.estimated} geschätzter</a>}
          <a className="btn" href="/repricer/export?format=de">Als Tabelle (deutsch)</a>
        </div>
      </div>
      <div className="grid-kpi">
        <div className="card card-pad" data-testid="kpi-repricer-skus">
          <div className="kpi-label">SKUs mit Bestand bei Amazon</div>
          {fr.missing ? (
            <><div className="kpi-value muted" style={{ fontSize: 18 }}>unbekannt</div><Link className="small" href="/import" style={{ color: "var(--warn)" }}>FBA-Bestandsbericht fehlt →</Link></>
          ) : (
            <><div className="kpi-value">{all.length}</div><div className="small" style={fr.stale ? { color: "var(--warn)" } : undefined}>{fr.stale ? `Stand ${formatDate(fr.snapshot)} – veraltet` : `laut ${fr.source === "sellerboard" ? "sellerboard" : "Bericht"} vom ${formatDate(fr.snapshot)}`}</div></>
          )}
        </div>
        <div className="card card-pad" data-testid="kpi-below">
          <div className="kpi-label">Aktueller Preis unter Mindestpreis</div>
          {cov.checkable === 0 ? (
            <><div className="kpi-value muted" style={{ fontSize: 18 }} data-testid="below-value">nicht prüfbar</div><div className="small" style={{ color: "var(--warn)" }}>{cov.total ? `Bei keiner SKU liegen aktueller Preis und Mindestpreis zusammen vor (${cov.noPrice} ohne Preis, ${cov.noMin} ohne Mindestpreis).` : "Keine SKUs."}</div></>
          ) : (
            <><div className="kpi-value" style={{ color: below.length ? "var(--danger)" : undefined }} data-testid="below-value">{below.length}</div><div className="small muted" data-testid="below-coverage">geprüft: {cov.checkable} von {cov.total} SKUs{cov.noPrice ? ` · ${cov.noPrice} ohne aktuellen Preis` : ""}{cov.noMin ? ` · ${cov.noMin} ohne Mindestpreis` : ""}</div></>
          )}
        </div>
        <div className="card card-pad"><div className="kpi-label">Ohne EK (kein Mindestpreis)</div><div className="kpi-value">{all.filter((r) => r.unitCost === null).length}</div></div>
        <div className="card card-pad small muted">Mindestgewinn {formatEuro(s.pricing.minProfit)} · Provision {Math.round(s.pricing.referralRate * 100)} % (wenn keine Gebührenvorschau) · Max = Min × {String(s.pricing.maxPriceFactor).replace(".", ",")} bzw. Ziel-VK. <Link href="/einstellungen">Ändern</Link></div>
      </div>
      {cov.estimated > 0 && (
        <div className="notice notice-warn small" data-testid="estimated-warning">
          <strong>{cov.estimated} von {cov.exact + cov.estimated} Mindestpreisen sind geschätzt:</strong> ohne Gebührenvorschau rechnet das System mit pauschal {formatEuro(s.pricing.defaultFbaFee)} FBA-Gebühr bzw. {Math.round(s.pricing.referralRate * 100)} % Provision. Vor dem Einsatz in BQool die <Link href="/import">Gebührenvorschau importieren</Link> – der BQool-Export enthält geschätzte Werte nur, wenn du es ausdrücklich wählst. <Link href="/repricer?nur=geschaetzt">Geschätzte ansehen →</Link>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <Link href="/repricer" className={`chip${!sp.nur ? " active" : ""}`}>Alle</Link>
        <Link href="/repricer?nur=unter" className={`chip${sp.nur === "unter" ? " active" : ""}`}>Unter Mindestpreis</Link>
        <Link href="/repricer?nur=ohne-ek" className={`chip${sp.nur === "ohne-ek" ? " active" : ""}`}>Ohne EK</Link>
        <Link href="/repricer?nur=ohne-preis" className={`chip${sp.nur === "ohne-preis" ? " active" : ""}`}>Ohne aktuellen Preis · {cov.noPrice}</Link>
        <Link href="/repricer?nur=geschaetzt" className={`chip${sp.nur === "geschaetzt" ? " active" : ""}`}>Geschätzte Gebühren · {cov.estimated}</Link>
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>SKU</th><th>Artikel</th><th className="right" title="Verkaufbar + reserviert + unterwegs (nicht verkaufbar zählt nicht)">Bestand</th><th className="right" title="Gültiger EK netto – gleicher Rechenweg wie Produkt, Gewinn und Nachbestellung">EK netto</th><th className="right">FBA-Gebühr</th><th className="right">Aktuell</th><th className="right">Min</th><th className="right">Max</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted" data-testid="repricer-empty">{fr.missing ? <>Der FBA-Bestandsbericht fehlt – welche SKUs bei Amazon liegen, ist unbekannt (nicht „kein Bestand“). <Link href="/import">Bericht importieren</Link>.</> : sp.nur ? "Keine SKUs in dieser Ansicht." : `Laut FBA-Bericht vom ${formatDate(fr.snapshot)} liegt keine Ware bei Amazon.`}</td></tr>}
            {rows.slice(0, 1000).map((r) => (
              <tr key={r.sku}>
                <td className="num small">{r.sku}</td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? r.asin}</td>
                <td className="num right" title={breakdownText(r.breakdown)}>{r.stock}</td>
                <td className="num right" data-testid="repricer-ek" data-sku={r.sku}>
                  {r.unitCost === null ? <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}?tab=einkauf`} className="tag tag-missing">fehlt</Link> : formatEuro(r.unitCost)}
                  {r.costSource && <div className="small muted" style={{ fontFamily: "inherit" }}>{COST_SOURCE_LABEL[r.costSource]}</div>}
                  {r.sbCostNote && <div className="small" style={{ color: "var(--warn)", fontFamily: "inherit" }} data-testid="repricer-sb-note">sellerboard {formatEuro(r.sbCostNote.value)}{r.sbCostNote.placeholder ? " (Platzhalter)" : " weicht ab"}</div>}
                </td>
                <td className="num right" title={r.feeEstimated ? `Pauschal ${formatEuro(s.pricing.defaultFbaFee)} – keine Gebührenvorschau` : "aus der Gebührenvorschau"}>{formatEuro(r.fbaFee)}{r.feeEstimated ? " ~" : ""}</td>
                <td className="num right" style={{ color: r.min !== null && r.price !== null && r.price < r.min ? "var(--danger)" : undefined }}>{r.price === null ? <span className="muted" title="Kein aktueller Preis – „unter Mindestpreis“ nicht prüfbar">nicht bekannt</span> : formatEuro(r.price)}</td>
                <td className="num right" style={{ fontWeight: 600 }}>{formatEuro(r.min)}{r.min !== null && isEstimated(r) && <div className="small" style={{ color: "var(--warn)", fontWeight: 400, fontFamily: "inherit" }} data-testid="min-estimated">geschätzt</div>}</td>
                <td className="num right">{formatEuro(r.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="small muted">EK = gültiger Einkaufspreis netto (Charge → von Hand → eBay-Tool → Set → sellerboard → geerbt), derselbe Wert wie in Produkt, Gewinn und Nachbestellung. „~“ bzw. „geschätzt“ = pauschale FBA-Gebühr oder Provision (Gebührenvorschau importieren für echte Werte). „nicht bekannt“ = kein aktueller Preis im Bestandsbericht. Die BQool-Spalten bitte beim ersten Import mit der BQool-Vorlage abgleichen.</div>
    </>
  );
}
