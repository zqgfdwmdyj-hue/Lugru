import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { CHANNEL_LABEL } from "@/lib/labels";
import { availableOf } from "@/lib/stock/channel-logic";
import { listingsBySku, stockLevels } from "@/lib/stock/channel-sync";
import { createCount, setOwnStock } from "./actions";
import { Kpi } from "@/components/kpi";
import { skuCostMap } from "@/lib/money/costs";
import { COST_SOURCE_LABEL, stockValue } from "@/lib/money/profit-logic";
import { fbaReport } from "@/lib/stock/fba-report";
import { breakdownText, fbaBreakdown, STOCK_TERMS } from "@/lib/stock/breakdown";

const VIEWS = { alle: "Alle", fba: "FBA", eigen: "Eigenes Lager", unverkaeuflich: "Nicht verkaufbar", ladenhueter: "Ladenhüter", "ohne-ek": "Ohne EK (unbewertet)", negativ: "Negativer Bestand" } as const;
type View = keyof typeof VIEWS;
const ROW_LIMIT = 5000;

async function loadSetRows(tenantId: string) {
  const S = schema.stockSets;
  return db.select({ sku: S.sku, title: S.title, components: S.components }).from(S).where(eq(S.tenantId, tenantId)).orderBy(S.sku).then((r) => r.map((x) => ({ ...x, components: x.components ?? [] })));
}

type Row = { sku: string; title: string | null; image: string | null; asin: string | null; fba: number; inReport: boolean; unsellable: number; reserved: number; inbound: number; own: number; location: string | null; cost: number | null; lastSale: string | null; since: string | null };

