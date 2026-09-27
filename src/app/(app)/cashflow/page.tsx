import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { buildWeeks, projectPayouts } from "@/lib/money/cashflow";
import { formatDate, formatEuro } from "@/lib/numbers";
import { addCashItem, deleteCashItem, saveStartBalance } from "./actions";

const IN = "#0f8a79";
const OUT = "#d9480f";

export default async function CashflowPage() {
  const session = await requireSession();
  const t = session.tenantId;
  const today = todayIso();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t));
  const [settlements, items, claims, expenses] = await Promise.all([
    db.select().from(schema.amazonSettlements).where(and(eq(schema.amazonSettlements.tenantId, t), isNotNull(schema.amazonSettlements.depositDate))).orderBy(desc(schema.amazonSettlements.depositDate)).limit(12),
    db.select().from(schema.cashItems).where(eq(schema.cashItems.tenantId, t)).orderBy(asc(schema.cashItems.date)),
    db.select({ status: schema.claims.status, sum: sql<number>`coalesce(sum(${schema.claims.expectedAmount}), 0)::float` }).from(schema.claims).where(and(eq(schema.claims.tenantId, t), inArray(schema.claims.status, ["detected", "queued", "submitted"]))).groupBy(schema.claims.status),
    db
      .select({ source: schema.invoices.sourceKey, months: sql<number>`count(distinct date_trunc('month', ${schema.invoices.invoiceDate}))::int`, avg: sql<number>`(sum(${schema.invoices.totalGross}) / greatest(count(distinct date_trunc('month', ${schema.invoices.invoiceDate})), 1))::float` })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.tenantId, t), eq(schema.invoices.kind, "expense"), gte(schema.invoices.invoiceDate, addDaysIso(today, -120))))
      .groupBy(schema.invoices.sourceKey)
      .having(sql`count(distinct date_trunc('month', ${schema.invoices.invoiceDate})) >= 2`),
  ]);
  const history = settlements.filter((s) => s.totalAmount !== null).map((s) => ({ date: s.depositDate!.toISOString().slice(0, 10), amount: s.totalAmount! }));
  const payouts = projectPayouts(history, today, addDaysIso(today, 8 * 7));
  const weeks = buildWeeks({ today, weeks: 8, items: items.map((i) => ({ ...i, recurrence: i.recurrence })), payouts });
  const start = tenant.settings.cash?.startBalance ?? null;
  let balance = start ?? 0;
  const rows = weeks.map((w) => {
    balance += w.inflow - w.outflow;
    return { ...w, balance };
  });
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.inflow, w.outflow)));
  const claimSum = claims.reduce((n, c) => n + c.sum, 0);
  const planned = new Set(items.map((i) => i.description.toLowerCase()));

  const W = 760, H = 220, pad = 36, bw = (W - pad * 2) / weeks.length;
  const y = (v: number) => H - 28 - (v / max) * (H - 50);

  return (
    <>
      <div className="page-head"><div><div className="crumb">Geld</div><h1>Cash Flow</h1></div></div>
      <div className="grid-kpi">
        <div className="card card-pad">
          <div className="kpi-label">Kontostand (Start)</div>
          <form action={saveStartBalance} style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <label htmlFor="bal" className="sr-only">Kontostand</label>
            <input className="input num" id="bal" name="balance" defaultValue={start !== null ? String(start).replace(".", ",") : ""} placeholder="z. B. 12.500" />
            <button className="btn btn-small" type="submit">OK</button>
          </form>
          <div className="small muted" style={{ marginTop: 4 }}>{tenant.settings.cash?.asOf ? `Stand ${formatDate(tenant.settings.cash.asOf)}` : "noch nicht gesetzt"}</div>
        </div>
        <div className="card card-pad"><div className="kpi-label">In 8 Wochen (Plan)</div><div className="kpi-value" style={{ color: rows.at(-1)!.balance < 0 ? "var(--danger)" : undefined }}>{formatEuro(rows.at(-1)!.balance)}</div><div className="small muted">{start === null ? "ohne Startwert" : "inkl. Startwert"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Nächste Auszahlung (geschätzt)</div><div className="kpi-value">{payouts[0] ? formatEuro(payouts[0].amount) : "–"}</div><div className="small muted">{payouts[0] ? formatDate(payouts[0].date) : "Settlement-Reports importieren"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Offene Ansprüche (Potenzial)</div><div className="kpi-value">{formatEuro(claimSum)}</div><div className="small muted">nicht im Plan enthalten</div></div>
      </div>

      <section className="card card-pad">
        <div className="between" style={{ marginBottom: 8 }}>
          <h2>Nächste 8 Wochen</h2>
          <div style={{ display: "flex", gap: 14, fontSize: 12 }} className="muted">
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: IN }} />Eingänge</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: OUT }} />Ausgänge</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img" aria-label="Ein- und Ausgänge je Woche">
          <line x1={pad} x2={W - pad} y1={H - 28} y2={H - 28} stroke="#d5d2ca" />
          {rows.map((w, i) => {
            const x = pad + i * bw + bw * 0.18;
            const bar = (bw * 0.64 - 2) / 2;
            return (
              <g key={w.start}>
                <rect x={x} y={y(w.inflow)} width={bar} height={H - 28 - y(w.inflow)} rx={4} fill={IN}><title>{`Woche ab ${formatDate(w.start)}: Eingänge ${formatEuro(w.inflow)}`}</title></rect>
                <rect x={x + bar + 2} y={y(w.outflow)} width={bar} height={H - 28 - y(w.outflow)} rx={4} fill={OUT}><title>{`Woche ab ${formatDate(w.start)}: Ausgänge ${formatEuro(w.outflow)}`}</title></rect>
                <text x={x + bar} y={H - 10} textAnchor="middle" fontSize="11" fill="#5b6168">{formatDate(w.start).slice(0, 6)}</text>
              </g>
            );
          })}
        </svg>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>Woche ab</th><th className="right">Eingänge</th><th className="right">Ausgänge</th><th className="right">Saldo danach</th><th>Posten</th></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.start}>
                <td className="num">{formatDate(w.start)}</td>
                <td className="num right">{formatEuro(w.inflow)}</td>
                <td className="num right">{formatEuro(-w.outflow)}</td>
                <td className="num right" style={{ fontWeight: 600, color: w.balance < 0 ? "var(--danger)" : undefined }}>{formatEuro(w.balance)}</td>
                <td className="small muted">{w.entries.map((e) => `${e.label} ${formatEuro(e.amount)}`).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <div className="card-head"><h2>Geplante Posten</h2></div>
          <form action={addCashItem} style={{ display: "flex", gap: 8, padding: 14, flexWrap: "wrap", alignItems: "end", borderBottom: "1px solid var(--border)" }}>
            <div className="field"><label className="label" htmlFor="c-dir">Art</label><select className="select" id="c-dir" name="direction"><option value="out">Ausgabe</option><option value="in">Einnahme</option></select></div>
            <div className="field"><label className="label" htmlFor="c-date">Datum</label><input className="input" id="c-date" name="date" type="date" required /></div>
            <div className="field"><label className="label" htmlFor="c-amount">Betrag €</label><input className="input num" id="c-amount" name="amount" required style={{ width: 110 }} /></div>
            <div className="field" style={{ flexGrow: 1 }}><label className="label" htmlFor="c-desc">Beschreibung</label><input className="input" id="c-desc" name="description" required placeholder="z. B. Großeinkauf Q4" /></div>
            <div className="field"><label className="label" htmlFor="c-cat">Kategorie</label><select className="select" id="c-cat" name="category"><option value="einkauf">Einkauf</option><option value="fixkosten">Fixkosten</option><option value="steuern">Steuern</option><option value="sonstiges">Sonstiges</option></select></div>
            <div className="field"><label className="label" htmlFor="c-rec">Wiederholung</label><select className="select" id="c-rec" name="recurrence"><option value="none">einmalig</option><option value="monthly">monatlich</option><option value="weekly">wöchentlich</option></select></div>
            <button className="btn btn-primary" type="submit">Hinzufügen</button>
          </form>
          <table className="table">
            <tbody>
              {items.length === 0 && <tr><td className="muted">Noch keine Posten.</td></tr>}
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="num">{formatDate(i.date)}</td>
                  <td>{i.description}<div className="small muted">{i.category}{i.recurrence !== "none" ? ` · ${i.recurrence === "monthly" ? "monatlich" : "wöchentlich"}` : ""}</div></td>
                  <td className="num right" style={{ color: i.amount < 0 ? "var(--danger)" : "var(--ok)" }}>{formatEuro(i.amount)}</td>
                  <td className="right"><form action={deleteCashItem}><input type="hidden" name="id" value={i.id} /><button className="btn-link small" type="submit">löschen</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Letzte Auszahlungen</h2>
            {history.length === 0 && <div className="small muted">Keine – Settlement-Reports importieren.</div>}
            {history.slice(0, 8).map((h) => <div key={h.date} className="between small"><span className="num">{formatDate(h.date)}</span><span className="num">{formatEuro(h.amount)}</span></div>)}
          </section>
          <section className="card card-pad stack">
            <h2>Wiederkehrende Kosten (aus Rechnungen)</h2>
            {expenses.length === 0 && <div className="small muted">Noch keine erkannt.</div>}
            {expenses.map((e) => (
              <form key={e.source} action={addCashItem} className="between small">
                <input type="hidden" name="direction" value="out" />
                <input type="hidden" name="date" value={addDaysIso(today, 7)} />
                <input type="hidden" name="amount" value={e.avg.toFixed(2).replace(".", ",")} />
                <input type="hidden" name="description" value={e.source ?? "Kosten"} />
                <input type="hidden" name="category" value="fixkosten" />
                <input type="hidden" name="recurrence" value="monthly" />
                <span>{e.source} · Ø {formatEuro(e.avg)}/Monat</span>
                {planned.has((e.source ?? "").toLowerCase()) ? <span className="muted">geplant</span> : <button className="btn-link" type="submit">übernehmen</button>}
              </form>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
