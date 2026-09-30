import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OfferMarket } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { eurRates } from "@/lib/fx/ecb";
import { getIntegration } from "@/lib/integrations/store";
import { keepaKey } from "@/lib/integrations/clients/keepa";
import { formatEuro } from "@/lib/numbers";
import { profitAt } from "@/lib/pricing";
import { packInfo, packOf } from "@/lib/suppliers/scan";
import { getSettings } from "@/lib/settings";
import { clearFeedAction, feedCostAction, offerToListing } from "../actions";
import { BoxSuggest, KeepaCheck, ScanForm } from "./scan-form";
import { visibleBrands } from "@/lib/brands/access";
import { upcomingOccasions } from "@/lib/brands/occasions";
import { canAccess } from "@/lib/auth/areas";
import { todayIso } from "@/lib/dates";
import { FeedUpload } from "./upload-form";

type Row = {
  id: string; supplier_sku: string; ean: string | null; asin: string | null; title: string | null; price: number | null; stock: number | null;
  price_orig: number | null; currency: string | null; url: string | null; image_url: string | null; pack: string | null; market: OfferMarket | null;
  amz_price: number | null; our_asin: string | null; fee: number | null; ref: number | null;
};

const SYM: Record<string, string> = { USD: "$", GBP: "£" };