export default async function BestandPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; q?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "alle";
  const t = session.tenantId;
  const settings = await getSettings(t);
  // Nur SKUs mit Bestand (Amazon oder eigenes Lager) – früher kamen alle Amazon-SKUs (auch mit 0) in die Liste,
  // nach Warenwert sortiert und bei 2.000 abgeschnitten: eigenes Lager ohne EK fiel dann heraus und die Kennzahl
  // „Eigenes Lager“ zeigte 0, obwohl die Listings (gleiche Quelle own_stock) Bestand zeigten. Bei Suche alle SKUs.
  const res = await db.execute<Row>(sql`
    with skus as (
      select sku from amazon_inventory
       where tenant_id = ${t}
         and (${sp.q ? sql`true` : sql`false`}
              or coalesce(fulfillable, 0) + coalesce(reserved, 0) + coalesce(unsellable, 0) + coalesce(inbound_working, 0) + coalesce(inbound_shipped, 0) + coalesce(inbound_receiving, 0) <> 0)
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
           -- Name/Bild: Produkt, FBA-Bericht, sonst eindeutig über die SKU aus den Kanal-Angeboten
           coalesce(p.title, ai.title, (select li.title from listings li where li.tenant_id = ${t} and (li.sku = s.sku or li.stock_sku = s.sku) order by (li.status = 'active') desc, li.updated_at desc limit 1)) as title,
           (select coalesce(li.payload->'imageUrls'->>0, li.payload->>'image') from listings li where li.tenant_id = ${t} and (li.sku = s.sku or li.stock_sku = s.sku) and (li.payload ? 'imageUrls' or li.payload ? 'image') order by (li.status = 'active') desc limit 1) as image,
           coalesce(p.asin, ai.asin) as asin,
           coalesce(ai.fulfillable, 0) as fba,
           (ai.sku is not null) as "inReport",
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
     order by coalesce(ai.fulfillable, 0) + coalesce(ai.reserved, 0) + abs(coalesce(os.quantity, 0)) desc, s.sku
     limit ${ROW_LIMIT}`);
  const truncated = res.rows.length >= ROW_LIMIT;
  const noSaleBefore = addDaysIso(todayIso(), -settings.aging.noSaleWarnDays);
  const costs = await skuCostMap(t);
  // EK aus der gemeinsamen Quelle (Charge → EK je SKU → eBay-Tool).
  for (const r of res.rows) r.cost = costs.get(r.sku)?.cost ?? null;
  // Wertvollstes zuerst – erst nach dem EK aus der gemeinsamen Quelle (ohne EK nach Stückzahl).
  const valueOf = (r: Row) => (r.fba + r.reserved + r.inbound + Math.max(0, r.own)) * (r.cost ?? 0);
  res.rows.sort((a, b) => valueOf(b) - valueOf(a) || b.fba + b.own - (a.fba + a.own));
  const sv = stockValue(res.rows.map((r) => ({ sku: r.sku, units: r.fba + r.reserved + r.inbound, own: r.own })), costs);
  const [inv] = await db.select({ snap: sql<string | null>`max(${schema.amazonInventory.snapshotDate})::text` }).from(schema.amazonInventory).where(eq(schema.amazonInventory.tenantId, t));
  // FBA-Spalte: Bericht fehlt (unbekannt) ≠ nicht im Bericht ≠ im Bericht mit 0; veralteter Bericht gekennzeichnet.
  const fr = await fbaReport(t);
  const fbaCell = (r: Row) =>
    fr.missing ? (
      <span className="muted" title="Kein FBA-Bestandsbericht – Bestand bei Amazon unbekannt" data-testid="fba-cell" data-state="unbekannt">?</span>
    ) : !r.inReport ? (
      <span className="muted" title="Nicht im FBA-Bestandsbericht – keine Ware bei Amazon gemeldet" data-testid="fba-cell" data-state="nicht-im-bericht">–</span>
    ) : (
      <span style={fr.stale ? { color: "var(--warn)" } : undefined} title={fr.stale ? `Stand ${formatDate(fr.snapshot)} – veraltet` : fr.source === "sellerboard" ? `laut sellerboard, Stand ${formatDate(fr.snapshot)}` : `laut Bericht vom ${formatDate(fr.snapshot)}`} data-testid="fba-cell" data-state={fr.stale ? "veraltet" : r.fba === 0 ? "bestaetigt-0" : "aktuell"}>
        {r.fba}
      </span>
    );
  let rows = res.rows;
  if (view === "fba") rows = rows.filter((r) => r.fba + r.inbound + r.reserved > 0);
  if (view === "eigen") rows = rows.filter((r) => r.own !== 0);
  if (view === "unverkaeuflich") rows = rows.filter((r) => r.unsellable > 0);
  if (view === "ladenhueter") rows = rows.filter((r) => r.fba + r.own > 0 && (!r.lastSale || r.lastSale < noSaleBefore));
  if (view === "ohne-ek") rows = rows.filter((r) => r.cost === null && r.fba + r.reserved + r.inbound + Math.max(0, r.own) > 0);
  if (view === "negativ") rows = rows.filter((r) => r.own < 0);
  const amazon = fbaBreakdown(res.rows.map((r) => ({ fulfillable: r.fba, reserved: r.reserved, inboundShipped: r.inbound, unsellable: r.unsellable })));
  // Kennzahl direkt aus der gemeinsamen Quelle (own_stock) – nie aus einer gekürzten Liste.
  const [ownAgg] = await db.select({ units: sql<number>`coalesce(sum(${schema.ownStock.quantity}), 0)::int`, skus: sql<number>`count(*) filter (where ${schema.ownStock.quantity} <> 0)::int` }).from(schema.ownStock).where(eq(schema.ownStock.tenantId, t));
  const own = ownAgg?.units ?? 0;
  const [levels, sets] = await Promise.all([stockLevels(t), loadSetRows(t)]);
  const channelRows = await listingsBySku(t, rows.slice(0, 500).filter((r) => r.own !== 0 || levels.has(r.sku)).map((r) => r.sku));
  const reservedTotal = [...levels.values()].reduce((n, l) => n + l.reserved, 0);
  const counts = await db.select().from(schema.inventoryCounts).where(eq(schema.inventoryCounts.tenantId, t)).orderBy(desc(schema.inventoryCounts.createdAt)).limit(5);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Bestand & Inventur</h1></div>
        <form action="/bestand" style={{ width: 340 }}><input type="hidden" name="ansicht" value={view} /><label htmlFor="bq" className="sr-only">Suche</label><input className="input" id="bq" name="q" defaultValue={sp.q} placeholder="SKU, ASIN, Titel" /></form>
      </div>
      <div className="grid-kpi">
        <Kpi
          testid="kpi-stock-value"
          label="Warenwert (EK, bewertet)"
          value={formatEuro(sv.valued)}
          state={sv.unvaluedUnits || sv.negative.length || !inv?.snap ? "unvollstaendig" : "ok"}
          note={`${sv.valuedUnits} Einheiten mit EK`}
          missing={[
            ...(sv.unvaluedUnits ? [`EK für ${sv.unvaluedUnits} Einheiten (${sv.unvaluedSkus.length} SKU${sv.unvaluedSkus.length === 1 ? "" : "s"}) – nicht bewertet`] : []),
            ...(!inv?.snap ? ["FBA-Bestandsbericht – Ware bei Amazon ist nicht enthalten"] : []),
          ]}
          fixHref="/bestand?ansicht=ohne-ek"
          fixLabel="ansehen"
          source={`${fr.source === "sellerboard" ? "sellerboard-Bestand" : "FBA-Bestandsbericht"}, eigenes Lager, gültiger EK`}
          stand={inv?.snap ? formatDate(inv.snap) : undefined}
        />
        <div className="card card-pad" data-testid="kpi-fba">
          <div className="kpi-label" title={STOCK_TERMS.gesamt.hint}>Bei Amazon – {STOCK_TERMS.gesamt.label}</div>
          {inv?.snap ? (
            <>
              <div className="kpi-value" data-testid="fba-total">{amazon.gesamt}</div>
              <div className="small" data-testid="fba-breakdown">{breakdownText(amazon)}</div>
              <div className="small muted">laut {fr.source === "sellerboard" ? "sellerboard" : "Bestandsbericht"}, Stand {formatDate(inv.snap)}</div>
            </>
          ) : (
            <><div className="kpi-value muted" style={{ fontSize: 18 }}>unbekannt</div><Link className="small" href="/import" style={{ color: "var(--warn)" }}>FBA-Bestandsbericht fehlt – nicht „0“ →</Link></>
          )}
        </div>
        <div className="card card-pad" data-testid="kpi-own"><div className="kpi-label">Eigenes Lager</div><div className="kpi-value" data-testid="own-total">{own}</div><div className="small muted">{ownAgg?.skus ?? 0} SKU{ownAgg?.skus === 1 ? "" : "s"} · gleiche Quelle wie „Wawi verfügbar“ in den Listings</div>{reservedTotal > 0 && <div className="small muted">{reservedTotal} in offenen Aufträgen reserviert</div>}
          {sets.length > 0 && <a href="#sets" className="small" data-testid="own-sets">+ {sets.length} Set{sets.length === 1 ? "" : "s"} aus Bestandteilen (nicht doppelt gezählt) →</a>}
          {sv.negative.length > 0 && <Link href="/bestand?ansicht=negativ" className="small" style={{ color: "var(--danger)" }} data-testid="stock-negative">{sv.negative.length} SKU{sv.negative.length === 1 ? "" : "s"} mit negativem Bestand ({sv.negativeUnits}) – nicht im Warenwert verrechnet →</Link>}
        </div>
        <div className="card card-pad"><div className="kpi-label">Ladenhüter</div><div className="kpi-value">{res.rows.filter((r) => r.fba + r.own > 0 && (!r.lastSale || r.lastSale < noSaleBefore)).length}</div><div className="small muted">ohne Verkauf seit {settings.aging.noSaleWarnDays} Tagen</div></div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/bestand?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
      </div>
      {truncated && <div className="notice notice-warn small" data-testid="stock-truncated">Mehr als {ROW_LIMIT.toLocaleString("de-DE")} SKUs mit Bestand – die Liste zeigt die ersten. Für einzelne Artikel oben suchen. Die Kennzahlen zählen trotzdem alles.</div>}
      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <table className="table sticky-head">
            <thead><tr><th>SKU</th><th>Artikel</th><th className="right" data-testid="fba-head" title={STOCK_TERMS.verkaufbar.hint}>Verkaufbar{fr.missing ? <div className="small muted" style={{ fontWeight: 400 }}>Bericht fehlt</div> : fr.stale ? <div className="small" style={{ fontWeight: 400, color: "var(--warn)" }}>Stand {formatDate(fr.snapshot)}</div> : fr.source === "sellerboard" ? <div className="small muted" style={{ fontWeight: 400 }} data-testid="fba-source">sellerboard, {formatDate(fr.snapshot)}</div> : null}</th><th className="right" title={STOCK_TERMS.reserviert.hint}>Reserviert</th><th className="right" title={STOCK_TERMS.unterwegs.hint}>Unterwegs</th><th className="right" title={STOCK_TERMS.nichtVerkaufbar.hint}>Nicht verk.</th><th className="right">Eigenes Lager</th><th>Kanäle (Menge)</th><th className="right">Wert</th><th>Letzter Verkauf</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="muted">{fr.missing ? <>Keine Einträge – der FBA-Bestandsbericht fehlt, der Amazon-Bestand ist unbekannt. <Link href="/import">Bericht importieren</Link> oder eigenen Bestand eintragen.</> : "Keine Einträge in dieser Ansicht."}</td></tr>}
              {rows.slice(0, 500).map((r) => (
                <tr key={r.sku}>
                  <td className="num small">{r.sku}</td>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                      {r.image && <img src={r.image} alt="" width={32} height={32} style={{ objectFit: "contain", borderRadius: 4, flex: "none" }} loading="lazy" />}
                      <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title ?? undefined}>{r.title ?? r.asin ?? "– Name fehlt –"}</Link>
                    </div>
                  </td>
                  <td className="num right">{fbaCell(r)}</td>
                  <td className="num right">{r.reserved || ""}</td>
                  <td className="num right">{r.inbound || ""}</td>
                  <td className="num right" style={{ color: r.unsellable ? "var(--danger)" : undefined }}>{r.unsellable || ""}</td>
                  <td className="num right">
                    <span style={{ color: r.own < 0 ? "var(--danger)" : undefined, fontWeight: r.own < 0 ? 600 : undefined }}>{r.own || ""}</span>
                    {(levels.get(r.sku)?.reserved ?? 0) > 0 && (
                      <div className="small" style={{ color: (levels.get(r.sku)!.reserved > r.own) ? "var(--danger)" : "var(--muted)" }}>
                        {levels.get(r.sku)!.reserved} reserviert · {availableOf(levels.get(r.sku))} frei
                      </div>
                    )}
                    {r.location ? <div className="small muted">{r.location}</div> : null}
                  </td>
                  <td className="small" data-testid="stock-channels">
                    {(channelRows.get(r.sku) ?? []).filter((l) => l.status === "active").map((l) => (
                      <Link key={l.id} href={`/listings?kanal=${l.channel}`} className={`tag ${!l.stockSync ? "tag-neutral" : l.lastError ? "tag-warn" : "tag-ok"}`} style={{ marginRight: 4, textDecoration: "none" }} title={l.lastError ?? (l.stockSync ? "Menge wird abgeglichen" : "Abgleich aus")}>
                        {CHANNEL_LABEL[l.channel]} {l.stockSync ? (l.pushedQuantity ?? l.quantity) : "· Abgleich aus"}
                      </Link>
                    ))}
                  </td>
                  <td className="num right">{r.cost !== null ? <span title={`EK ${formatEuro(r.cost)} (${COST_SOURCE_LABEL[costs.get(r.sku)!.source]})`}>{formatEuro((r.fba + r.reserved + r.inbound + Math.max(0, r.own)) * r.cost)}</span> : <Link href={`/produkte/sku/${encodeURIComponent(r.sku)}?tab=einkauf`} className="tag tag-missing" title="EK fehlt – nicht bewertet">EK fehlt</Link>}</td>
                  <td className="num small" style={{ color: !r.lastSale || r.lastSale < noSaleBefore ? "var(--warn)" : undefined }}>{formatDate(r.lastSale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          {sets.length > 0 && (
            <section className="card card-pad stack" id="sets" data-testid="stock-sets">
              <h2>Sets aus Bestandteilen</h2>
              <p className="small muted" style={{ margin: 0 }}>Kein eigenes Lager: „Wawi verfügbar“ in den Listings ist, was sich aus den Bestandteilen bilden lässt.</p>
              {sets.slice(0, 50).map((x) => {
                const lvl = levels.get(x.sku);
                return (
                  <div key={x.sku} className="small" data-testid="stock-set">
                    <strong className="num">{x.sku}</strong>{x.title ? ` · ${x.title}` : ""}: <strong>{lvl ? availableOf(lvl) : "–"}</strong> bildbar
                    <div className="muted">{x.components.map((c) => { const cl = levels.get(c.sku); return `${c.qty}× ${c.sku} (${cl ? `${availableOf(cl)} frei` : "kein Lagereintrag"})`; }).join(" · ")}</div>
                  </div>
                );
              })}
            </section>
          )}
          <section className="card card-pad stack">
            <h2>Eigenes Lager buchen</h2>
            <form action={setOwnStock} className="stack" style={{ gap: 8 }}>
              <div className="field"><label className="label" htmlFor="os-sku">SKU</label><input className="input" id="os-sku" name="sku" required /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="os-q">Bestand neu</label><input className="input num" id="os-q" name="quantity" required style={{ width: 90 }} /></div>
                <div className="field"><label className="label" htmlFor="os-l">Lagerplatz</label><input className="input" id="os-l" name="location" /></div>
              </div>
              <div className="field"><label className="label" htmlFor="os-r">Grund</label><input className="input" id="os-r" name="reason" placeholder="Wareneingang, Korrektur …" /></div>
              <button className="btn btn-primary" type="submit">Speichern</button>
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
                <span>{c.name}</span><span className="muted">{c.status === "open" ? "offen" : `gebucht ${c.bookedAt?.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`}</span>
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
