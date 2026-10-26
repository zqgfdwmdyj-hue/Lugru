import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireLogin } from "@/lib/auth";
import { formatDate, formatEuro } from "@/lib/numbers";

const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter"] as const;
const season = sql`case when extract(month from e.event_date) in (3,4,5) then 'Frühling' when extract(month from e.event_date) in (6,7,8) then 'Sommer' when extract(month from e.event_date) in (9,10,11) then 'Herbst' else 'Winter' end`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "–");

type ProductStat = { id: string; name: string; variant: string | null; category: string; image_file_id: string | null; times: number; rated: number; weg: number; wenig: number; viel: number; last: string };
type CatSeason = { category: string; season: string; times: number; rated: number; weg: number };

/**
 * Was ist gut gegangen? Grundlage ist „Wie lief es?“ je Produkt nach der Verteilung (alles weg / wenig übrig /
 * viel übrig) – dazu, wie oft ein Produkt dabei war, nach Kategorie und Jahreszeit.
 */
export default async function StatistikPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  await requireLogin();
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.jahr ?? "") ? Number(sp.jahr) : null;
  const inYear = year ? sql`extract(year from e.event_date) = ${year}` : sql`true`;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const past = sql`e.event_date <= ${today}`;

  const [years, totals, products, cats] = await Promise.all([
    db.execute<{ y: number }>(sql`select distinct extract(year from event_date)::int as y from events order by y desc`),
    db.execute<{ events: number; items: number; rated: number; weg: number; value: number | null }>(sql`
      select count(distinct e.id)::int as events, count(i.id)::int as items,
             count(i.outcome)::int as rated, count(*) filter (where i.outcome = 'weg')::int as weg,
             sum(i.price * coalesce(i.quantity, 0))::float as value
        from events e left join event_items i on i.event_id = e.id
       where ${inYear} and ${past}`),
    db.execute<ProductStat>(sql`
      select p.id, p.name, p.variant, p.category, p.image_file_id, count(*)::int as times,
             count(i.outcome)::int as rated,
             count(*) filter (where i.outcome = 'weg')::int as weg,
             count(*) filter (where i.outcome = 'wenig')::int as wenig,
             count(*) filter (where i.outcome = 'viel')::int as viel,
             max(e.event_date)::text as last
        from event_items i join events e on e.id = i.event_id join products p on p.id = i.product_id
       where ${inYear} and ${past}
       group by p.id`),
    db.execute<CatSeason>(sql`
      select p.category, ${season} as season, count(*)::int as times, count(i.outcome)::int as rated,
             count(*) filter (where i.outcome = 'weg')::int as weg
        from event_items i join events e on e.id = i.event_id join products p on p.id = i.product_id
       where ${inYear} and ${past}
       group by 1, 2`),
  ]);
  const t = totals.rows[0] ?? { events: 0, items: 0, rated: 0, weg: 0, value: 0 };
  const rated = products.rows.filter((p) => p.rated > 0);
  const hits = [...rated].sort((a, b) => b.weg / b.rated - a.weg / a.rated || b.rated - a.rated).filter((p) => p.weg > 0).slice(0, 15);
  const flops = [...rated].filter((p) => p.viel > 0).sort((a, b) => b.viel / b.rated - a.viel / a.rated || b.rated - a.rated).slice(0, 10);
  const frequent = [...products.rows].sort((a, b) => b.times - a.times).slice(0, 15);
  const categories = [...new Set(cats.rows.map((c) => c.category))].sort((a, b) => a.localeCompare(b, "de"));
  const cell = (c: string, s: string) => cats.rows.find((r) => r.category === c && r.season === s);

  const Row = ({ p, right }: { p: ProductStat; right: string }) => (
    <Link href={`/produkte/${p.id}`} className="stat-row">
      {p.image_file_id ? <img src={`/datei/${p.image_file_id}?w=200`} alt="" className="thumb thumb-sm" loading="lazy" /> : <span className="thumb thumb-sm" />}
      <span className="wrap-anywhere"><strong>{p.name}</strong>{p.variant ? <span className="muted"> · {p.variant}</span> : null}<span className="small muted" style={{ display: "block" }}>{p.category} · zuletzt {formatDate(p.last)}</span></span>
      <span className="small" style={{ textAlign: "right" }}>{right}</span>
    </Link>
  );

  return (
    <>
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="page-head">
        <div><h1>Statistik</h1><div className="small muted">Was gut ging – nach Produkt, Kategorie und Jahreszeit</div></div>
        <div className="summary-chips">
          <Link href="/statistik" className={`chip${!year ? " active" : ""}`}>Alle Jahre</Link>
          {years.rows.map((y) => <Link key={y.y} href={`/statistik?jahr=${y.y}`} className={`chip${year === y.y ? " active" : ""}`}>{y.y}</Link>)}
        </div>
      </div>

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Verteilungen</div><div className="kpi-value">{t.events}</div></div>
        <div className="card card-pad"><div className="kpi-label">Produkte angeboten</div><div className="kpi-value">{t.items}</div></div>
        <div className="card card-pad"><div className="kpi-label">„Alles weg“</div><div className="kpi-value">{pct(t.weg, t.rated)}</div><div className="small muted">von {t.rated} mit erfasstem Ergebnis</div></div>
        <div className="card card-pad"><div className="kpi-label">Warenwert*</div><div className="kpi-value">{t.value ? formatEuro(t.value) : "–"}</div><div className="small muted">* nur mit eingetragener Menge</div></div>
      </div>

      {t.rated === 0 && (
        <div className="notice notice-info">
          Noch keine Ergebnisse erfasst. Nach einer Verteilung in der Produktliste bei „Wie lief es?“ eintragen – oder mehrere Produkte auswählen und „Ergebnis: alles weg / wenig übrig / viel übrig“ setzen. Bis dahin zeigt die Statistik, wie oft etwas dabei war.
        </div>
      )}

      <div className="stat-grid">
        <section className="card">
          <div className="card-head"><h2>Renner – oft alles weg</h2></div>
          {hits.length === 0 ? <div className="card-pad small muted">Noch keine Daten.</div> : hits.map((p) => <Row key={p.id} p={p} right={`${p.weg} von ${p.rated}× alles weg`} />)}
        </section>
        <section className="card">
          <div className="card-head"><h2>Ladenhüter – viel übrig</h2></div>
          {flops.length === 0 ? <div className="card-pad small muted">Noch keine Daten.</div> : flops.map((p) => <Row key={p.id} p={p} right={`${p.viel} von ${p.rated}× viel übrig`} />)}
        </section>
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Kategorien nach Jahreszeit</h2><span className="small muted">wie oft dabei · Anteil „alles weg“</span></div>
        <table className="table">
          <thead><tr><th>Kategorie</th>{SEASONS.map((s) => <th key={s} className="right">{s}</th>)}</tr></thead>
          <tbody>
            {categories.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Verteilungen.</td></tr>}
            {categories.map((c) => (
              <tr key={c}>
                <td>{c}</td>
                {SEASONS.map((s) => {
                  const x = cell(c, s);
                  return <td key={s} className="right num">{x ? <>{x.times}×{x.rated ? <span className="muted"> · {pct(x.weg, x.rated)}</span> : null}</> : <span className="muted">–</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head"><h2>Am häufigsten dabei</h2></div>
        {frequent.length === 0 ? <div className="card-pad small muted">Noch keine Daten.</div> : frequent.map((p) => <Row key={p.id} p={p} right={`${p.times}× dabei${p.rated ? ` · ${pct(p.weg, p.rated)} alles weg` : ""}`} />)}
      </section>
    </>
  );
}
