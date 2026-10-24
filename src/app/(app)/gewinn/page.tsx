import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Kpi } from "@/components/kpi";
import { skuCostMap } from "@/lib/money/costs";
import { amazonProfit, dataStand, orderLines } from "@/lib/money/profit";
import { FEE_FREE_CHANNELS, summarizeAmazon, summarizeChannels, totalsOf } from "@/lib/money/profit-logic";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { RANGES, rangeOf, type Range } from "@/lib/money/ranges";

const dt = (d: Date | null | undefined) => (d ? d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }) : "–");
/** Kosten als positive Zahl zeigen, ohne „−0,00 €“. */
const neg = (n: number) => (n === 0 ? 0 : -n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function GewinnPage({ searchParams }: { searchParams: Promise<{ zeitraum?: string; sort?: string }> }) {
  const session = await requireArea("geld");
  const sp = await searchParams;
  const r: Range = sp.zeitraum && sp.zeitraum in RANGES ? (sp.zeitraum as Range) : "30";
  const [from, to] = rangeOf(r, todayIso());
  const t = session.tenantId;
  const settings = await getSettings(t);
  const costs = await skuCostMap(t);
  const [{ skus, nonSku }, lines, stand] = await Promise.all([amazonProfit(t, from, to, settings.vatRate, costs), orderLines(t, from, to), dataStand(t)]);

  const nonSkuTotal = nonSku.reduce((n, x) => n + x.amount, 0);
  const amazon = skus.length || nonSku.length
    ? summarizeAmazon(
        skus.map((s) => ({ sku: s.sku, units: s.units, revenueNet: s.revenueNet, costsExCogs: s.fees + s.promotions / (1 + settings.vatRate) + s.reimbursements + s.other, cogs: s.cogs })),
        nonSkuTotal,
      )
    : null;
  const channels = summarizeChannels(lines, costs, settings.vatRate);
  const tot = totalsOf(amazon, channels);
  const fees = skus.reduce((n, s) => n + s.fees, 0);
  const cogs = skus.reduce((n, s) => n + (s.cogs ?? 0), 0) + channels.reduce((n, c) => n + c.cogsKnown, 0);
  const period = `${formatDate(from)} – ${formatDate(to)}`;
  const standText = [stand.settlement ? `Amazon-Abrechnung bis ${formatDate(stand.settlement)}` : "keine Amazon-Abrechnung", ...channels.map((c) => `${CHANNEL_LABEL[c.channel] ?? c.channel} ${dt(stand.orders.get(c.channel))}`)].join(" · ");
  const missing = [
    tot.missing.costSkus ? `EK für ${plural(tot.missing.costSkus, "SKU", "SKUs")}` : null,
    tot.missing.feeOrders ? `Gebühren für ${plural(tot.missing.feeOrders, "Bestellung", "Bestellungen")}` : null,
    tot.missing.priceLines ? `Preis für ${plural(tot.missing.priceLines, "Position", "Positionen")}` : null,
  ].filter((x): x is string => Boolean(x));
  const fix = `/gewinn/fehlend?zeitraum=${r}`;
  const sorted = [...skus].sort((a, b) => (sp.sort === "gut" ? (b.profit ?? -1e9) - (a.profit ?? -1e9) : (a.profit ?? 1e9) - (b.profit ?? 1e9)));
  const noData = !amazon && !channels.length;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Finanzen</div><h1>Gewinn</h1><div className="small muted" style={{ marginTop: 4 }}>{period}</div></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(RANGES) as Range[]).map((k) => <Link key={k} href={`/gewinn?zeitraum=${k}`} className={`chip${r === k ? " active" : ""}`}>{RANGES[k]}</Link>)}
        </div>
      </div>

      {noData && <div className="notice notice-warn">Keine Abrechnungen und keine Aufträge in diesem Zeitraum. Amazon: Settlement-Reports unter „Daten importieren“; eBay/Temu kommen über die Anbindungen.</div>}
      {!noData && !tot.complete && (
        <div className="notice notice-warn" data-testid="profit-incomplete">
          <strong>Unvollständige Daten:</strong> {missing.join(", ")} fehlen. Der „vorläufige“ Wert enthält nur bekannte Kosten; der vollständig berechnete Gewinn umfasst nur {tot.coverage} % des Umsatzes.{" "}
          <Link href={fix}>Fehlende Werte nachtragen →</Link>
        </div>
      )}

      <div className="grid-kpi">
        <Kpi testid="kpi-revenue" label="Umsatz netto (alle Kanäle)" value={formatEuro(tot.revenueNet)} state={tot.missing.priceLines ? "unvollstaendig" : "ok"} missing={tot.missing.priceLines ? [`Preis für ${plural(tot.missing.priceLines, "Position", "Positionen")}`] : undefined} fixHref={`${fix}#preis`} period={period} source="Amazon-Abrechnungen, Aufträge" stand={stand.settlement ? formatDate(stand.settlement) : undefined} />
        <Kpi
          testid="kpi-provisional"
          label="Vorläufiges Ergebnis"
          value={formatEuro(tot.provisional)}
          danger={tot.provisional < 0}
          state={tot.complete ? "ok" : "unvollstaendig"}
          note="Umsatz minus bekannte Kosten (Gebühren, EK, sonstige)"
          missing={missing}
          fixHref={fix}
          period={period}
        />
        <Kpi
          testid="kpi-profit"
          label="Gewinn (vollständig berechnet)"
          value={tot.completeRevenueNet > 0 || tot.complete ? formatEuro(tot.completeProfit) : "–"}
          danger={tot.completeProfit < 0}
          state={tot.complete ? "ok" : tot.coverage > 0 ? "unvollstaendig" : "fehlt"}
          note={tot.complete ? `Marge ${tot.revenueNet ? `${((tot.completeProfit / tot.revenueNet) * 100).toFixed(1).replace(".", ",")} %` : "–"}` : `nur Positionen mit Preis, EK und Gebühren: ${tot.coverage} % des Umsatzes (${formatEuro(tot.completeRevenueNet)})`}
          period={period}
        />
        <Kpi testid="kpi-costs" label="Bekannte Kosten" value={formatEuro(neg(fees) + cogs + neg(nonSkuTotal) + channels.reduce((n, c) => n + c.feesKnown, 0))} note={`Amazon-Gebühren ${formatEuro(neg(fees))} · Wareneinsatz ${formatEuro(cogs)} · Kanalgebühren ${formatEuro(channels.reduce((n, c) => n + c.feesKnown, 0))} · sonstige ${formatEuro(neg(nonSkuTotal))}`} period={period} />
      </div>
      <details className="small muted">
        <summary style={{ cursor: "pointer" }}>Datenstand und Rechenweg</summary>
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          <div>Stand: {standText}</div>
          <div>Umsatz netto = Brutto ÷ (1 + {Math.round(settings.vatRate * 100)} % MwSt). EK in dieser Reihenfolge: Charge → „EK je SKU“ (von Hand) → Einkaufspreis aus dem eBay-Tool. Erstattete Einheiten gelten als zurück im Bestand.</div>
          <div>Gebühren: Amazon aus der Abrechnung, eBay je Bestellung von eBay (ältere Bestellungen ohne Angabe → „fehlt“), Temu ohne eigene Gebühr (Basispreis), Manuell ohne Gebühr. Fehlende Werte zählen nie als 0 €.</div>
          <div>„Vorläufig“ = Umsatz − bekannte Kosten. „Vollständig berechnet“ = nur Positionen, bei denen Preis, EK und Gebühr bekannt sind – plus Amazon-Kosten ohne SKU.</div>
        </div>
      </details>

      <section className="card" style={{ overflow: "auto" }} data-testid="channels">
        <div className="card-head"><h2>Je Kanal</h2></div>
        <table className="table">
          <thead><tr><th>Kanal</th><th className="right">Umsatz netto</th><th className="right">EK (bekannt)</th><th className="right">Gebühren (bekannt)</th><th className="right">Vorläufig</th><th className="right">Vollständig</th><th>Fehlt</th></tr></thead>
          <tbody>
            {amazon && (
              <tr>
                <td>Amazon</td>
                <td className="num right">{formatEuro(amazon.revenueNet)}</td>
                <td className="num right">{formatEuro(skus.reduce((n, s) => n + (s.cogs ?? 0), 0))}</td>
                <td className="num right">{formatEuro(neg(fees))}</td>
                <td className="num right">{formatEuro(amazon.provisional)}</td>
                <td className="num right">{formatEuro(amazon.completeProfit)}</td>
                <td className="small">{amazon.missingCostSkus.length ? <Link href={`${fix}#ek`} style={{ color: "var(--warn)" }}>EK: {plural(amazon.missingCostSkus.length, "SKU", "SKUs")}</Link> : <span className="muted">–</span>}</td>
              </tr>
            )}
            {channels.map((c) => (
              <tr key={c.channel} data-testid={`channel-${c.channel}`}>
                <td>{CHANNEL_LABEL[c.channel] ?? c.channel}<div className="small muted">{plural(c.orders, "Bestellung", "Bestellungen")}</div></td>
                <td className="num right">{formatEuro(c.revenueNet)}</td>
                <td className="num right">{formatEuro(c.cogsKnown)}</td>
                <td className="num right">{FEE_FREE_CHANNELS.has(c.channel) ? <span className="muted small">keine</span> : formatEuro(c.feesKnown)}</td>
                <td className="num right">{formatEuro(c.provisional)}</td>
                <td className="num right">{c.completeRevenueNet > 0 ? formatEuro(c.completeProfit) : "–"}</td>
                <td className="small" style={{ color: "var(--warn)" }}>
                  {[c.missingCost ? <Link key="ek" href={`${fix}#ek`}>EK: {plural(c.missingCost, "Pos.", "Pos.")}</Link> : null, c.missingFeeOrders ? <Link key="fee" href={`${fix}#gebuehren`}>Gebühr: {plural(c.missingFeeOrders, "Best.", "Best.")}</Link> : null, c.missingPrice ? <Link key="p" href={`${fix}#preis`}>Preis: {plural(c.missingPrice, "Pos.", "Pos.")}</Link> : null]
                    .filter(Boolean)
                    .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), []) }
                  {!c.missingCost && !c.missingFeeOrders && !c.missingPrice && <span className="muted">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <div className="card-head">
            <h2>Je SKU (Amazon)</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <Link className={`chip${sp.sort !== "gut" ? " active" : ""}`} href={`/gewinn?zeitraum=${r}`}>Schlechteste zuerst</Link>
              <Link className={`chip${sp.sort === "gut" ? " active" : ""}`} href={`/gewinn?zeitraum=${r}&sort=gut`}>Beste zuerst</Link>
            </div>
          </div>
          {skus.length === 0 ? <div className="card-pad small muted">Keine Amazon-Abrechnung in diesem Zeitraum.</div> : (
            <table className="table sticky-head">
              <thead><tr><th>SKU</th><th className="right">Verkauft</th><th className="right">Erstattet</th><th className="right">Umsatz netto</th><th className="right">Gebühren</th><th className="right">EK</th><th className="right">Gewinn</th><th className="right">je Stk</th><th className="right">VK geplant / Ø</th></tr></thead>
              <tbody>
                {sorted.slice(0, 300).map((s) => {
                  const perUnit = s.profit !== null && s.units - s.refunds > 0 ? s.profit / (s.units - s.refunds) : null;
                  const priceDrop = s.plannedPrice && s.avgPrice ? s.avgPrice < s.plannedPrice * 0.9 : false;
                  return (
                    <tr key={s.sku}>
                      <td className="num small" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.title ?? undefined}><Link href={`/produkte?q=${encodeURIComponent(s.sku)}`}>{s.sku}</Link></td>
                      <td className="num right">{s.units}</td>
                      <td className="num right">{s.refunds || ""}</td>
                      <td className="num right">{formatEuro(s.revenueNet)}</td>
                      <td className="num right">{formatEuro(s.fees)}</td>
                      <td className="num right">{s.cogs === null ? <Link href={`${fix}#ek`} style={{ color: "var(--warn)" }}>fehlt</Link> : formatEuro(s.cogs)}</td>
                      <td className="num right" style={{ fontWeight: 600, color: (s.profit ?? 0) < 0 ? "var(--danger)" : undefined }}>{s.profit === null ? <span className="muted" title="EK fehlt – kein Gewinn berechenbar">–</span> : formatEuro(s.profit)}</td>
                      <td className="num right">{formatEuro(perUnit)}</td>
                      <td className="num right small" style={{ color: priceDrop ? "var(--danger)" : undefined }}>{s.plannedPrice ? formatEuro(s.plannedPrice) : "–"} / {formatEuro(s.avgPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Amazon-Kosten ohne SKU</h2>
            {nonSku.length === 0 && <div className="small muted">Keine im Zeitraum.</div>}
            {nonSku.map((n, i) => <div key={i} className="between small"><span>{n.description ?? n.type ?? "–"}</span><span className="num">{formatEuro(n.amount)}</span></div>)}
          </section>
          <section className="card card-pad small muted">
            „VK geplant“ ist der Zielpreis aus der Arbitrage-One-SKU – rot, wenn der tatsächliche Ø-Preis über 10 % darunter liegt.
          </section>
        </aside>
      </div>
    </>
  );
}
