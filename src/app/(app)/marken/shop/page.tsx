import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/service";
import { latestTikTokImport, productHistory } from "@/lib/brands/shop-service";
import { productHints } from "@/lib/brands/shop";
import { keepaKey } from "@/lib/integrations/clients/keepa";
import { formatEuro } from "@/lib/numbers";
import { CopyButton } from "../forms";
import { removeProductAction } from "./actions";
import { AddProduct, ListingButton, RefreshButton, TikTokImport } from "./forms";

const HINT_COLOR = { warn: "var(--danger)", info: "var(--ink-2)", ok: "var(--ok)" } as const;

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ marke?: string; sort?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const t = session.tenantId;
  const brands = await listBrands(t);
  const brand = brands.find((b) => b.id === sp.marke) ?? brands[0];
  if (!brand) return null;
  const [products, tiktok, hasKeepa] = await Promise.all([
    db.select().from(schema.brandProducts).where(and(eq(schema.brandProducts.tenantId, t), eq(schema.brandProducts.brandId, brand.id))).orderBy(asc(schema.brandProducts.createdAt)),
    latestTikTokImport(t, brand.id),
    keepaKey(t).then(Boolean),
  ]);
  const histories = new Map(await Promise.all(products.map(async (p) => [p.id, await productHistory(t, p.id)] as const)));
  const sortKey = sp.sort === "umsatz" ? "revenue" : sp.sort === "videos" ? "videos" : "sales";
  const tiktokItems = tiktok ? [...tiktok.items].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0)).slice(0, 40) : [];
  const fmtN = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("de-DE"));

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/marken">Marken</Link></div><h1>Shop-Analyse</h1></div>
        {hasKeepa && products.length > 0 && <RefreshButton />}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {brands.map((b) => <Link key={b.id} href={`/marken/shop?marke=${b.id}`} className={`chip${brand.id === b.id ? " active" : ""}`}>{b.name}</Link>)}
      </div>
      {!hasKeepa && (
        <div className="notice notice-info small">Für Preise, Rang und Bewertungen der eigenen Produkte unter <Link href="/anbindungen?p=keepa#keepa">Anbindungen → Keepa</Link> den Schlüssel eintragen (oder im eBay-Tool unter Bildquellen).</div>
      )}

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <h2>Eigene Produkte auf Amazon</h2>
          {products.length === 0 && <div className="card card-pad muted">Noch keine – rechts ASINs oder Amazon-Links einfügen. Werte werden täglich per Keepa aktualisiert.</div>}
          {products.map((p) => {
            const d = p.data;
            const hist = (histories.get(p.id) ?? []).map((h) => ({ day: h.day, price: h.price ? Number(h.price) : null, salesRank: h.salesRank ? Number(h.salesRank) : null, reviews: h.reviews ? Number(h.reviews) : null, rating: h.rating ? Number(h.rating) : null }));
            const hints = d ? productHints(d, hist, null) : [];
            const ranks = hist.map((h) => h.salesRank).filter((x): x is number => x !== null);
            return (
              <article key={p.id} className="card card-pad stack" style={{ gap: 10 }}>
                <div style={{ display: "flex", gap: 14 }}>
                  {d?.imageUrl && <img src={d.imageUrl} alt="" width={72} height={72} style={{ objectFit: "contain", borderRadius: 8, background: "#fff", border: "1px solid var(--border)", flexShrink: 0 }} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <a href={`https://www.amazon.de/dp/${p.asin}`} target="_blank" rel="noopener" style={{ fontWeight: 600 }}>{d?.title ?? p.asin}</a>
                    <div className="small muted num">{p.asin}{p.fetchedAt ? ` · Stand ${p.fetchedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}` : ""}</div>
                    {p.lastError && <div className="small" style={{ color: "var(--danger)" }}>{p.lastError}</div>}
                  </div>
                  <form action={removeProductAction}><input type="hidden" name="id" value={p.id} /><button className="btn-link small muted" type="submit">Entfernen</button></form>
                </div>
                {d && (
                  <div className="shop-kpis">
                    <div><span className="small muted">Preis</span><strong className="num">{d.price ? formatEuro(d.price) : "–"}</strong><span className="small muted">{d.hasBuyBox ? "Buy Box" : "keine Buy Box"}</span></div>
                    <div><span className="small muted">Verkaufsrang</span><strong className="num">{fmtN(d.salesRank)}</strong><span className="small muted">{ranks.length > 1 ? `beste ${fmtN(Math.min(...ranks))} · 120 T.` : ""}</span></div>
                    <div><span className="small muted">Verkäufe/Monat</span><strong className="num">{d.monthlySold ? `${fmtN(d.monthlySold)}+` : "–"}</strong><span className="small muted">laut Amazon</span></div>
                    <div><span className="small muted">Bewertungen</span><strong className="num">{d.rating ? `${d.rating.toLocaleString("de-DE")} ★` : "–"}</strong><span className="small muted">{fmtN(d.reviews)} Stück</span></div>
                    <div><span className="small muted">FBA-Gebühr</span><strong className="num">{d.fbaFee ? formatEuro(d.fbaFee) : "–"}</strong><span className="small muted">{d.referralPct ? `Provision ${d.referralPct} %` : ""}</span></div>
                  </div>
                )}
                {hints.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    {hints.map((h, n) => <li key={n} style={{ color: HINT_COLOR[h.level] }}>{h.text}</li>)}
                  </ul>
                )}
                {d && (
                  <details className="small">
                    <summary style={{ cursor: "pointer" }}>Titel und Stichpunkte ({d.features.length})</summary>
                    <div style={{ marginTop: 6 }}><strong>{d.title}</strong> <span className="muted">({d.title.length} Zeichen)</span></div>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{d.features.map((f, n) => <li key={n}>{f}</li>)}</ul>
                  </details>
                )}
                {d && <ListingButton id={p.id} again={Boolean(p.aiListing)} />}
                {p.aiListing && (
                  <div className="snippet small" style={{ whiteSpace: "pre-wrap", maxWidth: "none" }}>
                    {p.aiListing}
                    <div style={{ marginTop: 6 }}><CopyButton text={p.aiListing} label="Vorschlag kopieren" /></div>
                  </div>
                )}
              </article>
            );
          })}

          <h2 style={{ marginTop: 12 }}>TikTok Shop: was sich gerade verkauft</h2>
          {!tiktok ? (
            <div className="card card-pad muted small">
              Noch kein Import. In Chrome mit der Helium-10-Erweiterung auf TikTok Shop nach deiner Nische suchen (z. B. „american candy“, „watch box“) → Export als CSV → rechts hochladen.
              Die Bestseller fließen dann in die KI-Ideen und Listing-Vorschläge ein.
            </div>
          ) : (
            <section className="card" style={{ overflow: "auto" }}>
              <div className="card-pad small muted" style={{ paddingBottom: 0 }}>
                Import „{tiktok.fileName}“ vom {tiktok.createdAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} · {tiktok.items.length} Produkte · sortiert nach{" "}
                <Link href={`/marken/shop?marke=${brand.id}&sort=verkauf`}>Verkäufen</Link> · <Link href={`/marken/shop?marke=${brand.id}&sort=umsatz`}>Umsatz</Link> · <Link href={`/marken/shop?marke=${brand.id}&sort=videos`}>Videos</Link>
              </div>
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>Produkt</th><th>Shop</th><th className="right">Preis</th><th className="right">Verkauft</th><th className="right">Umsatz</th><th className="right">★</th><th className="right">Videos</th><th className="right">Creator</th></tr></thead>
                <tbody>
                  {tiktokItems.map((i, n) => (
                    <tr key={n}>
                      <td style={{ maxWidth: 340 }}>{i.url ? <a href={i.url} target="_blank" rel="noopener">{i.title}</a> : i.title}</td>
                      <td className="small">{i.shop ?? "–"}</td>
                      <td className="num right">{i.price ? formatEuro(i.price) : "–"}</td>
                      <td className="num right">{fmtN(i.sales)}</td>
                      <td className="num right">{i.revenue ? formatEuro(i.revenue) : "–"}</td>
                      <td className="num right">{i.rating?.toLocaleString("de-DE") ?? "–"}</td>
                      <td className="num right">{fmtN(i.videos)}</td>
                      <td className="num right">{fmtN(i.creators)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>{brand.name}: Produkte hinzufügen</h2>
            <AddProduct brandId={brand.id} />
          </section>
          <section className="card card-pad stack">
            <h2>TikTok-Daten (Helium 10)</h2>
            <TikTokImport brandId={brand.id} />
            <div className="small muted">Helium 10 bietet dafür keine Schnittstelle – der Export aus der Chrome-Erweiterung ist der Weg. Jeder neue Import ersetzt die Anzeige, ältere bleiben gespeichert.</div>
          </section>
          {brand.links && (
            <section className="card card-pad stack small">
              <h2>Kanäle</h2>
              {brand.links.split(/\r?\n/).filter((l) => /^https?:\/\//.test(l.trim())).map((l) => <a key={l} href={l.trim()} target="_blank" rel="noopener">{l.trim().replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)} ↗</a>)}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
