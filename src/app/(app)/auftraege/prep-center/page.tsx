import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { monthTitle, shiftMonth } from "@/lib/calendar/month";
import { formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { parseMonthParam, prepSummary, type PrepRow } from "@/lib/shipping/prep";
import { prepMonthRows, unassignedMonthRows } from "@/lib/shipping/prep-service";
import { assignShipperAction } from "./actions";

// Monatsübersicht: was hat das Prep Center für mich verschickt (Sendungen, Stück, Versandarten) – zum Abgleich mit
// seiner Rechnung. Die Labels kommen aus dem System; festgehalten wird je Auftrag, wer verschickt hat.
export default async function PrepCenterPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const session = await requireArea("wawi");
  const sp = await searchParams;
  const month = parseMonthParam(sp.monat, todayIso());
  const [settings, rows, open] = await Promise.all([getSettings(session.tenantId), prepMonthRows(session.tenantId, month), unassignedMonthRows(session.tenantId, month)]);
  const name = settings.prep.name || "Prep Center";
  const sum = prepSummary(rows, settings.prep);
  const table = (list: PrepRow[], assign: boolean) => (
    <table className="table">
      <thead><tr><th>Datum</th><th>Bestellung</th><th>Empfänger</th><th className="right">Stück</th><th>Artikel</th><th>Versandart</th>{assign && <th>Wer hat verschickt?</th>}</tr></thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.orderId} data-testid={assign ? "prep-open-row" : "prep-row"}>
            <td className="num">{r.day.split("-").reverse().join(".")}</td>
            <td className="num"><Link href={`/auftraege/${r.orderId}`}>{r.externalId}</Link><div className="small muted">{r.channel}</div></td>
            <td>{r.name}<div className="small muted">{r.place}</div></td>
            <td className="num right">{r.units}</td>
            <td className="small" style={{ maxWidth: 320 }}>{r.items}</td>
            <td>{r.product}{r.tracking && <div className="small muted num">{r.tracking}</div>}</td>
            {assign && (
              <td>
                <form action={assignShipperAction} style={{ display: "flex", gap: 4 }}>
                  <input type="hidden" name="orderId" value={r.orderId} />
                  <button className="btn btn-small" name="shipper" value="self" type="submit">ich</button>
                  <button className="btn btn-small" name="shipper" value="prep" type="submit">{name}</button>
                </form>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/auftraege">Aufträge & Versand</Link></div><h1>{name}: Versand je Monat</h1></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link className="btn" href={`/auftraege/prep-center?monat=${shiftMonth(month, -1)}`} aria-label="Voriger Monat">‹</Link>
          <strong data-testid="prep-month">{monthTitle(month)}</strong>
          <Link className="btn" href={`/auftraege/prep-center?monat=${shiftMonth(month, 1)}`} aria-label="Nächster Monat">›</Link>
        </div>
      </div>

      <div className="grid-kpi" data-testid="prep-kpis">
        <div className="card card-pad"><div className="kpi-label">Sendungen</div><div className="kpi-value">{sum.shipments}</div></div>
        <div className="card card-pad"><div className="kpi-label">Stück verschickt</div><div className="kpi-value">{sum.units}</div></div>
        <div className="card card-pad"><div className="kpi-label">Versandarten</div><div className="small" style={{ marginTop: 6 }}>{sum.byProduct.length ? sum.byProduct.map((b) => <div key={b.product}>{b.product}: {b.shipments} ({b.units} Stück)</div>) : "–"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Erwartet laut Gebühren</div><div className="kpi-value">{sum.expected !== null ? formatEuro(sum.expected) : "–"}</div>{sum.expected === null && <div className="small muted">Gebühren unter <Link href="/einstellungen#prep">Einstellungen → Prep Center</Link> eintragen</div>}{sum.expected !== null && <div className="small muted">{formatEuro(settings.prep.feeShipment)} je Sendung + {formatEuro(settings.prep.feeExtraItem)} je weiteres Stück</div>}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn btn-primary" href={`/auftraege/prep-center/csv?monat=${month}`} data-testid="prep-csv">Liste als CSV (Excel) herunterladen</a>
        <span className="small muted">Eine Zeile je Sendung – zum Abhaken gegen die Rechnung. Gezählt wird nach Versanddatum (sonst Tag des Labels).</span>
      </div>

      {open.length > 0 && (
        <section className="card" style={{ overflow: "auto" }} data-testid="prep-open">
          <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2>{open.length} Sendung{open.length === 1 ? "" : "en"} im {monthTitle(month)} ohne Zuordnung</h2>
            <form action={assignShipperAction} style={{ display: "flex", gap: 6 }}>
              {open.map((r) => <input key={r.orderId} type="hidden" name="orderId" value={r.orderId} />)}
              <button className="btn btn-small" name="shipper" value="self" type="submit">alle: ich</button>
              <button className="btn btn-small" name="shipper" value="prep" type="submit" data-testid="prep-assign-all">alle: {name}</button>
            </form>
          </div>
          <div className="small muted" style={{ padding: "0 14px 8px" }}>Vor dem Abgleich zuordnen – sonst fehlen sie in der Zählung. Ab jetzt wird beim Erstellen der Labels festgehalten, wer verschickt.</div>
          {table(open, true)}
        </section>
      )}

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Von {name} verschickt</h2><span className="small muted">{sum.shipments} Sendungen · {sum.units} Stück</span></div>
        {rows.length === 0 ? <div className="card-pad muted">In diesem Monat keine Sendungen über {name}.</div> : table(rows, false)}
      </section>
    </>
  );
}
