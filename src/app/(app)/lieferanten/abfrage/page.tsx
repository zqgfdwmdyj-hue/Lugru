import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import { lookupOffers, marketTrend, offerHistory, ownPurchases, type LookupOffer } from "@/lib/suppliers/feed-service";
import { econOf } from "@/lib/suppliers/offer-econ";
import { priceHint, priceStats } from "@/lib/suppliers/prices";
import { ago, Spark } from "@/components/spark";
import { keepaNowAction } from "./actions";

const pct = (n: number | null) => (n === null ? "–" : `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`);

export default async function AbfragePage({ searchParams }: { searchParams: Promise<{ q?: string; lf?: string }> }) {
  const session = await requireArea("lieferanten");
  const sp = await searchParams;
  const t = session.tenantId;
  const q = (sp.q ?? "").trim();
  const only = (sp.lf ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const [s, feeds] = await Promise.all([getSettings(t), db.select({ id: schema.supplierFeeds.id, name: schema.supplierFeeds.name }).from(schema.supplierFeeds).where(eq(schema.supplierFeeds.tenantId, t)).orderBy(asc(schema.supplierFeeds.name))]);
  const offers = q ? await lookupOffers(t, q, only) : [];

  // Nach Produkt gruppieren (EAN, sonst ASIN, sonst Titel).
  const groups = new Map<string, LookupOffer[]>();
  for (const o of offers) {
    const k = o.ean ?? o.asin ?? `t:${(o.title ?? o.supplierSku).toLowerCase().slice(0, 60)}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const list = [...groups.entries()].slice(0, 12);
  const hist = await offerHistory(t, list.flatMap(([, g]) => g.map((o) => o.id)));
  const asins = [...new Set(list.map(([, g]) => g.find((o) => o.market?.asin)?.market?.asin ?? g.find((o) => o.asin)?.asin).filter((a): a is string => !!a))];
  const vk = await marketTrend(t, asins);
  const buysAll = await Promise.all(
    list.map(([, g]) => ownPurchases(t, g.find((o) => o.ean)?.ean ?? null, g.find((o) => o.market?.asin)?.market?.asin ?? g.find((o) => o.asin)?.asin ?? null)),
  );
  const today = todayIso();
  const link = (lf: string[]) => `/lieferanten/abfrage?${new URLSearchParams({ q, ...(lf.length ? { lf: lf.join(",") } : {}) })}`;
  const self = link(only);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/lieferanten">Lieferanten</Link></div><h1>Lieferanten-Abfrage</h1></div>
      </div>
      <form className="card card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor="q" className="sr-only">EAN, ASIN oder Titel</label>
        <input className="input" id="q" name="q" defaultValue={q} placeholder="EAN, ASIN oder Titel – welcher Großhändler hat es, zu welchem Preis, mit wie viel Bestand?" style={{ flex: "1 1 320px" }} autoFocus />
        {only.length > 0 && <input type="hidden" name="lf" value={only.join(",")} />}
        <button className="btn btn-primary" type="submit">Lieferanten zeigen</button>
      </form>
      {feeds.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href={link([])} className={`chip${only.length === 0 ? " active" : ""}`}>Alle Lieferanten</Link>
          {feeds.map((f) => {
            const on = only.includes(f.id);
            return <Link key={f.id} href={link(on ? only.filter((x) => x !== f.id) : [...only, f.id])} className={`chip${on ? " active" : ""}`}>{f.name}</Link>;
          })}
        </div>
      )}
      {q && offers.length === 0 && <div className="notice notice-info">Kein Lieferant führt „{q}“ in seiner Liste.</div>}

      {list.map(([key, group], gi) => {
        const lead = group.find((o) => o.market?.asin) ?? group[0];
        const m = lead.market;
        const asin = m?.asin ?? lead.asin;
        const ean = group.find((o) => o.ean)?.ean ?? null;
        const vkHist = asin ? vk.get(asin) ?? [] : [];
        const vkStats = priceStats(vkHist, m?.price ?? null, today);
        const buys = buysAll[gi];
        const rows = group
          .map((o) => {
            const e = econOf(o, s);
            const h = hist.get(o.id) ?? [];
            const stats = priceStats(h, o.price, today);
            return { o, e, h, stats, hint: priceHint(stats) };
          })
          .sort((a, b) => Number(!a.o.active) - Number(!b.o.active) || (a.e.unitNet ?? 1e9) - (b.e.unitNet ?? 1e9));
        const stale = !m || Date.now() - Date.parse(m.checkedAt) > 24 * 3600_000;
        return (
          <section key={key} className="card" style={{ overflow: "auto" }} data-testid="lookup-group">
            <div className="card-head" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0 }}>{m?.title ?? lead.title ?? lead.supplierSku}</h2>
                <div className="small muted">
                  {ean && <>EAN {ean} · </>}
                  {asin && <><a href={`https://www.amazon.de/dp/${asin}`} target="_blank" rel="noreferrer">{asin}</a> · </>}
                  Amazon-VK {m?.price ? formatEuro(m.price) : "–"}
                  {m?.monthlySold ? <> · ~{m.monthlySold.toLocaleString("de-DE")} Verk./Monat</> : null}
                  {m?.offers ? <> · {m.offers} Verkäufer auf Amazon</> : null}
                  {vkStats.change30Pct !== null && <> · VK 30 T: <strong style={{ color: vkStats.change30Pct >= 0 ? "var(--ok)" : "var(--danger)" }}>{vkStats.change30Pct > 0 ? "+" : ""}{pct(vkStats.change30Pct)}</strong></>}
                  {m && <> · Keepa {ago(m.checkedAt)}</>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {vkHist.length > 1 && <Spark points={vkHist} color="var(--muted)" />}
                {ean && stale && (
                  <form action={keepaNowAction}><input type="hidden" name="ean" value={ean} /><input type="hidden" name="back" value={self} /><button className="btn btn-small" type="submit">Keepa jetzt prüfen</button></form>
                )}
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Lieferant</th><th className="right">Preis</th><th className="right">Bestand</th><th>Abnahme</th><th className="right">Gewinn/Stk</th><th className="right">ROI</th><th>Verlauf</th><th>Geprüft</th></tr></thead>
              <tbody>
                {rows.map(({ o, e, h, stats, hint }) => (
                  <tr key={o.id} data-testid="lookup-row" data-feed={o.feedName} style={{ opacity: o.active ? 1 : 0.5 }}>
                    <td>
                      <Link href={`/lieferanten/${o.feedId}?q=${encodeURIComponent(o.ean ?? o.supplierSku)}`}><strong>{o.feedName}</strong></Link>
                      {o.supplier && o.supplier !== o.feedName && <div className="small muted">{o.supplier}</div>}
                      <div className="small muted">{o.supplierSku}{o.url && <> · <a href={o.url} target="_blank" rel="noreferrer">Shop ↗</a></>}{!o.active && " · nicht mehr gelistet"}</div>
                    </td>
                    <td className="num right">
                      {o.price !== null ? formatEuro(o.price) : "–"}
                      <div className="small muted">{o.pricesGross ? "brutto" : "netto"}{e.caseQty > 1 ? ` · ${e.caseQty} Stk/Karton` : ""}</div>
                      {e.unitNet !== null && (o.pricesGross || e.caseQty > 1 || o.costPct) ? <div className="small muted">= {formatEuro(e.unitNet)} netto/Stk</div> : null}
                      {e.unitsPerSale > 1 && <div className="small muted">Amazon-Angebot = {e.unitsPerSale} Stk → {formatEuro(e.costPerSale)}</div>}
                    </td>
                    <td className="num right">{o.stock === null ? <span className="small">lieferbar</span> : `${o.stock.toLocaleString("de-DE")} Stk`}</td>
                    <td className="small">{o.moq && o.moq > 1 ? `ab ${o.moq} Stk` : "–"}</td>
                    <td className="num right" style={{ color: e.profit === null ? undefined : e.profit > 0 ? "var(--ok)" : "var(--danger)", fontWeight: 600 }}>{e.profit === null ? "–" : formatEuro(e.profit)}</td>
                    <td className="num right" style={{ color: e.roi === null ? undefined : e.roi > 0 ? "var(--ok)" : "var(--danger)" }}>{pct(e.roi)}</td>
                    <td className="small" style={{ minWidth: 150 }}>
                      {hint ? <div style={{ color: hint.tone === "good" ? "var(--ok)" : "var(--danger)" }}>{hint.tone === "good" ? "▼" : "▲"} {hint.text}</div> : <div className="muted">{stats.days > 1 ? `${stats.days} Stände` : "gesammelt seit kurzem"}</div>}
                      <Spark points={h} />
                    </td>
                    <td className="small muted">{ago(o.lastSeenAt ?? o.lastImportAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {buys.length > 0 && (
              <div className="card-pad small" style={{ borderTop: "1px solid var(--border)" }} data-testid="own-buys">
                <strong>Deine Einkäufe:</strong>{" "}
                {buys.map((b, i) => <span key={i}>{i > 0 && " · "}{b.date ? b.date.split("-").reverse().join(".") : "–"} <Link href={`/einkauf/${b.id}`}>{b.number}</Link>{b.supplier ? ` (${b.supplier})` : ""}: {b.quantity} × {formatEuro(b.unit_net)} netto</span>)}
              </div>
            )}
          </section>
        );
      })}
      {!q && <div className="small muted">Durchsucht alle Lieferanten-Feeds (hochgeladene Preislisten, Links, Scans). Preise werden bei jedem Import gespeichert – daraus entsteht der Verlauf je Lieferant.</div>}
    </>
  );
}
