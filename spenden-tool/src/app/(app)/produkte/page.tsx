import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { duplicatePhotoGroups, knownCategories, PRODUCT_FILTERS, type ProductFilter, searchProducts } from "@/lib/service";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { formatDate, formatEuro } from "@/lib/numbers";
import { createProduct, mergeProducts, resolveLegacyCategories, setProductCategory } from "@/app/(app)/actions";
import { categoryHint, LEGACY_CATEGORIES } from "@/lib/price-logic";
import { isPlaceholderName } from "@/lib/layout";
import { ImageForm } from "@/components/image-form";
import { CategorySelect } from "@/components/category-select";
import { UNSORTED_CATEGORY } from "@/lib/price-logic";

type SP = { q?: string; kat?: string; archiv?: string; doppelt?: string; ansicht?: string; filter?: string };

export default async function SpendenProduktePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireLogin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const kat = (sp.kat ?? "").trim();
  const archiv = sp.archiv === "1";
  const list = sp.ansicht === "liste";
  const filter = (sp.filter && sp.filter in PRODUCT_FILTERS ? sp.filter : null) as ProductFilter | null;
  const katPruefen = sp.filter === "kategorie";
  const [products, categories, all] = await Promise.all([
    searchProducts({ q, category: kat, archived: archiv, filter }),
    knownCategories(),
    db.select({ id: schema.products.id, name: schema.products.name, variant: schema.products.variant, category: schema.products.category, categoryChecked: schema.products.categoryChecked, imageFileId: schema.products.imageFileId }).from(schema.products).where(eq(schema.products.archived, false)),
  ]);
  // Alte Bestände mit auffälliger Kategorie – auch Produkte, die noch in keiner Verteilung waren. Nur Vorschläge.
  const catIssues = all
    .filter((p) => !isPlaceholderName(p.name))
    .map((p) => ({ p, hint: categoryHint(p) }))
    .filter((x): x is { p: (typeof all)[number]; hint: NonNullable<ReturnType<typeof categoryHint>> } => !!x.hint)
    .sort((a, b) => a.p.category.localeCompare(b.p.category, "de") || a.p.name.localeCompare(b.p.name, "de"));
  // Alte Sammelkategorien (Vorschau, wohin sie verteilt würden – ohne KI-Kategorie, die kommt beim Auflösen dazu)
  const legacy = all.filter((p) => (LEGACY_CATEGORIES as readonly string[]).includes(p.category));
  const legacyNames = [...new Set(legacy.map((p) => p.category))];
  const legacyPreview = new Map<string, number>();
  for (const p of legacy) {
    const h = categoryHint({ ...p, categoryChecked: false });
    const t = h && !(LEGACY_CATEGORIES as readonly string[]).includes(h.suggest) ? h.suggest : "Drogerie";
    legacyPreview.set(t, (legacyPreview.get(t) ?? 0) + 1);
  }
  // Produkte mit (fast) demselben Foto – nur berechnen, wenn die Ansicht geöffnet ist (vergleicht alle Fotos).
  const doppelt = sp.doppelt === "1";
  const groups = doppelt ? await duplicatePhotoGroups() : [];
  const groupProducts = doppelt && groups.length
    ? new Map((await db.select().from(schema.products).where(inArray(schema.products.id, groups.flat()))).map((p) => [p.id, p]))
    : new Map();
  const link = (o: Partial<SP>) => {
    const cur: SP = { q: q || undefined, kat: kat || undefined, archiv: archiv ? "1" : undefined, ansicht: list ? "liste" : undefined, filter: filter ?? undefined };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...o })) if (v) u.set(k, v);
    const s = u.toString();
    return `/produkte${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="page-head">
        <div><h1>Produkte</h1><div className="small muted">Wiederkehrende Spendenprodukte mit Foto, zuletzt verwendetem Preis und Verlauf</div></div>
        <div className="view-switch" role="group" aria-label="Ansicht">
          <Link href={link({ ansicht: undefined })} className={`chip${!list ? " active" : ""}`}>▦ Bilder</Link>
          <Link href={link({ ansicht: "liste" })} className={`chip${list ? " active" : ""}`}>☰ Liste</Link>
        </div>
      </div>

      <div className="db-toolbar">
        <form className="db-search">
          {kat && <input type="hidden" name="kat" value={kat} />}
          {archiv && <input type="hidden" name="archiv" value="1" />}
          {list && <input type="hidden" name="ansicht" value="liste" />}
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Name, Variante, Notiz …" aria-label="Produkte suchen" />
          <button className="btn" type="submit">Suchen</button>
        </form>
        <form className="db-cat">
          {q && <input type="hidden" name="q" value={q} />}
          {archiv && <input type="hidden" name="archiv" value="1" />}
          {list && <input type="hidden" name="ansicht" value="liste" />}
          {filter && <input type="hidden" name="filter" value={filter} />}
          <select className="select" name="kat" defaultValue={kat} aria-label="Kategorie">
            <option value="">Alle Kategorien</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn" type="submit">Filtern</button>
        </form>
        <details className="db-new">
          <summary className="btn btn-primary">+ Neues Produkt</summary>
          <ImageForm action={createProduct} className="card card-pad stack db-new-form" style={{ gap: 8 }}>
            <div className="field"><label className="label" htmlFor="nn">Name</label><input className="input" id="nn" name="name" placeholder="leer lassen = KI erkennt vom Foto" /></div>
            <div className="form-grid">
              <div className="field"><label className="label" htmlFor="nv">Variante / Größe</label><input className="input" id="nv" name="variant" placeholder="z. B. 8er Pack, 500 g" /></div>
              <div className="field"><label className="label" htmlFor="np">Spendenempfehlung €</label><input className="input" id="np" name="price" inputMode="decimal" /></div>
            </div>
            <div className="field"><label className="label" htmlFor="nc">Kategorie</label><CategorySelect id="nc" name="category" value={kat || UNSORTED_CATEGORY} categories={categories} /></div>
            <div className="field"><label className="label" htmlFor="ni">Fotos (optional, mehrere möglich)</label><input className="input" id="ni" name="image" type="file" accept="image/*" multiple /><span className="small muted">Vorder- und Rückseite (mit MHD) – die KI nimmt die Vorderseite als Titelbild und füllt Name, Größe und Kategorie aus. Mit Fotos darf der Name leer bleiben.</span></div>
            <button className="btn btn-primary" type="submit">Anlegen</button>
          </ImageForm>
        </details>
      </div>
      <div className="summary-chips">
        <Link href={link({ filter: undefined, archiv: undefined })} className={`chip${!filter && !archiv && !doppelt ? " active" : ""}`}>Alle</Link>
        {(Object.entries(PRODUCT_FILTERS) as [ProductFilter, string][]).map(([k, label]) => (
          <Link key={k} href={link({ filter: filter === k ? undefined : k })} className={`chip${filter === k ? " active" : ""}`}>{label}</Link>
        ))}
        <Link href={katPruefen ? "/produkte" : "/produkte?filter=kategorie"} className={`chip${katPruefen ? " active" : ""}`}>Kategorie prüfen ({catIssues.length})</Link>
        <Link href={link({ archiv: archiv ? undefined : "1" })} className={`chip${archiv ? " active" : ""}`}>Archiv</Link>
        <Link href={doppelt ? "/produkte" : "/produkte?doppelt=1"} className={`chip${doppelt ? " active" : ""}`}>Mögliche Doppelte{doppelt ? ` (${groups.length})` : ""}</Link>
        <span className="small muted" style={{ alignSelf: "center" }}>{products.length}{products.length >= 500 ? "+" : ""} Produkte{kat ? ` in „${kat}“` : ""}</span>
      </div>

      {doppelt && (
        <section className="stack">
          <div className="small muted">Produkte mit (fast) demselben Foto. Beim Zusammenführen bleibt das links stehende Produkt, Verlauf und Verteilungen der angehakten werden übernommen, die angehakten gelöscht. Nur zusammenführen, was wirklich dasselbe Produkt ist.</div>
          {groups.length === 0 && <div className="card card-pad muted">Keine doppelten Fotos gefunden.</div>}
          {groups.map((g) => {
            const items = g.map((id) => groupProducts.get(id)).filter((p): p is NonNullable<typeof p> => !!p).sort((a, b) => +a.createdAt - +b.createdAt);
            if (items.length < 2) return null;
            const [keep, ...rest] = items;
            return (
              <form key={keep.id} action={mergeProducts} className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="productId" value={keep.id} />
                {[keep, ...rest].map((p, i) => (
                  <label key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4, width: 120 }} className="small">
                    {p.imageFileId && <img src={`/datei/${p.imageFileId}?w=400`} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 6 }} />}
                    <span>{i === 0 ? "bleibt" : <><input type="checkbox" name="mergeId" value={p.id} defaultChecked /> zusammenführen</>}</span>
                    <Link href={`/produkte/${p.id}`}><strong>{p.name}</strong>{p.variant ? ` · ${p.variant}` : ""}</Link>
                  </label>
                ))}
                <button className="btn btn-primary" type="submit">Zusammenführen</button>
              </form>
            );
          })}
        </section>
      )}

      {katPruefen && (
        <section className="card">
          <div className="card-head"><h2>Kategorie prüfen ({catIssues.length})</h2></div>
          <div className="small muted" style={{ padding: "8px 14px 0" }}>Alte Einträge, deren Kategorie nicht zum Produkt passt (z. B. Spielzeug unter „Lebensmittel“) oder in einer alten Sammelkategorie stehen – auch wenn sie noch in keiner Verteilung waren. Geändert wird nur auf Klick.</div>
          {legacy.length > 0 && (
            <form action={resolveLegacyCategories} className="notice notice-warn legacy-box">
              <span>
                <strong>Alte Kategorien auflösen:</strong> {legacy.length} Produkte stehen noch unter {legacyNames.map((n) => `„${n}“`).join(", ")}. Sie werden auf die neuen Kategorien verteilt – nach Produktart bzw. KI-Erkennung, sonst „Drogerie“:{" "}
                {[...legacyPreview].map(([k, n]) => `${n} → ${k}`).join(" · ")}. Danach erscheint die alte Kategorie nirgends mehr.
              </span>
              <button className="btn btn-check" type="submit">Alle {legacy.length} jetzt verteilen</button>
            </form>
          )}
          {catIssues.length === 0 && <div className="card-pad muted">Alles stimmig.</div>}
          <div className="check-list">
            {catIssues.slice(0, 50).map(({ p, hint }) => (
              <form key={p.id} className="check-row cat-row">
                {p.imageFileId ? <img src={`/datei/${p.imageFileId}?w=200`} alt="" className="thumb thumb-sm" loading="lazy" /> : <span className="thumb thumb-sm" />}
                <span className="check-text"><Link href={`/produkte/${p.id}`} className="wrap-anywhere"><strong>{p.name}</strong>{p.variant ? ` · ${p.variant}` : ""}</Link><span className="small muted">jetzt: {p.category} → Vorschlag: <strong>{hint.suggest}</strong> ({hint.reason})</span></span>
                <span className="conflict-actions">
                  <button className="btn btn-small btn-primary" formAction={setProductCategory.bind(null, p.id, hint.suggest)}>Übernehmen</button>
                  <button className="btn btn-small" formAction={setProductCategory.bind(null, p.id, null)}>Stimmt so</button>
                </span>
              </form>
            ))}
          </div>
          {catIssues.length > 50 && <div className="card-pad small muted">Die ersten 50 von {catIssues.length} – erledigte verschwinden, dann rücken die nächsten nach.</div>}
        </section>
      )}

      {!doppelt && !katPruefen && (
        <section>
          {products.length === 0 && <div className="card card-pad muted">Keine Produkte gefunden.</div>}
          {list ? (
            <div className="card db-list">
              {products.map(({ p, times, lastUsed }) => (
                <Link key={p.id} href={`/produkte/${p.id}`} className="db-row">
                  {p.imageFileId ? <img src={`/datei/${p.imageFileId}?w=200`} alt="" className="thumb thumb-sm" loading="lazy" /> : <span className="thumb thumb-sm thumb-empty">–</span>}
                  <span className="db-name"><strong>{p.name}</strong>{p.variant ? <span className="muted"> · {p.variant}</span> : null}</span>
                  <span className="db-meta">
                    <span className="small muted db-cat-col">{p.category}</span>
                    <span className="small muted db-used">{times ? `${times}× · ${formatDate(lastUsed)}` : "noch nie dabei"}</span>
                    <span className="db-flags">{p.reviewNote && <span className="tag tag-info">KI prüfen</span>}{p.category === UNSORTED_CATEGORY && <span className="tag tag-warn">Kategorie</span>}</span>
                  </span>
                  <span className="num db-price">{p.price !== null ? formatEuro(p.price) : <span className="tag tag-warn">ohne Preis</span>}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="spenden-grid">
              {products.map(({ p, times, lastUsed }) => (
                <Link key={p.id} href={`/produkte/${p.id}`} className="card spenden-tile">
                  {p.imageFileId ? <img src={`/datei/${p.imageFileId}?w=400`} alt="" loading="lazy" /> : <span className="spenden-noimg">kein Foto</span>}
                  <span style={{ padding: "8px 10px" }}>
                    <strong style={{ display: "block", overflowWrap: "anywhere" }}>{p.name}</strong>
                    {p.variant && <span className="small">{p.variant}</span>}
                    {(p.reviewNote || p.category === UNSORTED_CATEGORY) && <span style={{ display: "block", marginTop: 4 }}>{p.reviewNote && <span className="tag tag-info">KI prüfen</span>} {p.category === UNSORTED_CATEGORY && <span className="tag tag-warn">Kategorie offen</span>}</span>}
                    <span style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }} className="small muted">
                      <span>{times ? `${times}× · ${formatDate(lastUsed)}` : "noch nie dabei"}</span>
                      <span className="num" style={{ color: "var(--ink)" }}>{p.price !== null ? formatEuro(p.price) : "–"}</span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
