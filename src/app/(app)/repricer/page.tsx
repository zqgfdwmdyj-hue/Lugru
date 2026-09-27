import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { repricerRows } from "@/lib/repricer";
import { getSettings } from "@/lib/settings";

export default async function RepricerPage({ searchParams }: { searchParams: Promise<{ nur?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const s = await getSettings(session.tenantId);
  const all = await repricerRows(session.tenantId);
  const below = all.filter((r) => r.min !== null && r.price !== null && r.price < r.min);
  const rows = sp.nur === "unter" ? below : sp.nur === "ohne-ek" ? all.filter((r) => r.unitCost === null) : all;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Einkauf & Buchhaltung</div><h1>Repricer (BQool)</h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn-primary" href="/repricer/export?format=bqool">BQool-CSV herunterladen</a>
          <a className="btn" href="/repricer/export?format=de">Als Tabelle (deutsch)</a>
        </div>
      </div>
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">SKUs mit Bestand</div><div className="kpi-value">{all.length}</div></div>
        <div className="card card-pad"><div className="kpi-label">Aktueller Preis unter Mindestpreis</div><div className="kpi-value" style={{ color: below.length ? "var(--danger)" : undefined }}>{below.length}</div></div>
        <div className="card card-pad"><div className="kpi-label">Ohne EK (kein Mindestpreis)</div><div className="kpi-value">{all.filter((r) => r.unitCost === null).length}</div></div>
        <div className="card card-pad small muted">Mindestgewinn {formatEuro(s.pricing.minProfit)} · Provision {Math.round(s.pricing.referralRate * 100)} % (wenn keine Gebührenvorschau) · Max = Min × {String(s.pricing.maxPriceFactor).replace(".", ",")} bzw. Ziel-VK. <Link href="/einstellungen">Ändern</Link></div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Link href="/repricer" className={`chip${!sp.nur ? " active" : ""}`}>Alle</Link>
        <Link href="/repricer?nur=unter" className={`chip${sp.nur === "unter" ? " active" : ""}`}>Unter Mindestpreis</Link>
        <Link href="/repricer?nur=ohne-ek" className={`chip${sp.nur === "ohne-ek" ? " active" : ""}`}>Ohne EK</Link>
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>SKU</th><th>Artikel</th><th className="right">Bestand</th><th className="right">EK</th><th className="right">FBA-Gebühr</th><th className="right">Aktuell</th><th className="right">Min</th><th className="right">Max</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Keine SKUs. FBA-Bestandsbericht importieren.</td></tr>}
            {rows.slice(0, 1000).map((r) => (
              <tr key={r.sku}>
                <td className="num small">{r.sku}</td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? r.asin}</td>
                <td className="num right">{r.stock}</td>
                <td className="num right">{formatEuro(r.unitCost)}</td>
                <td className="num right">{formatEuro(r.fbaFee)}{r.feeEstimated ? " ~" : ""}</td>
                <td className="num right" style={{ color: r.min !== null && r.price !== null && r.price < r.min ? "var(--danger)" : undefined }}>{formatEuro(r.price)}</td>
                <td className="num right" style={{ fontWeight: 600 }}>{formatEuro(r.min)}</td>
                <td className="num right">{formatEuro(r.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="small muted">„~“ = geschätzte FBA-Gebühr (Gebührenvorschau importieren für echte Werte). Die BQool-Spalten bitte beim ersten Import mit der BQool-Vorlage abgleichen.</div>
    </>
  );
}
