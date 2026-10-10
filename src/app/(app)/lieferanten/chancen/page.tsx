import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OfferMarket } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { formatEuro, parseAmount } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import { keepaQueue, keepaStatus, marketTrend, offerHistory } from "@/lib/suppliers/feed-service";
import { econOf } from "@/lib/suppliers/offer-econ";
import { priceHint, priceStats, ROI_IMPLAUSIBLE } from "@/lib/suppliers/prices";
import { UNITS_SOURCE_LABEL } from "@/lib/suppliers/scan";
import { ago, Spark } from "@/components/spark";
import { manualBacklog, manualCheckStatus } from "@/lib/suppliers/manual-check";
import { SubmitButton } from "@/components/submit-button";
import { AutoRefresh } from "../finden/refresh";
import { QtyEdit } from "../qty-edit";
import { keepaRunAction, keepaScannedAction, packRefreshAction, pullAllAction } from "./actions";

type Row = {
  id: string; feed_id: string; feed_name: string; prices_gross: boolean; cost_pct: string | null; vat_pct: string | null;
  supplier_sku: string; ean: string | null; title: string | null; price: number | null; stock: number | null; moq: number | null; url: string | null;
  market: OfferMarket | null; first_seen_at: string | null; last_seen_at: string | null; scanned_at: string | null; amazon_qty: number | null; max30: number | null;
};

const SORTS = { roi: "ROI", gewinn: "Gewinn", verkaeufe: "Verkäufe", neu: "Neueste" } as const;

