import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { createCount, setOwnStock } from "./actions";

const VIEWS = { alle: "Alle", fba: "FBA", eigen: "Eigenes Lager", unverkaeuflich: "Unverkäuflich", ladenhueter: "Ladenhüter" } as const;
type View = keyof typeof VIEWS;

type Row = { sku: string; title: string | null; asin: string | null; fba: number; unsellable: number; reserved: number; inbound: number; own: number; location: string | null; cost: number | null; lastSale: string | null; since: string | null };

export default async function BestandPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; q?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "alle";
  const t = session.tenantId;
  const settings = await getSettings(t);
  const res = await db.execute<Row>(sql`
    with skus as (
      select sku from amazon_inventory where tenant_id = ${t}
      union select sku from own_stock where tenant_id = ${t}
    ),
    last_sale as (
      select sku, max(d) as d from (
        select sku, max(posted_date) as d from amazon_settlement_lines where tenant_id = ${t} and transaction_type = 'Order' and sku is not null group by sku
        union all
        select i.sku, max(o.order_date)::date from order_items i join orders o on o.id = i.order_id where o.tenant_id = ${t} and i.sku is not null group by i.sku
      ) x group by sku
    )
    select s.sku,
           coalesce(p.title, ai.title) as title,
           coalesce(p.asin, ai.asin) as asin,
           coalesce(ai.fulfillable, 0) as fba,
           coalesce(ai.unsellable, 0) as unsellable,
           coalesce(ai.reserved, 0) as reserved,
           coalesce(ai.inbound_working + ai.inbound_shipped + ai.inbound_receiving, 0) as inbound,
           coalesce(os.quantity, 0) as own,
           os.location,
           l.unit_cost_net::float as cost,
           ls.d::text as "lastSale",
           ai.unsellable_since::text as since
      from skus s
      left join amazon_inventory ai on ai.tenant_id = ${t} and ai.sku = s.sku
      left join own_stock os on os.tenant_id = ${t} and os.sku = s.sku
      left join lots l on l.tenant_id = ${t} and l.sku = s.sku
      left join products p on p.id = l.product_id
      left join last_sale ls on ls.sku = s.sku
     where ${sp.q ? sql`(s.sku ilike ${"%" + sp.q + "%"} or coalesce(p.asin, ai.asin) ilike ${"%" + sp.q + "%"} or coalesce(p.title, ai.title) ilike ${"%" + sp.q + "%"})` : sql`true`}
     order by (coalesce(ai.fulfillable,0) + coalesce(os.quantity,0)) * coalesce(l.unit_cost_net, 0) desc
     limit 2000`);
  const noSaleBefore = addDaysIso(todayIso(), -settings.aging.noSaleWarnDays);
  let rows = res.rows;
  if (view === "fba") rows = rows.filter((r) => r.fba + r.inbound + r.reserved > 0);
  if (view === "eigen") rows = rows.filter((r) => r.own !== 0);
  if (view === "unverkaeuflich") rows = rows.filter((r) => r.unsellable > 0);
  if (view === "ladenhueter") rows = rows.filter((r) => r.fba + r.own > 0 && (!r.lastSale || r.lastSale < noSaleBefore));
  const value = res.rows.reduce((n, r) => n + (r.fba + r.reserved + r.inbound + r.own) * (r.cost ?? 0), 0);
  const units = res.rows.reduce((n, r) => n + r.fba + r.reserved + r.inbound, 0);
  const own = res.rows.reduce((n, r) => n + r.own, 0);
  const counts = await db.select().from(schema.inventoryCounts).where(eq(schema.inventoryCounts.tenantId, t)).orderBy(desc(schema.inventoryCounts.createdAt)).limit(5);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Bestand & Inventur</h1></div>
        <form action="/bestand" style={{ width: 340 }}><input type="hidden" name="ansicht" value={view} /><label htmlFor="bq" className="sr-only">Suche</label><input className="input" id="bq" name="q" defaultValue={sp.q} placeholder="SKU, ASIN, Titel" /></form>
      </div>
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Warenwert (EK)</div><div className="kpi-value">{formatEuro(value)}</div></div>
        <div className="card card-pad"><div className="kpi-label">Bei Amazon</div><div className="kpi-value">{units}</div><div className="small muted">verfügbar, reserviert, unterwegs</div></div>
        <div className="card card-pad"><div className="kpi-label">Eigenes Lager</div><div className="kpi-value">{own}</div></div>
        <div className="card card-pad"><div className="kpi-label">Ladenhüter</div><div className="kpi-value">{res.rows.filter((r) => r.fba + r.own > 0 && (!r.lastSale || r.lastSale < noSaleBefore)).length}</div><div className="small muted">ohne Verkauf seit {settings.aging.noSaleWarnDays} Tagen</div></div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/bestand?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
      </div>
      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>SKU</th><th>Artikel</th><th className="right">FBA</th><th className="right">Unverk.</th><th className="right">Unterwegs</th><th className="right">Eigenes Lager</th><th className="right">Wert</th><th>Letzter Verkauf</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="muted">Keine Einträge. FBA-Bestandsbericht importieren oder eigenen Bestand eintragen.</td></tr>}
              {rows.slice(0, 500).map((r) => (
                <tr key={r.sku}>
                  <td className="num small">{r.sku}</td>
                  <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? r.asin ?? "–"}</td>
                  <td className="num right">{r.fba}</td>
                  <td className="num right" style={{ color: r.unsellable ? "var(--danger)" : undefined }}>{r.unsellable || ""}</td>
                  <td className="num right">{r.inbound || ""}</td>
                  <td className="num right">{r.own || ""}{r.location ? <div className="small muted">{r.location}</div> : null}</td>
                  <td className="num right">{r.cost !== null ? formatEuro((r.fba + r.reserved + r.inbound + r.own) * r.cost) : "–"}</td>
                  <td className="num small" style={{ color: !r.lastSale || r.lastSale < noSaleBefore ? "var(--warn)" : undefined }}>{formatDate(r.lastSale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Eigenes Lager buchen</h2>
            <form action={setOwnStock} className="stack" style={{ gap: 8 }}>
              <div className="field"><label className="label" htmlFor="os-sku">SKU</label><input className="input" id="os-sku" name="sku" required /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="os-q">Bestand neu</label><input className="input num" id="os-q" name="quantity" required style={{ width: 90 }} /></div>
                <div className="field"><label className="label" htmlFor="os-l">Lagerplatz</label><input className="input" id="os-l" name="location" /></div>
              </div>
              <div className="field"><label className="label" htmlFor="os-r">Grund</label><input className="input" id="os-r" name="reason" placeholder="Wareneingang, Korrektur …" /></div>
              <button className="btn" type="submit">Speichern</button>
            </form>
          </section>
          <section className="card card-pad stack">
            <h2>Inventur</h2>
            <form action={createCount} style={{ display: "flex", gap: 6 }}>
              <label htmlFor="cn" className="sr-only">Name</label>
              <input className="input" id="cn" name="name" placeholder="Name (optional)" />
              <button className="btn btn-primary" type="submit">Starten</button>
            </form>
            {counts.map((c) => (
              <Link key={c.id} href={`/bestand/inventur/${c.id}`} className="between small" style={{ textDecoration: "none" }}>
                <span>{c.name}</span><span className="muted">{c.status === "open" ? "offen" : `gebucht ${c.bookedAt?.toLocaleDateString("de-DE")}`}</span>
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
