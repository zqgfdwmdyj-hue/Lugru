import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { CHANNEL_LABEL } from "@/lib/labels";
import { amazonProfit, otherChannelProfit } from "@/lib/money/profit";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";

const RANGES = { "30": "Letzte 30 Tage", monat: "Dieser Monat", vormonat: "Letzter Monat", "90": "Letzte 90 Tage", jahr: "Dieses Jahr" } as const;
type Range = keyof typeof RANGES;

function range(r: Range, today: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  switch (r) {
    case "monat": return [first(y, m), today];
    case "vormonat": { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return [first(py, pm), addDaysIso(first(y, m), -1)]; }
    case "90": return [addDaysIso(today, -89), today];
    case "jahr": return [`${y}-01-01`, today];
    default: return [addDaysIso(today, -29), today];
  }
}

export default async function GewinnPage({ searchParams }: { searchParams: Promise<{ zeitraum?: string; sort?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const r: Range = sp.zeitraum && sp.zeitraum in RANGES ? (sp.zeitraum as Range) : "30";
  const [from, to] = range(r, todayIso());
  const settings = await getSettings(session.tenantId);
  const [{ skus, nonSku }, others] = await Promise.all([amazonProfit(session.tenantId, from, to, settings.vatRate), otherChannelProfit(session.tenantId, from, to, settings.vatRate)]);

  const sum = (f: (s: (typeof skus)[number]) => number | null) => skus.reduce((n, s) => n + (f(s) ?? 0), 0);
  const revenueGross = sum((s) => s.revenueGross);
  const revenueNet = sum((s) => s.revenueNet);
  const fees = sum((s) => s.fees);
  const reimb = sum((s) => s.reimbursements);
  const cogs = sum((s) => s.cogs);
  const nonSkuTotal = nonSku.reduce((n, x) => n + x.amount, 0);
  const skuProfit = sum((s) => s.profit);
  const missingCost = skus.filter((s) => s.cogs === null && s.units > 0).length;
  const otherProfit = others.reduce((n, o) => n + o.revenueNet - o.cogs, 0);
  const profit = skuProfit + nonSkuTotal + otherProfit;
  const sorted = [...skus].sort((a, b) => (sp.sort === "gut" ? (b.profit ?? -1e9) - (a.profit ?? -1e9) : (a.profit ?? 1e9) - (b.profit ?? 1e9)));

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Geld</div><h1>Gewinn</h1><div className="small muted" style={{ marginTop: 4 }}>{formatDate(from)} – {formatDate(to)}</div></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(RANGES) as Range[]).map((k) => <Link key={k} href={`/gewinn?zeitraum=${k}`} className={`chip${r === k ? " active" : ""}`}>{RANGES[k]}</Link>)}
        </div>
      </div>
      {skus.length === 0 && <div className="notice notice-warn">Keine Abrechnungsdaten in diesem Zeitraum. Settlement-Reports (Flat File V2) unter „Daten importieren“ hochladen.</div>}
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Gewinn (alle Kanäle)</div><div className="kpi-value" style={{ color: profit < 0 ? "var(--danger)" : undefined }}>{formatEuro(profit)}</div><div className="small muted">Marge {revenueNet ? `${((profit / revenueNet) * 100).toFixed(1).replace(".", ",")} %` : "–"} · ROI {cogs ? `${((profit / cogs) * 100).toFixed(0)} %` : "–"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Amazon-Umsatz</div><div className="kpi-value">{formatEuro(revenueGross)}</div><div className="small muted">netto {formatEuro(revenueNet)}</div></div>
        <div className="card card-pad"><div className="kpi-label">Amazon-Gebühren</div><div className="kpi-value">{formatEuro(fees)}</div><div className="small muted">+ sonstige Kosten {formatEuro(nonSkuTotal)}</div></div>
        <div className="card card-pad"><div className="kpi-label">Wareneinsatz</div><div className="kpi-value">{formatEuro(cogs)}</div><div className="small muted">Erstattungen {formatEuro(reimb)}{missingCost ? ` · ${missingCost} SKUs ohne EK` : ""}</div></div>
      </div>

      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <div className="card-head">
            <h2>Je SKU (Amazon)</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <Link className={`chip${sp.sort !== "gut" ? " active" : ""}`} href={`/gewinn?zeitraum=${r}`}>Schlechteste zuerst</Link>
              <Link className={`chip${sp.sort === "gut" ? " active" : ""}`} href={`/gewinn?zeitraum=${r}&sort=gut`}>Beste zuerst</Link>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>SKU</th><th className="right">Verkauft</th><th className="right">Erstattet</th><th className="right">Umsatz netto</th><th className="right">Gebühren</th><th className="right">EK</th><th className="right">Gewinn</th><th className="right">je Stk</th><th className="right">VK geplant / Ø</th></tr></thead>
            <tbody>
              {sorted.slice(0, 300).map((s) => {
                const perUnit = s.profit !== null && s.units - s.refunds > 0 ? s.profit / (s.units - s.refunds) : null;
                const priceDrop = s.plannedPrice && s.avgPrice ? s.avgPrice < s.plannedPrice * 0.9 : false;
                return (
                  <tr key={s.sku}>
                    <td className="num small" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.title ?? undefined}><Link href={`/chargen?q=${encodeURIComponent(s.sku)}`}>{s.sku}</Link></td>
                    <td className="num right">{s.units}</td>
                    <td className="num right">{s.refunds || ""}</td>
                    <td className="num right">{formatEuro(s.revenueNet)}</td>
                    <td className="num right">{formatEuro(s.fees)}</td>
                    <td className="num right">{s.cogs === null ? <span style={{ color: "var(--warn)" }}>fehlt</span> : formatEuro(s.cogs)}</td>
                    <td className="num right" style={{ fontWeight: 600, color: (s.profit ?? 0) < 0 ? "var(--danger)" : undefined }}>{formatEuro(s.profit)}</td>
                    <td className="num right">{formatEuro(perUnit)}</td>
                    <td className="num right small" style={{ color: priceDrop ? "var(--danger)" : undefined }}>{s.plannedPrice ? formatEuro(s.plannedPrice) : "–"} / {formatEuro(s.avgPrice)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Kosten ohne SKU</h2>
            {nonSku.length === 0 && <div className="small muted">Keine.</div>}
            {nonSku.map((n, i) => <div key={i} className="between small"><span>{n.description ?? n.type ?? "–"}</span><span className="num">{formatEuro(n.amount)}</span></div>)}
          </section>
          <section className="card card-pad stack">
            <h2>Andere Kanäle</h2>
            {others.length === 0 && <div className="small muted">Keine Aufträge im Zeitraum.</div>}
            {others.map((o) => (
              <div key={o.channel} className="small">
                <div className="between"><strong>{CHANNEL_LABEL[o.channel]}</strong><span className="num">{formatEuro(o.revenueNet - o.cogs)}</span></div>
                <div className="muted">{o.orders} Aufträge · Umsatz netto {formatEuro(o.revenueNet)} · EK {formatEuro(o.cogs)}{o.missingCost ? ` · ${o.missingCost} Pos. ohne EK` : ""} · ohne Kanalgebühren</div>
              </div>
            ))}
          </section>
          <section className="card card-pad small muted">
            Umsatz netto = Brutto ÷ (1 + {Math.round(settings.vatRate * 100)} % MwSt). Erstattete Einheiten zählen als zurück im Bestand. „VK geplant“ ist der Zielpreis aus der Arbitrage-One-SKU – rot, wenn der tatsächliche Ø-Preis über 10 % darunter liegt.
          </section>
        </aside>
      </div>
    </>
  );
}
