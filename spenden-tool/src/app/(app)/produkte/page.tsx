import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { knownCategories, searchProducts } from "@/lib/service";
import { formatDate, formatEuro } from "@/lib/numbers";
import { createProduct } from "@/app/(app)/actions";
import { ImageForm } from "@/components/image-form";

export default async function SpendenProduktePage({ searchParams }: { searchParams: Promise<{ q?: string; kat?: string; archiv?: string }> }) {
  await requireLogin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const kat = (sp.kat ?? "").trim();
  const archiv = sp.archiv === "1";
  const [products, categories] = await Promise.all([
    searchProducts({ q, category: kat, archived: archiv }),
    knownCategories(),
  ]);
  const link = (o: { kat?: string; archiv?: boolean }) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (o.kat) u.set("kat", o.kat);
    if (o.archiv) u.set("archiv", "1");
    const s = u.toString();
    return `/produkte${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <datalist id="spenden-kategorien">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="page-head">
        <div><h1>Produkte</h1><div className="small muted">Wiederkehrende Spendenprodukte mit Foto und zuletzt verwendetem Preis</div></div>
        <form style={{ display: "flex", gap: 6 }}>
          {kat && <input type="hidden" name="kat" value={kat} />}
          <input className="input" name="q" defaultValue={q} placeholder="Suchen …" aria-label="Produkte suchen" style={{ width: 220 }} />
          <button className="btn" type="submit">Suchen</button>
        </form>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={link({ archiv })} className={`chip${!kat ? " active" : ""}`}>Alle</Link>
        {categories.map((c) => <Link key={c} href={link({ kat: c, archiv })} className={`chip${kat === c ? " active" : ""}`}>{c}</Link>)}
        <Link href={link({ kat, archiv: !archiv })} className={`chip${archiv ? " active" : ""}`}>Archiv</Link>
      </div>
      <div className="row">
        <section style={{ flexGrow: 1, minWidth: 0 }}>
          {products.length === 0 && <div className="card card-pad muted">Keine Produkte gefunden.</div>}
          <div className="spenden-grid">
            {products.map(({ p, times, lastUsed }) => (
              <Link key={p.id} href={`/produkte/${p.id}`} className="card spenden-tile">
                {p.imageFileId ? <img src={`/datei/${p.imageFileId}`} alt="" loading="lazy" /> : <span className="spenden-noimg">kein Foto</span>}
                <span style={{ padding: "8px 10px" }}>
                  <strong style={{ display: "block" }}>{p.name}</strong>
                  {p.variant && <span className="small">{p.variant}</span>}
                  <span style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }} className="small muted">
                    <span>{times ? `${times}× · ${formatDate(lastUsed)}` : "noch nie dabei"}</span>
                    <span className="num" style={{ color: "var(--ink)" }}>{p.price !== null ? formatEuro(p.price) : ""}</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
        <aside className="col-side">
          <ImageForm action={createProduct} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Neues Produkt</h2>
            <div className="field"><label className="label" htmlFor="nn">Name</label><input className="input" id="nn" name="name" required /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8 }}>
              <div className="field"><label className="label" htmlFor="nv">Variante</label><input className="input" id="nv" name="variant" placeholder="z. B. 8er Pack" /></div>
              <div className="field"><label className="label" htmlFor="np">Preis €</label><input className="input" id="np" name="price" inputMode="decimal" /></div>
            </div>
            <div className="field"><label className="label" htmlFor="nc">Kategorie</label><input className="input" id="nc" name="category" list="spenden-kategorien" defaultValue={kat || "Lebensmittel"} /></div>
            <input className="input" name="image" type="file" accept="image/*" aria-label="Foto" />
            <button className="btn btn-primary" type="submit">Anlegen</button>
          </ImageForm>
        </aside>
      </div>
    </>
  );
}
