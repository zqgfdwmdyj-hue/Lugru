import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatEuro } from "@/lib/numbers";
import { MONTH_NAMES, loadOverview, monthLabel } from "@/lib/pallets/service";
import { Occupancy, PalletTabs } from "../tabs";

const short = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(2, 4)}`;

/**
 * Säulen je Monat (eine Reihe, daher ohne Legende – der Titel sagt, was gezeigt wird). Werte stehen
 * nur am letzten und am höchsten Monat; alle anderen per Hover/Fokus und in der Tabelle darunter.
 */
function MonthColumns({ title, data, format, reference }: { title: string; data: { month: string; value: number }[]; format: (n: number) => string; reference?: { value: number; label: string } }) {
  const max = Math.max(1, reference?.value ?? 0, ...data.map((d) => d.value));
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const labelled = new Set([data.length - 1, data[peak].value > 0 ? peak : -1]);
  return (
    <figure className="pal-chart" aria-label={title}>
      <figcaption className="kpi-label">{title}</figcaption>
      <div className="pal-plot">
        {reference && reference.value > 0 && (
          <div className="pal-ref" style={{ bottom: `${(reference.value / max) * 100}%` }}>
            <span>{reference.label}</span>
          </div>
        )}
        {data.map((d, i) => (
          <div key={d.month} className="pal-col" tabIndex={0} aria-label={`${monthLabel(d.month)}: ${format(d.value)}`}>
            <div className="pal-col-area">
              {labelled.has(i) && d.value > 0 && <span className="pal-col-value" style={{ bottom: `calc(${(d.value / max) * 100}% + 4px)` }}>{format(d.value)}</span>}
              <span className="pal-col-bar" style={{ height: `${(d.value / max) * 100}%` }} />
            </div>
            <span className="pal-col-x">{short(d.month)}</span>
            <span className="pal-tip" role="tooltip"><strong>{format(d.value)}</strong> {monthLabel(d.month)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export default async function PalettenUebersichtPage() {
  const session = await requireArea("paletten");
  const today = todayIso();
  const o = await loadOverview(session.tenantId, today);
  const now = o.months[o.months.length - 1];
  const active = o.months.filter((m) => m.revenue > 0 || m.occupied > 0);
  const avgRevenue = active.length ? o.total / active.length : 0;
  const avgOccupied = active.length ? Math.round(active.reduce((s, m) => s + m.occupied, 0) / active.length) : 0;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lager</div><h1>Paletten-Lager</h1></div>
        <span className="small muted">Letzte 12 Monate · laufender Monat bis Monatsende hochgerechnet</span>
      </div>
      <PalletTabs active="uebersicht" />

      <div className="grid-kpi">
        <div className="card card-pad">
          <div className="kpi-label">Belegt jetzt</div>
          <div className="kpi-value" data-testid="ov-occupied">{now.occupied}{o.capacity ? <span className="small muted"> / {o.capacity}</span> : null}</div>
          <Occupancy used={now.occupied} capacity={o.capacity} />
          {o.capacity > 0 && <div className="small muted">{Math.round((now.occupied / o.capacity) * 100)} % Auslastung</div>}
        </div>
        <div className="card card-pad"><div className="kpi-label">Umsatz 12 Monate</div><div className="kpi-value" data-testid="ov-total">{formatEuro(o.total)}</div><div className="small muted">Ø {formatEuro(avgRevenue)} je Monat</div></div>
        <div className="card card-pad"><div className="kpi-label">Ø belegt am Monatsende</div><div className="kpi-value">{avgOccupied}</div></div>
        <div className="card card-pad"><div className="kpi-label">Ø Standzeit</div><div className="kpi-value">{o.avgStayDays === null ? "–" : `${o.avgStayDays} Tage`}</div><div className="small muted">ausgelagerte Paletten</div></div>
      </div>

      <section className="card card-pad pal-charts">
        <MonthColumns title="Belegte Stellplätze am Monatsende" data={o.months.map((m) => ({ month: m.month, value: m.occupied }))} format={(n) => String(n)} reference={o.capacity ? { value: o.capacity, label: `${o.capacity} Stellplätze` } : undefined} />
        <MonthColumns title="Umsatz je Monat (Lager, Ein/Aus, Leistungen)" data={o.months.map((m) => ({ month: m.month, value: m.revenue }))} format={(n) => formatEuro(Math.round(n))} />
      </section>

      <section className="card" id="kunden">
        <div className="card-head"><h2>Kunden</h2><span className="small muted">Umsatz der letzten 12 Monate</span></div>
        <table className="table" data-testid="ov-customers">
          <thead><tr><th>Kunde</th><th className="right">Im Lager</th><th className="right">{monthLabel(now.month).split(" ")[0]}</th><th className="right">12 Monate</th><th className="right">Anteil</th></tr></thead>
          <tbody>
            {o.customers.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Daten.</td></tr>}
            {o.customers.map((c) => (
              <tr key={c.customer}>
                <td>{c.customer}</td>
                <td className="num right">{c.open}</td>
                <td className="num right">{formatEuro(c.byMonth[now.month] ?? 0)}</td>
                <td className="num right"><strong>{formatEuro(c.revenue)}</strong></td>
                <td className="num right">{o.total ? `${Math.round((c.revenue / o.total) * 100)} %` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <details className="card-pad">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Zahlen je Monat als Tabelle</summary>
          <table className="table" style={{ marginTop: 10 }} data-testid="ov-months">
            <thead><tr><th>Monat</th><th className="right">Belegt</th><th className="right">Lager</th><th className="right">Ein/Aus</th><th className="right">Leistungen</th><th className="right">Gesamt</th></tr></thead>
            <tbody>
              {[...o.months].reverse().map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="num right">{m.occupied}</td>
                  <td className="num right">{formatEuro(m.storage)}</td>
                  <td className="num right">{formatEuro(m.fees)}</td>
                  <td className="num right">{formatEuro(m.services)}</td>
                  <td className="num right"><strong>{formatEuro(m.revenue)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}
