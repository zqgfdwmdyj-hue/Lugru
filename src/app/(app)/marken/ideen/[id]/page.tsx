import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { brandAllowed } from "@/lib/auth/areas";
import { CONTENT_STATUS_LABEL, IDEA_STATUS_LABEL } from "@/lib/brands/ai";
import { OCCASIONS, occasionByKey } from "@/lib/brands/occasions";
import { formatEuro } from "@/lib/numbers";
import { checklistAction, deleteIdeaAction, setIdeaStatusAction, ideaToArticleAction } from "../../actions";
import { MarketForms, SaveForm, SuggestContent } from "../../forms";
import { calcProfit, summarizeMarket } from "@/lib/brands/market";

const pct = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;

const NEXT: Record<string, [string, string][]> = {
  idea: [["review", "Prüfen"], ["planned", "Umsetzen (geplant)"], ["rejected", "Verwerfen"]],
  review: [["planned", "Umsetzen (geplant)"], ["rejected", "Verwerfen"]],
  planned: [["in_progress", "In Umsetzung"], ["idea", "Zurück zu Idee"]],
  in_progress: [["live", "Ist live"], ["planned", "Zurück zu Geplant"]],
  live: [["in_progress", "Wieder in Umsetzung"]],
  rejected: [["idea", "Wieder aufnehmen"]],
};

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("marken");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = session.tenantId;
  const [row] = await db
    .select({ idea: schema.ideas, brand: schema.brands })
    .from(schema.ideas)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.ideas.brandId))
    .where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, t)));
  if (!row) notFound();
  const { idea: i, brand: b } = row;
  if (!brandAllowed(session.brandIds, session.role, b.id)) notFound();
  const posts = await db.select().from(schema.contentPosts).where(and(eq(schema.contentPosts.tenantId, t), eq(schema.contentPosts.ideaId, i.id))).orderBy(desc(schema.contentPosts.createdAt));
  const [label, cls] = IDEA_STATUS_LABEL[i.status];
  const market = i.market ?? null;
  const summary = market ? summarizeMarket(market.products) : null;
  const ek = i.costEstimate ? Number(i.costEstimate) : null;
  // Ohne eigenen Preis: Median der Vergleichsprodukte.
  const vk = i.targetPrice ? Number(i.targetPrice) : (summary?.price ?? null);
  const vatRate = Number(b.vatRate);
  const calc = vk
    ? {
        fba: calcProfit({ price: vk, cost: ek, vatRate, referralPct: summary?.referralPct, fbaFee: summary?.fbaFee }, "fba"),
        fbm: calcProfit({ price: vk, cost: ek, vatRate, referralPct: summary?.referralPct, fbmShipping: 4.5 }, "fbm"),
      }
    : null;
  const done = i.checklist.filter((c) => c.done).length;
  const [article] = await db.select({ id: schema.articles.id, sku: schema.articles.sku, status: schema.articles.status }).from(schema.articles).where(and(eq(schema.articles.tenantId, t), eq(schema.articles.ideaId, i.id)));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href={`/marken?marke=${b.id}`}>{b.name}</Link>{i.occasion && <> · <Link href={`/marken?marke=${b.id}&anlass=${i.occasion}`}>{occasionByKey(i.occasion)?.name}</Link></>}</div>
          <h1 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{i.title} <span className={`tag ${cls}`}>{label}</span>{i.source === "ai" && <span className="tag tag-neutral">KI-Vorschlag</span>}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {article ? (
            <Link className="btn" href={`/artikel/${article.id}`}>Artikelstamm: {article.sku}</Link>
          ) : (
            <form action={ideaToArticleAction}><input type="hidden" name="id" value={i.id} /><button className="btn" type="submit">In Artikelstamm übernehmen</button></form>
          )}
          {(NEXT[i.status] ?? []).map(([s, text], n) => (
            <form key={s} action={setIdeaStatusAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value={s} /><button className={`btn${n === 0 ? " btn-primary" : ""}`} type="submit">{text}</button></form>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <section className="card card-pad">
            <SaveForm kind="idea">
              <input type="hidden" name="id" value={i.id} />
              <div className="field"><label className="label" htmlFor="title">Titel</label><input className="input" id="title" name="title" defaultValue={i.title} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="kind">Art</label>
                  <select className="input" id="kind" name="kind" defaultValue={i.kind}><option value="box">Box / Set</option><option value="product">Produkt</option><option value="other">Sonstiges</option></select></div>
                <div className="field"><label className="label" htmlFor="occasion">Anlass</label>
                  <select className="input" id="occasion" name="occasion" defaultValue={i.occasion ?? ""}><option value="">ganzjährig</option>{OCCASIONS.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select></div>
                <div className="field"><label className="label" htmlFor="launchDate">Launch</label><input className="input" id="launchDate" name="launchDate" type="date" defaultValue={i.launchDate ?? ""} /></div>
              </div>
              <div className="field"><label className="label" htmlFor="concept">Konzept</label><textarea className="textarea" id="concept" name="concept" defaultValue={i.concept ?? ""} style={{ minHeight: 80 }} /></div>
              <div className="field"><label className="label" htmlFor="contents">{i.kind === "product" ? "Merkmale" : "Inhalt"} – eine Zeile je Teil</label><textarea className="textarea" id="contents" name="contents" defaultValue={i.contents.join("\n")} style={{ minHeight: 110 }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="targetPrice">Verkaufspreis brutto</label><input className="input" id="targetPrice" name="targetPrice" inputMode="decimal" defaultValue={i.targetPrice ?? ""} /></div>
                <div className="field"><label className="label" htmlFor="costEstimate">Einkauf netto (geschätzt)</label><input className="input" id="costEstimate" name="costEstimate" inputMode="decimal" defaultValue={i.costEstimate ?? ""} /></div>
              </div>
              <div className="field"><label className="label" htmlFor="sourcing">Beschaffung</label><textarea className="textarea" id="sourcing" name="sourcing" defaultValue={i.sourcing ?? ""} style={{ minHeight: 60 }} /></div>
              <div className="field"><label className="label" htmlFor="notes">Notizen</label><textarea className="textarea" id="notes" name="notes" defaultValue={i.notes ?? ""} style={{ minHeight: 60 }} /></div>
            </SaveForm>
          </section>

          <section className="card card-pad stack">
            <h2>Markt: ähnliche Produkte auf Amazon</h2>
            <MarketForms ideaId={i.id} term={market?.source === "keepa" ? market.term : i.title.replace(/[„“"]/g, "")} />
            {summary && market && (
              <>
                <div className="grid-kpi" style={{ gap: 10 }}>
                  <div className="card card-pad"><div className="small muted">Preis (Median)</div><div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{summary.price ? formatEuro(summary.price) : "–"}</div><div className="small muted">{summary.priceLow && summary.priceHigh ? `meist ${formatEuro(summary.priceLow)}–${formatEuro(summary.priceHigh)}` : ""}</div></div>
                  <div className="card card-pad"><div className="small muted">FBA-Gebühr</div><div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{summary.fbaFee ? formatEuro(summary.fbaFee) : "–"}</div></div>
                  <div className="card card-pad"><div className="small muted">Provision</div><div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{summary.referralPct ? `${summary.referralPct} %` : "–"}</div></div>
                  <div className="card card-pad"><div className="small muted">Verkäufe / Monat (alle)</div><div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{summary.monthlySold ?? "–"}</div></div>
                </div>
                <div style={{ overflow: "auto" }}>
                  <table className="table" style={{ fontSize: 13 }}>
                    <thead><tr><th>Produkt</th><th className="right">Preis</th><th className="right">FBA</th><th className="right">Verk./Monat</th><th className="right">Rang</th><th className="right">Bew.</th></tr></thead>
                    <tbody>
                      {market.products.slice(0, 15).map((p) => (
                        <tr key={p.asin}>
                          <td style={{ maxWidth: 360 }}><a href={`https://www.amazon.de/dp/${p.asin}`} target="_blank" rel="noopener">{p.title}</a><div className="small muted num">{p.asin}</div></td>
                          <td className="num right">{p.price ? formatEuro(p.price) : "–"}</td>
                          <td className="num right">{p.fbaFee ? formatEuro(p.fbaFee) : "–"}</td>
                          <td className="num right">{p.monthlySold ?? "–"}</td>
                          <td className="num right">{p.salesRank?.toLocaleString("de-DE") ?? "–"}</td>
                          <td className="num right">{p.reviews?.toLocaleString("de-DE") ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="small muted">Quelle: {market.source === "keepa" ? `Keepa, Suche „${market.term}“` : `Helium 10 (${market.term})`} · {new Date(market.fetchedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</div>
              </>
            )}
          </section>

          <section className="card card-pad stack">
            <h2>Video-Ideen zu dieser {i.kind === "product" ? "Produktidee" : "Box"}</h2>
            <SuggestContent brandId={b.id} ideaId={i.id} />
            {posts.length === 0 && <div className="small muted">Noch keine. Die KI schreibt Hook, Ablauf, Szenen, Caption und Hashtags – drehen mit dem Handy.</div>}
            {posts.map((p) => (
              <div key={p.id} className="small" style={{ borderTop: "1px solid var(--row)", paddingTop: 8 }}>
                <span className={`tag ${CONTENT_STATUS_LABEL[p.status][1]}`}>{CONTENT_STATUS_LABEL[p.status][0]}</span> <strong>{p.format ? `${p.format}: ` : ""}{p.hook}</strong>
              </div>
            ))}
            {posts.length > 0 && <Link className="small" href={`/marken/content?marke=${b.id}`}>Im Content-Plan bearbeiten →</Link>}
          </section>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Bis zum Launch <span className="muted small">{done}/{i.checklist.length}</span></h2>
            {i.checklist.map((c, n) => (
              <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <form action={checklistAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="toggle" /><input type="hidden" name="index" value={n} />
                  <button className="btn-link" type="submit" aria-label={c.done ? "Wieder öffnen" : "Erledigt"} style={{ fontSize: 16 }}>{c.done ? "☑" : "☐"}</button></form>
                <span style={{ flex: 1, textDecoration: c.done ? "line-through" : undefined, color: c.done ? "var(--muted)" : undefined }}>{c.text}</span>
                <form action={checklistAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="remove" /><input type="hidden" name="index" value={n} />
                  <button className="btn-link small muted" type="submit" aria-label="Entfernen">✕</button></form>
              </div>
            ))}
            <form action={checklistAction} style={{ display: "flex", gap: 6 }}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="add" />
              <input className="input" name="text" placeholder="Schritt ergänzen" style={{ flex: 1 }} />
              <button className="btn btn-small" type="submit">+</button>
            </form>
            <Link className="small" href="/einkauf">→ Ware im Einkauf bestellen</Link>
          </section>

          {calc && vk && (
            <section className="card card-pad stack small">
              <h2>Kalkulation je Stück</h2>
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th></th><th className="right">FBA</th><th className="right">FBM</th></tr></thead>
                <tbody>
                  <tr><td>VK brutto{!i.targetPrice && summary?.price ? " (Markt)" : ""}</td><td className="num right" colSpan={2}>{formatEuro(vk)}</td></tr>
                  <tr><td>VK netto ({vatRate} % USt)</td><td className="num right" colSpan={2}>{formatEuro(calc.fba.netPrice)}</td></tr>
                  <tr><td>Einkauf netto</td><td className="num right" colSpan={2}>{ek ? formatEuro(-ek) : "–"}</td></tr>
                  <tr><td>Provision {summary?.referralPct ? `${summary.referralPct} %` : "ca. 15 %"}</td><td className="num right" colSpan={2}>{formatEuro(-calc.fba.referral)}</td></tr>
                  <tr><td>{summary?.fbaFee ? "FBA-Gebühr (Markt) / Versand" : "FBA-Gebühr / Versand (Schätzung)"}</td><td className="num right">{formatEuro(-calc.fba.fulfilment)}</td><td className="num right">{formatEuro(-calc.fbm.fulfilment)}</td></tr>
                  <tr style={{ fontWeight: 600 }}><td>Gewinn</td>
                    <td className="num right" style={{ color: calc.fba.profit < 0 ? "var(--danger)" : undefined }}>{formatEuro(calc.fba.profit)}</td>
                    <td className="num right" style={{ color: calc.fbm.profit < 0 ? "var(--danger)" : undefined }}>{formatEuro(calc.fbm.profit)}</td></tr>
                  <tr><td>Marge / ROI</td><td className="num right">{pct(calc.fba.margin)}{calc.fba.roi !== null ? ` / ${pct(calc.fba.roi)}` : ""}</td><td className="num right">{pct(calc.fbm.margin)}{calc.fbm.roi !== null ? ` / ${pct(calc.fbm.roi)}` : ""}</td></tr>
                </tbody>
              </table>
              <div className="muted">{summary ? `Gebühren aus ${summary.count} Vergleichsprodukten (Median).` : "Mit Vergleichsprodukten (Keepa) werden FBA-Gebühr und Provision genauer."} Ohne Lagergebühren und Werbung.</div>
            </section>
          )}

          {i.why && <section className="card card-pad small"><strong>Warum jetzt:</strong> {i.why}</section>}

          <form action={deleteIdeaAction}><input type="hidden" name="id" value={i.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Idee löschen</button></form>
        </aside>
      </div>
    </>
  );
}
