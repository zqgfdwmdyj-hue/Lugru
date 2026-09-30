import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireLogin } from "@/lib/auth";
import { knownCategories, latestPriceChecks, productHistory } from "@/lib/service";
import { aiConfigured } from "@/lib/price-research";
import { AutoRefresh } from "@/components/auto-refresh";
import { AiModeSelect, PriceCheckBox } from "@/components/price-check";
import { formatDate, formatEuro } from "@/lib/numbers";
import { deleteProduct, mergeProducts, researchProduct, updateProduct } from "@/app/(app)/actions";
import { ImageForm } from "@/components/image-form";

export default async function SpendenProduktPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ zurueck?: string }> }) {
  await requireLogin();
  const { id } = await params;
  const zurueck = (await searchParams).zurueck ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const P = schema.products;
  const [product] = await db.select().from(P).where(eq(P.id, id));
  if (!product) notFound();
  const [history, categories, twins, checks] = await Promise.all([
    productHistory(id),
    knownCategories(),
    db
      .select({ id: P.id, name: P.name, variant: P.variant, imageFileId: P.imageFileId })
      .from(P)
      .where(and(ne(P.id, id), sql`lower(${P.name}) = lower(${product.name})`, sql`coalesce(lower(${P.variant}), '') = coalesce(lower(${product.variant}), '')`)),
    latestPriceChecks([id]),
  ]);
  const check = checks.get(id);
  const busy = check?.status === "pending" || check?.status === "running";
  const back = /^[0-9a-f-]{36}$/i.test(zurueck) ? `/verteilung/${zurueck}` : "";

  return (
    <>
      <datalist id="spenden-kategorien">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="crumb">{back ? <Link href={back}>Zurück zur Verteilung</Link> : <Link href="/produkte">Produkte</Link>}</div>
      <div className="page-head"><div><h1>{product.name}{product.variant ? ` · ${product.variant}` : ""}</h1><div className="small muted">{product.category}{product.archived ? " · archiviert" : ""}</div></div></div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {product.imageFileId
              ? <a href={`/datei/${product.imageFileId}`} target="_blank"><img src={`/datei/${product.imageFileId}`} alt={product.name} style={{ maxWidth: 320, maxHeight: 320, borderRadius: 8, display: "block" }} /></a>
              : <div className="muted" style={{ width: 240, height: 180, display: "grid", placeItems: "center", background: "var(--row)", borderRadius: 8 }}>noch kein Foto</div>}
            <div className="stack" style={{ flex: "1 1 260px", gap: 8 }}>
              <h2>Preis im Internet</h2>
              <AutoRefresh active={busy} />
              {!aiConfigured() ? (
                <div className="small muted">Für die KI-Preisrecherche muss auf dem Server ANTHROPIC_API_KEY gesetzt sein (siehe README).</div>
              ) : (
                <>
                  <div className="small muted">Die KI erkennt das Produkt auf dem Foto und sucht den günstigsten aktuellen Preis bei deutschen Händlern.</div>
                  <form action={researchProduct} className="stack" style={{ gap: 6 }}>
                    <input type="hidden" name="productId" value={id} />
                    <AiModeSelect compact />
                    <button className="btn btn-small" type="submit" disabled={busy}>{check ? "Neu recherchieren" : "Preis recherchieren"}</button>
                  </form>
                </>
              )}
              {check && <PriceCheckBox check={check} eventId={/^[0-9a-f-]{36}$/i.test(zurueck) ? zurueck : undefined} />}
            </div>
          </section>
          <section className="card" style={{ overflow: "auto" }}>
            <div className="card-head"><h2>Verlauf</h2><span className="small muted">{history.length}× verteilt</span></div>
            <table className="table">
              <thead><tr><th>Datum</th><th>Verteilung</th><th className="right">Preis</th><th className="right">Menge</th><th>MHD</th></tr></thead>
              <tbody>
                {history.length === 0 && <tr><td colSpan={5} className="muted">Noch in keiner Verteilung.</td></tr>}
                {history.map((h) => (
                  <tr key={h.eventId}>
                    <td className="num">{formatDate(h.eventDate)}</td>
                    <td><Link href={`/verteilung/${h.eventId}`}>{h.title}</Link></td>
                    <td className="num right">{h.priceNote ? `${h.priceNote} ` : ""}{formatEuro(h.price)}</td>
                    <td className="num right">{h.quantity ?? "–"}</td>
                    <td className="num">{formatDate(h.bestBefore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {twins.length > 0 && (
            <form action={mergeProducts} className="card card-pad stack" style={{ gap: 8 }}>
              <input type="hidden" name="productId" value={id} />
              <h2>Doppelt angelegt?</h2>
              <div className="small muted">Diese Produkte heißen genauso. Zusammenführen übernimmt deren Verlauf in dieses Produkt und löscht die Doppelten.</div>
              {twins.map((w) => (
                <label key={w.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="mergeId" value={w.id} defaultChecked />
                  {w.imageFileId && <img src={`/datei/${w.imageFileId}`} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />}
                  <Link href={`/produkte/${w.id}`}>{w.name}{w.variant ? ` · ${w.variant}` : ""}</Link>
                </label>
              ))}
              <div><button className="btn" type="submit">Zusammenführen</button></div>
            </form>
          )}
        </div>
        <aside className="col-side">
          <ImageForm action={updateProduct} className="card card-pad stack" style={{ gap: 8 }} busyLabel="Speichere …" reset={false}>
            <input type="hidden" name="productId" value={id} />
            <input type="hidden" name="back" value={back} />
            <h2>Bearbeiten</h2>
            <div className="field"><label className="label" htmlFor="nn">Name</label><input className="input" id="nn" name="name" required defaultValue={product.name} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}>
              <div className="field"><label className="label" htmlFor="nv">Variante</label><input className="input" id="nv" name="variant" defaultValue={product.variant ?? ""} /></div>
              <div className="field"><label className="label" htmlFor="np">Preis €</label><input className="input" id="np" name="price" inputMode="decimal" defaultValue={product.price !== null ? product.price.toFixed(2).replace(".", ",") : ""} /></div>
            </div>
            <div className="field"><label className="label" htmlFor="nc">Kategorie</label><input className="input" id="nc" name="category" list="spenden-kategorien" defaultValue={product.category} /></div>
            <div className="field"><label className="label" htmlFor="nt">Notiz</label><textarea className="input" id="nt" name="note" rows={2} defaultValue={product.note ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="ni">{product.imageFileId ? "Foto ersetzen" : "Foto"}</label><input className="input" id="ni" name="image" type="file" accept="image/*" /></div>
            {product.imageFileId && <label className="small"><input type="checkbox" name="removeImage" /> Foto entfernen</label>}
            <label className="small"><input type="checkbox" name="archived" defaultChecked={product.archived} /> Archiviert (wird bei der Auswahl nicht mehr angeboten)</label>
            <button className="btn btn-primary" type="submit">Speichern</button>
          </ImageForm>
          <details className="small">
            <summary className="muted" style={{ cursor: "pointer" }}>Produkt löschen …</summary>
            <form action={deleteProduct} style={{ marginTop: 6 }}>
              <input type="hidden" name="productId" value={id} />
              <button className="btn btn-small" type="submit" style={{ color: "var(--danger)" }}>Löschen</button>
              <span className="muted"> War es schon in einer Verteilung, wird es nur archiviert.</span>
            </form>
          </details>
        </aside>
      </div>
    </>
  );
}