export default async function ChancenPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireArea("lieferanten");
  const sp = await searchParams;
  const t = session.tenantId;
  const minRoi = parseAmount(sp.roi) ?? 20;
  const minProfit = parseAmount(sp.gewinn) ?? 1;
  const minSales = parseAmount(sp.verk) ?? 0;
  const only = (sp.lf ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const nur = sp.nur === "gefallen" || sp.nur === "neu" || sp.nur === "pruefen" ? sp.nur : "";
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "roi") as keyof typeof SORTS;
  // Zwei getrennte Bereiche: Listen (Datei/Link, regelmäßiger Abgleich) und von Hand Gezogenes (Seller-Knopf).
  const manual = sp.quelle === "manuell";
  const origin = manual ? "scan" : "feed";
  const [s, feeds, queue] = await Promise.all([
    getSettings(t),
    db.select({ id: schema.supplierFeeds.id, name: schema.supplierFeeds.name, auto: schema.supplierFeeds.autoPull, err: schema.supplierFeeds.lastPullError, pulled: schema.supplierFeeds.lastPullAt }).from(schema.supplierFeeds).where(eq(schema.supplierFeeds.tenantId, t)).orderBy(asc(schema.supplierFeeds.name)),
    keepaQueue(t, 0),
  ]);
  const scanStats = (
    await db.execute<{ total: number; unchecked: number; last: string | null }>(sql`
      select count(*)::int as total, count(*) filter (where market is null)::int as unchecked, max(scanned_at)::text as last
        from supplier_offers where tenant_id = ${t} and origin = 'scan' and active`)
  ).rows[0];
  const mrun = manual ? manualCheckStatus(t) : null;
  const backlog = manual ? await manualBacklog(t) : null;
  const res = await db.execute<Row>(sql`
    with h as (
      select offer_id, max(price)::float as max30 from supplier_offer_history
       where tenant_id = ${t} and day >= current_date - 30 group by offer_id
    )
    select o.id, o.feed_id, f.name as feed_name, f.prices_gross, f.mapping->>'costPct' as cost_pct, f.mapping->>'vatPct' as vat_pct,
           o.supplier_sku, o.ean, o.title, o.price::float as price, o.stock, o.moq, o.url, o.market, o.first_seen_at::text, o.last_seen_at::text, o.scanned_at::text, o.amazon_qty, h.max30
      from supplier_offers o
      join supplier_feeds f on f.id = o.feed_id
      left join h on h.offer_id = o.id
     where o.tenant_id = ${t} and o.origin = ${origin} and o.active and o.price is not null and (o.stock is null or o.stock > 0)
       and (o.market->>'price') is not null
       ${only.length ? sql`and o.feed_id in (${sql.join(only.map((f) => sql`${f}`), sql`, `)})` : sql``}
     limit 30000`);

  // Je Produkt das günstigste Angebot (netto je Stück) – die anderen zählen als Alternativen.
  const best = new Map<string, { r: Row; e: ReturnType<typeof econOf>; alt: number }>();
  for (const r of res.rows) {
    const e = econOf({ price: r.price, title: r.title, url: r.url, market: r.market, pricesGross: r.prices_gross, costPct: Number(r.cost_pct || 0), vatPct: r.vat_pct ? Number(r.vat_pct) : null, amazonQty: r.amazon_qty }, s);
    if (e.unitNet === null) continue;
    const key = r.ean ?? r.market?.asin ?? r.id;
    const cur = best.get(key);
    if (!cur || e.unitNet < (cur.e.unitNet ?? Infinity)) best.set(key, { r, e, alt: (cur?.alt ?? -1) + 1 });
    else cur.alt++;
  }
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const matches = [...best.values()].filter(({ r, e }) => (e.roi ?? -1) >= minRoi && (e.profit ?? -1) >= minProfit && (r.market?.monthlySold ?? 0) >= minSales);
  // ROI über 500 % ist fast nie echt (Großpackung bei Amazon, anderes Produkt) – getrennt zum Prüfen.
  const odd = matches.filter(({ e }) => e.implausible);
  let list = nur === "pruefen" ? odd : matches.filter(({ e }) => !e.implausible);
  if (nur === "gefallen") list = list.filter(({ r }) => r.max30 !== null && r.price !== null && r.price <= r.max30 * 0.97);
  const seenAt = (r: Row) => (manual ? r.scanned_at : r.first_seen_at) ?? "";
  if (nur === "neu") list = list.filter(({ r }) => seenAt(r) && new Date(seenAt(r)).toISOString() >= weekAgo);
  list.sort((a, b) =>
    sort === "gewinn" ? (b.e.profit ?? 0) - (a.e.profit ?? 0) : sort === "verkaeufe" ? (b.r.market?.monthlySold ?? 0) - (a.r.market?.monthlySold ?? 0) : sort === "neu" ? new Date(seenAt(b.r) || 0).getTime() - new Date(seenAt(a.r) || 0).getTime() : (b.e.roi ?? 0) - (a.e.roi ?? 0),
  );
  const shown = list.slice(0, 200);
  // Treffer ohne Keepa-Packungsangaben (vor dem Update gespeichert) – lassen sich für 1 Token je ASIN nachladen.
  const packMissing = odd.filter(({ r }) => r.market?.asin && !(r.market && "items" in r.market)).map(({ r }) => r.id).slice(0, 300);
  const packAsins = new Set(odd.filter(({ r }) => packMissing.includes(r.id)).map(({ r }) => r.market!.asin)).size;
  const today = todayIso();
  const [hist, vk] = await Promise.all([offerHistory(t, shown.map((x) => x.r.id)), marketTrend(t, shown.map((x) => x.r.market?.asin).filter((a): a is string => !!a))]);
  const kst = keepaStatus(t);
  const qs = (patch: Record<string, string>) => `/lieferanten/chancen?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "meldung")) as Record<string, string>, ...patch })}`;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/lieferanten">Lieferanten</Link></div><h1>{manual ? "Chancen – manuell gezogen" : "Chancen aus den Lieferanten-Listen"}</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {manual ? (
            mrun?.running ? (
              <button className="btn btn-primary" type="button" disabled data-testid="keepa-scanned">Prüfung läuft …</button>
            ) : (
              <form action={keepaScannedAction}><SubmitButton label="Ungeprüfte jetzt prüfen" pendingLabel="Starte …" testId="keepa-scanned" /></form>
            )
          ) : (
            <>
              <form action={pullAllAction}><SubmitButton className="btn" label="Alle Listen jetzt abrufen" pendingLabel="Rufe Listen ab …" /></form>
              <form action={keepaRunAction}><SubmitButton label="Keepa jetzt abgleichen" pendingLabel="Gleiche ab … (kann dauern)" /></form>
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="chancen-tabs">
        <Link href={qs({ quelle: "", lf: "" })} className={`chip${!manual ? " active" : ""}`}>Listen (automatisch, alle 24 Std.)</Link>
        <Link href={qs({ quelle: "manuell", lf: "" })} className={`chip${manual ? " active" : ""}`}>Manuell gezogen (Seller-Knopf){scanStats.total ? ` · ${scanStats.total}` : ""}</Link>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="chancen-msg">{sp.meldung}</div>}
      <AutoRefresh active={Boolean(mrun?.running)} everyMs={3000} />
      {manual && (mrun || (backlog && backlog.total > 0)) && (
        <div className={`card card-pad stack small ${mrun?.paused ? "notice-warn" : ""}`} style={{ gap: 6 }} data-testid="manual-status">
          {mrun?.running ? (
            <>
              <div><strong>⏳ Prüfung läuft:</strong> {mrun.done} von {mrun.total} geprüft · {mrun.found} gefunden{mrun.byTitle ? ` (davon ${mrun.byTitle} per Titel)` : ""} · Keepa-Tokens: {mrun.tokensLeft ?? "–"}</div>
              <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${mrun.total ? Math.round((mrun.done / mrun.total) * 100) : 0}%`, height: "100%", background: "var(--accent)" }} /></div>
              <div className="muted">{mrun.note} Die Seite aktualisiert sich von selbst – du kannst sie auch verlassen.</div>
            </>
          ) : mrun ? (
            <div>
              <strong>{mrun.paused ? "⏸ Pausiert" : "✓ Letzte Prüfung"}</strong> {ago(mrun.finishedAt ?? mrun.startedAt)}: {mrun.done} von {mrun.total} geprüft, {mrun.found} gefunden{mrun.byTitle ? ` (${mrun.byTitle} per Titel – gegenprüfen)` : ""}. {mrun.note}
            </div>
          ) : null}
          {!mrun?.running && backlog && backlog.total > 0 && (
            <div className="muted">
              Noch {backlog.total} ungeprüft ({backlog.withEan} mit EAN à 1 Token, {backlog.withoutEan} ohne EAN per Titel à ca. 10) – braucht ca. {backlog.tokensNeeded.toLocaleString("de-DE")} Keepa-Tokens. „Ungeprüfte jetzt prüfen“ startet sofort; sonst macht der Takt stündlich mit den übrigen Tokens weiter.
            </div>
          )}
        </div>
      )}
      {manual ? (
        <div className="grid-kpi">
          <div className="card card-pad"><div className="kpi-label">Profitabel (Filter)</div><div className="kpi-value" data-testid="manual-profitable">{matches.length - odd.length}</div><div className="small muted">von {best.size} gezogenen Produkten mit Amazon-Daten{odd.length ? <> · <Link href={qs({ nur: "pruefen" })}>{odd.length} Menge prüfen</Link></> : null}</div></div>
          <div className="card card-pad"><div className="kpi-label">Noch ungeprüft</div><div className="kpi-value">{scanStats.unchecked}</div><div className="small muted">{backlog?.withoutEan ? `davon ${backlog.withoutEan} ohne EAN (Titelsuche)` : "einmalige Prüfung läuft nach jedem Ziehen"}</div></div>
          <div className="card card-pad"><div className="kpi-label">Zuletzt gezogen</div><div className="kpi-value" style={{ fontSize: 20 }}>{scanStats.last ? ago(scanStats.last) : "–"}</div><div className="small muted">{scanStats.total} Produkte von Hand gezogen</div></div>
          <div className="card card-pad small">Gezogenes wird <strong>einmal</strong> geprüft und nicht in den täglichen Abgleich der Listen gemischt. Ziehen: Lieferant öffnen → „Seite oder Liste scannen“ (Seller-Knopf/Lesezeichen, Link, Foto).</div>
        </div>
      ) : (
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Profitabel (Filter)</div><div className="kpi-value">{matches.length - odd.length}</div><div className="small muted">von {best.size} Produkten mit Amazon-Daten{odd.length ? <> · <Link href={qs({ nur: "pruefen" })}>{odd.length} Menge prüfen</Link></> : null}</div></div>
        <div className="card card-pad"><div className="kpi-label">Warten auf Keepa</div><div className="kpi-value">{queue.total}</div><div className="small muted">neue/geänderte zuerst · stündlich</div></div>
        <div className="card card-pad"><div className="kpi-label">Keepa-Tokens</div><div className="kpi-value">{kst?.tokensLeft ?? "–"}</div><div className="small muted">{kst ? ago(kst.at) : "noch kein Abgleich"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Listen automatisch</div><div className="kpi-value">{feeds.filter((f) => f.auto).length} / {feeds.length}</div>{feeds.some((f) => f.err) && <div className="small" style={{ color: "var(--danger)" }}>{feeds.filter((f) => f.err).length} mit Fehler</div>}</div>
      </div>
      )}

      <form className="card card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field"><label className="label" htmlFor="roi">ROI ab %</label><input className="input num" id="roi" name="roi" defaultValue={minRoi} style={{ width: 80 }} /></div>
        <div className="field"><label className="label" htmlFor="gw">Gewinn ab €</label><input className="input num" id="gw" name="gewinn" defaultValue={String(minProfit).replace(".", ",")} style={{ width: 80 }} /></div>
        <div className="field"><label className="label" htmlFor="vk">Verk./Monat ab</label><input className="input num" id="vk" name="verk" defaultValue={minSales} style={{ width: 80 }} /></div>
        <div className="field"><label className="label" htmlFor="nur">Nur</label><select className="select" id="nur" name="nur" defaultValue={nur}><option value="">alle</option><option value="gefallen">EK gefallen (30 T)</option><option value="neu">{manual ? "gezogen (7 T)" : "neu (7 T)"}</option><option value="pruefen">Menge prüfen (ROI über {ROI_IMPLAUSIBLE} %)</option></select></div>
        <div className="field"><label className="label" htmlFor="so">Sortieren</label><select className="select" id="so" name="sort" defaultValue={sort}>{Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {only.length > 0 && <input type="hidden" name="lf" value={only.join(",")} />}
        {manual && <input type="hidden" name="quelle" value="manuell" />}
        <button className="btn" type="submit">Filtern</button>
      </form>
      {feeds.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href={qs({ lf: "" })} className={`chip${only.length === 0 ? " active" : ""}`}>Alle Lieferanten</Link>
          {feeds.map((f) => {
            const on = only.includes(f.id);
            const next = on ? only.filter((x) => x !== f.id) : [...only, f.id];
            return <Link key={f.id} href={qs({ lf: next.join(",") })} className={`chip${on ? " active" : ""}`}>{f.name}</Link>;
          })}
        </div>
      )}

      {odd.length > 0 && (
        <div className={`card card-pad small stack ${nur === "pruefen" ? "" : "notice-warn"}`} style={{ gap: 6 }} data-testid="odd-note">
          {nur === "pruefen" ? (
            <div>
              <strong>Menge prüfen ({odd.length}):</strong> ROI über {ROI_IMPLAUSIBLE} % ist fast nie echt. Meist ist das Amazon-Angebot eine Großpackung (z. B. 24 Stück), die Mengenangabe fehlt im Titel – oder der Titel-Treffer ist ein anderes Produkt. Bei „Stk je Verkauf“ die richtige Zahl eintragen (z. B. 24), dann rechnet es neu. <Link href={qs({ nur: "" })}>← zurück zu den plausiblen</Link>
            </div>
          ) : (
            <div>
              <strong>{odd.length} Treffer mit ROI über {ROI_IMPLAUSIBLE} % ausgeblendet</strong> – fast immer stimmt die Menge nicht (Amazon verkauft eine Großpackung) oder der Titel-Treffer ist ein anderes Produkt. <Link href={qs({ nur: "pruefen" })} data-testid="odd-link">Anzeigen und Stückzahl prüfen →</Link>
            </div>
          )}
          {packMissing.length > 0 && (
            <form action={packRefreshAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="ids" value={packMissing.join(",")} />
              <input type="hidden" name="back" value={qs({}).replace(/^[^?]*/, "")} />
              <SubmitButton className="btn btn-small" label={`Stückzahl bei Keepa nachladen (${packAsins} Token${packAsins === 1 ? "" : "s"})`} pendingLabel="Frage Keepa …" testId="pack-refresh" />
              <span className="muted">Keepa kennt bei vielen Angeboten die Packungsmenge bzw. den Inhalt – danach wird automatisch neu gerechnet.</span>
            </form>
          )}
        </div>
      )}

      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Produkt</th><th>Günstigster Lieferant</th><th className="right">EK je Verkauf</th><th className="right">Amazon</th><th className="right">Gewinn</th><th className="right">ROI</th><th className="right">Verk./Mon.</th><th>EK-Verlauf</th><th>VK 30 T</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="muted">{nur === "pruefen" ? "Nichts zu prüfen." : manual ? "Nichts Lohnenswertes unter dem von Hand Gezogenen (oder noch nichts gezogen). Lieferant öffnen → „Seite oder Liste scannen“ mit dem Seller-Knopf." : "Keine Treffer für diese Filter. Listen hochladen bzw. Links hinterlegen – Keepa prüft dann stündlich neue und geänderte Preise."}</td></tr>}
            {shown.map(({ r, e, alt }) => {
              const h = hist.get(r.id) ?? [];
              const hint = priceHint(priceStats(h, r.price, today));
              const vkStats = r.market?.asin ? priceStats(vk.get(r.market.asin) ?? [], r.market.price, today) : null;
              return (
                <tr key={r.id} data-testid="chance-row" data-ean={r.ean ?? ""} data-asin={r.market?.asin ?? ""}>
                  <td style={{ maxWidth: 300 }}>
                    <Link href={`/lieferanten/abfrage?q=${encodeURIComponent(r.ean ?? r.market?.asin ?? r.title ?? "")}`}><strong>{r.market?.title ?? r.title ?? r.supplier_sku}</strong></Link>
                    <div className="small muted">{r.ean ?? "–"}{r.market?.asin && <> · <a href={`https://www.amazon.de/dp/${r.market.asin}`} target="_blank" rel="noreferrer">{r.market.asin}</a></>}</div>
                    {(r.market?.sellable || r.market?.amazonSells) && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                        {r.market?.sellable && (r.market.sellable.ok ? <span className="tag tag-ok">verkaufbar</span> : <span className="tag tag-danger">{r.market.sellable.reason ?? "gesperrt"}</span>)}
                        {r.market?.amazonSells && <span className="tag tag-warn">Amazon verkauft selbst</span>}
                      </div>
                    )}
                  </td>
                  <td className="small">
                    <strong>{r.feed_name}</strong>{alt > 0 && <span className="muted"> · +{alt} weitere</span>}
                    <div className="muted">{r.stock === null ? "lieferbar" : `${r.stock} Stk`}{r.moq && r.moq > 1 ? ` · ab ${r.moq}` : ""} · {manual && r.scanned_at ? `gezogen ${ago(r.scanned_at)}` : ago(r.last_seen_at)}</div>
                    {r.title && (
                      <div className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`Beim Lieferanten: ${r.title}`}>
                        ↳ {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}
                      </div>
                    )}
                    {r.market?.byTitle && <div className="muted" title="Ohne EAN per Titel bei Keepa gefunden">per Titel – gegenprüfen</div>}
                  </td>
                  <td className="num right">
                    {formatEuro(e.costPerSale)}
                    {e.unitsPerSale > 1 && <div className="small muted" title={e.unitsSource ? UNITS_SOURCE_LABEL[e.unitsSource] : undefined}>{e.unitsPerSale} × {formatEuro(e.unitNet)}</div>}
                    <QtyEdit feedId={r.feed_id} offerId={r.id} units={e.unitsPerSale} source={e.unitsSource} amazonQty={r.amazon_qty} open={e.implausible} />
                  </td>
                  <td className="num right">{formatEuro(e.sale)}</td>
                  <td className="num right" style={{ color: "var(--ok)", fontWeight: 600 }}>{formatEuro(e.profit)}</td>
                  <td className="num right" style={{ whiteSpace: "nowrap" }}>
                    {e.roi?.toLocaleString("de-DE", { maximumFractionDigits: e.roi !== null && Math.abs(e.roi) >= 100 ? 0 : 1 })} %
                    {e.implausible && <div><span className="tag tag-warn" title="Stückzahl des Amazon-Angebots prüfen">Menge prüfen</span></div>}
                  </td>
                  <td className="num right">{r.market?.monthlySold?.toLocaleString("de-DE") ?? "–"}</td>
                  <td className="small" style={{ minWidth: 140 }}>{hint && <div style={{ color: hint.tone === "good" ? "var(--ok)" : "var(--danger)" }}>{hint.text}</div>}<Spark points={h} /></td>
                  <td className="num small" style={{ whiteSpace: "nowrap", color: vkStats?.change30Pct ? (vkStats.change30Pct > 0 ? "var(--ok)" : "var(--danger)") : undefined }}>{vkStats?.change30Pct !== null && vkStats?.change30Pct !== undefined ? `${vkStats.change30Pct > 0 ? "+" : ""}${vkStats.change30Pct.toLocaleString("de-DE")} %` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="small muted">Gerechnet mit Amazon-Preis, FBA-Gebühr und Provision laut Keepa (sonst Standard aus den Einstellungen), Netto-EK je Stück inkl. Aufschlag der Liste, mal Stück je Amazon-Verkauf (aus dem Amazon-Titel, laut Keepa oder nach Inhalt – unter dem EK änderbar). Ab Verkaufsstart Preise immer gegenprüfen.</div>
    </>
  );
}