export default async function FeedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nur?: string; q?: string }> }) {
  const session = await requireArea("wawi");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = session.tenantId;
  const [feed] = await db.select().from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.id, id), eq(schema.supplierFeeds.tenantId, t)));
  if (!feed) notFound();
  const [s, rates, ai, keepa, brands] = await Promise.all([getSettings(t), eurRates(), getIntegration(t, "anthropic"), keepaKey(t), canAccess(session, "marken") ? visibleBrands(session) : Promise.resolve([])]);
  const res = await db.execute<Row>(sql`
    select o.id, o.supplier_sku, o.ean, o.asin, o.title, o.price::float, o.stock, o.price_orig::float, o.currency, o.url, o.image_url, o.pack, o.market,
           (select max(i.price)::float from amazon_inventory i where i.tenant_id = o.tenant_id and i.asin = coalesce(o.asin, p.asin)) as amz_price,
           p.asin as our_asin, p.fba_fee::float as fee, p.referral_rate::float as ref
      from supplier_offers o
      left join products p on p.tenant_id = o.tenant_id and ((o.asin is not null and p.asin = o.asin) or (o.ean is not null and p.ean = o.ean))
     where o.feed_id = ${id} and o.tenant_id = ${t}
     order by o.title nulls last, o.supplier_sku
     limit 5000`);
  const costPct = Number(feed.mapping.costPct || 0);
  const vatRate = feed.mapping.vatPct ? Number(feed.mapping.vatPct) / 100 : s.vatRate;
  const rows = res.rows.map((r) => {
    const m = r.market;
    const sale = r.amz_price ?? m?.price ?? null;
    // Großhandel: Preis gilt für den Karton – gerechnet wird je Verkaufseinheit.
    const pack = packInfo(r.title ?? "", r.url);
    const cost = r.price !== null ? Math.round(r.price * (1 + costPct / 100) * 100) / 100 : null;
    const unitCost = cost !== null ? Math.round((cost / pack.caseQty) * 100) / 100 : null;
    const profit = sale !== null && unitCost !== null
      ? profitAt(sale, { unitCost, fbaFee: r.fee ?? m?.fbaFee ?? s.pricing.defaultFbaFee, referralRate: r.ref ?? (m?.referralPct ? m.referralPct / 100 : s.pricing.referralRate), vatRate })
      : null;
    return { ...r, pack: packOf(r.title ?? "", r.url) ?? r.pack, caseQty: pack.caseQty, sale, cost, unitCost, profit, margin: profit !== null && sale ? Math.round((profit / sale) * 1000) / 10 : null };
  });
  const q = sp.q?.trim().toLowerCase();
  let shown = q ? rows.filter((r) => `${r.title} ${r.supplier_sku} ${r.ean} ${r.asin}`.toLowerCase().includes(q)) : rows;
  if (sp.nur === "treffer") shown = shown.filter((r) => r.our_asin);
  if (sp.nur === "amazon") shown = shown.filter((r) => r.market?.asin);
  if (sp.nur === "gewinn") shown = shown.filter((r) => (r.profit ?? -1) > 0).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
  const withEan = rows.filter((r) => r.ean).length;
  const onAmazon = rows.filter((r) => r.market?.asin).length;
  const chip = (nur?: string) => `/lieferanten/${id}${nur || q ? `?${new URLSearchParams({ ...(nur ? { nur } : {}), ...(q ? { q } : {}) })}` : ""}`;

  return (
    <>
      <div className="crumb"><Link href="/lieferanten">Lieferanten-Feeds</Link></div>
      <div className="page-head">
        <div>
          <h1>{feed.name}</h1>
          <div className="small muted">{rows.length} Artikel · {withEan} mit EAN/UPC · {onAmazon} auf amazon.de gefunden · {rows.filter((r) => r.our_asin).length} passen zu deinen Artikeln</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
          <ScanForm feedId={feed.id} usdRate={rates.USD ?? null} hasAi={Boolean(ai?.apiKey)} />
          <KeepaCheck feedId={feed.id} hasKeepa={Boolean(keepa)} withEan={withEan} withoutEan={rows.filter((r) => !r.ean && !r.market).length} />
          {brands.length > 0 && rows.length > 0 && (
            <BoxSuggest feedId={feed.id} brands={brands.map((b) => ({ id: b.id, name: b.name }))} occasions={upcomingOccasions(todayIso()).map((o) => ({ key: o.key, name: o.name }))} hasAi={Boolean(ai?.apiKey)} defaultFba={s.pricing.defaultFbaFee + 1.5} />
          )}
          <form action={feedCostAction} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="feedId" value={feed.id} />
            <h2>Kalkulation</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="field">
                <label className="label" htmlFor="costPct">Nebenkosten %</label>
                <input className="input" id="costPct" name="costPct" inputMode="decimal" defaultValue={feed.mapping.costPct ?? ""} placeholder="z. B. 35" />
              </div>
              <div className="field">
                <label className="label" htmlFor="vatPct">USt %</label>
                <input className="input" id="vatPct" name="vatPct" inputMode="decimal" defaultValue={feed.mapping.vatPct ?? ""} placeholder={String(Math.round(s.vatRate * 100))} />
              </div>
            </div>
            <div className="small muted">Aufschlag auf den EK für Fracht, Zoll und Einfuhrkosten (US-Ware grob 30–50 %). Süßigkeiten: 7 % USt. Großhandelspreise gelten meist je Karton („24 x 9g“) – das System teilt durch die Kartongröße und rechnet Gewinn je Einheit gegen den Amazon-Preis.</div>
            <button className="btn btn-small" type="submit">Speichern</button>
          </form>
          <FeedUpload feedId={feed.id} mapping={feed.mapping} />
          {rows.length > 0 && (
            <form action={clearFeedAction}>
              <input type="hidden" name="feedId" value={feed.id} />
              <button className="btn-link small muted" type="submit">Alle {rows.length} Artikel dieses Feeds löschen</button>
            </form>
          )}
      </div>
      <div className="stack">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Link href={chip()} className={`chip${!sp.nur ? " active" : ""}`}>Alle</Link>
            <Link href={chip("amazon")} className={`chip${sp.nur === "amazon" ? " active" : ""}`}>Auf Amazon</Link>
            <Link href={chip("gewinn")} className={`chip${sp.nur === "gewinn" ? " active" : ""}`}>Mit Gewinn</Link>
            <Link href={chip("treffer")} className={`chip${sp.nur === "treffer" ? " active" : ""}`}>Passt zu meinen Artikeln</Link>
            <form style={{ marginLeft: "auto" }}>
              {sp.nur && <input type="hidden" name="nur" value={sp.nur} />}
              <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Suchen …" style={{ width: 180 }} />
            </form>
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr><th></th><th>Artikel</th><th>EAN / ASIN</th><th className="right">EK Karton</th><th className="right">EK Einheit</th><th className="right">Amazon.de</th><th className="right">Verk./Mon.</th><th className="right">Gewinn/Einheit</th><th></th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={9} className="muted">Keine Artikel. Rechts eine Liste hochladen oder eine Seite scannen.</td></tr>}
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.id}>
                    <td style={{ width: 44 }}>{r.image_url && <img src={r.image_url} alt="" width={40} height={40} loading="lazy" style={{ objectFit: "contain", borderRadius: 6, background: "#fff" }} />}</td>
                    <td style={{ maxWidth: 320 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title ?? ""}>
                        {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title ?? r.supplier_sku}</a> : (r.title ?? "–")}
                      </div>
                      <div className="small muted num">{r.supplier_sku}{r.pack ? ` · ${r.pack}` : ""}{r.stock === 0 ? " · ausverkauft" : r.stock ? ` · ${r.stock} verfügbar` : ""}</div>
                    </td>
                    <td className="num small">
                      {r.ean ?? "–"}
                      {(r.our_asin || r.market?.asin) && (
                        <div>
                          {r.our_asin ? <Link href={`/chargen?q=${r.our_asin}`}>{r.our_asin}</Link> : <a href={`https://www.amazon.de/dp/${r.market!.asin}`} target="_blank" rel="noopener noreferrer" title={r.market!.title}>{r.market!.asin}</a>}
                          {!r.our_asin && r.market?.byTitle && <div className="tag tag-warn" title={r.market.title}>per Titel – prüfen</div>}
                        </div>
                      )}
                      {r.market && !r.market.asin && <div className="muted">nicht auf amazon.de</div>}
                    </td>
                    <td className="num right" style={{ whiteSpace: "nowrap" }}>
                      {formatEuro(r.price)}
                      {r.price_orig !== null && r.currency && r.currency !== "EUR" && <span className="small muted"> ({SYM[r.currency] ?? `${r.currency} `}{r.price_orig.toFixed(2)})</span>}
                      {costPct > 0 && r.cost !== null && <div className="small muted">mit NK {formatEuro(r.cost)}</div>}
                    </td>
                    <td className="num right" style={{ whiteSpace: "nowrap" }}>
                      <strong>{formatEuro(r.unitCost)}</strong>
                      {r.caseQty > 1 && <div className="small muted">÷ {r.caseQty}</div>}
                    </td>
                    <td className="num right" style={{ whiteSpace: "nowrap" }}>
                      {formatEuro(r.sale)}
                      {r.market?.offers ? <div className="small muted">{r.market.offers} Anbieter</div> : null}
                    </td>
                    <td className="num right">{r.market?.monthlySold ? `${r.market.monthlySold}+` : r.market?.salesRank ? <span className="small muted">#{r.market.salesRank.toLocaleString("de-DE")}</span> : "–"}</td>
                    <td className="num right" style={{ whiteSpace: "nowrap", color: (r.profit ?? 0) < 0 ? "var(--danger)" : r.profit ? "var(--ok)" : undefined }}>
                      {formatEuro(r.profit)}
                      {r.margin !== null && <div className="small muted">{r.margin.toLocaleString("de-DE")} %</div>}
                    </td>
                    <td>
                      <form action={offerToListing} style={{ display: "flex", gap: 4 }}>
                        <input type="hidden" name="offerId" value={r.id} />
                        <input type="hidden" name="price" value={r.sale ?? ""} />
                        <button className="btn btn-small" type="submit" title="eBay-Listing-Entwurf anlegen" style={{ whiteSpace: "nowrap" }}>→ eBay</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <div className="card-pad small muted">Die ersten 500 von {shown.length} – Suche oder Filter nutzen.</div>}
          </section>
      </div>
    </>
  );
}
