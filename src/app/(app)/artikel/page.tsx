import Link from "next/link";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { brandAllowed } from "@/lib/auth/areas";
import { visibleBrands } from "@/lib/brands/access";
import { formatEuro } from "@/lib/numbers";
import { createArticleAction } from "./actions";

const STATUS: Record<string, [string, string]> = { entwurf: ["ENTWURF", "tag-neutral"], aktiv: ["AKTIV", "tag-ok"], archiv: ["ARCHIV", "tag-neutral"] };

export default async function ArtikelPage({ searchParams }: { searchParams: Promise<{ marke?: string; q?: string; status?: string }> }) {
  const session = await requireArea("artikel");
  const sp = await searchParams;
  const t = session.tenantId;
  const brands = await visibleBrands(session);
  const A = schema.articles;
  const where: SQL[] = [eq(A.tenantId, t)];
  if (sp.marke) where.push(eq(A.brandId, sp.marke));
  if (sp.status && ["entwurf", "aktiv", "archiv"].includes(sp.status)) where.push(eq(A.status, sp.status as "entwurf"));
  if (sp.q?.trim()) where.push(sql`(${A.title} ilike ${`%${sp.q.trim()}%`} or ${A.sku} ilike ${`%${sp.q.trim()}%`} or ${A.ean} = ${sp.q.trim()} or ${A.asin} = ${sp.q.trim().toUpperCase()})`);
  const rows = (
    await db
      .select({ a: A, brand: schema.brands.name, image: sql<string | null>`(select i.file_id from article_images i where i.article_id = ${A.id} order by i.position, i.created_at limit 1)` })
      .from(A)
      .leftJoin(schema.brands, eq(schema.brands.id, A.brandId))
      .where(and(...where))
      .orderBy(desc(A.updatedAt), asc(A.sku))
      .limit(500)
  ).filter((r) => !r.a.brandId || brandAllowed(session.brandIds, session.role, r.a.brandId));

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Artikelstamm</h1><div className="small muted">Eigene Produkte an einem Ort: Stammdaten, Bilder, Texte, Pflichtangaben und der Stand bei Amazon und eBay.</div></div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/artikel" className={`chip${!sp.marke && !sp.status ? " active" : ""}`}>Alle</Link>
        {brands.map((b) => <Link key={b.id} href={`/artikel?marke=${b.id}`} className={`chip${sp.marke === b.id ? " active" : ""}`}>{b.name}</Link>)}
        {(["entwurf", "aktiv", "archiv"] as const).map((st) => <Link key={st} href={`/artikel?status=${st}${sp.marke ? `&marke=${sp.marke}` : ""}`} className={`chip${sp.status === st ? " active" : ""}`}>{STATUS[st][0].toLowerCase()}</Link>)}
        <form style={{ marginLeft: "auto" }}><input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="SKU, Titel, EAN, ASIN …" style={{ width: 220 }} /></form>
      </div>
      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th></th><th>Artikel</th><th>Marke</th><th>EAN / ASIN</th><th className="right">VK</th><th>Amazon</th><th>eBay</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="muted">Noch keine Artikel. Ideen landen hier automatisch, sobald sie auf „Umsetzen“ oder „Live“ gehen – oder rechts von Hand anlegen.</td></tr>}
              {rows.map(({ a, brand, image }) => (
                <tr key={a.id}>
                  <td style={{ width: 52 }}>{image && <img src={`/datei/${image}`} alt="" width={44} height={44} style={{ objectFit: "contain", borderRadius: 6, background: "#fff" }} />}</td>
                  <td style={{ maxWidth: 360 }}>
                    <Link href={`/artikel/${a.id}`} style={{ fontWeight: 600 }}>{a.title}</Link>
                    <div className="small muted num">{a.sku}</div>
                  </td>
                  <td className="small">{brand ?? "–"}</td>
                  <td className="num small">{a.ean ?? (a.gtinExempt ? "GTIN-befreit" : "–")}{a.asin && <div><a href={`https://www.amazon.de/dp/${a.asin}`} target="_blank" rel="noopener noreferrer">{a.asin}</a></div>}</td>
                  <td className="num right">{formatEuro(a.price)}</td>
                  <td className="small">{a.amazon.status ?? (a.amazon.lastCheck ? `geprüft: ${a.amazon.lastCheck.status}` : "–")}</td>
                  <td className="small">{a.ebay.attemptId ? <Link href={`/ebay?ansicht=vorschau&id=${a.ebay.attemptId}`}>Entwurf #{a.ebay.attemptId}</Link> : "–"}</td>
                  <td><span className={`tag ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          <form action={createArticleAction} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Neuer Artikel</h2>
            <input className="input" name="title" required placeholder="z. B. Grulu Sauer-Challenge Box" aria-label="Titel" />
            <select className="select" name="brandId" aria-label="Marke" defaultValue={sp.marke ?? brands[0]?.id ?? ""}>
              <option value="">ohne Marke</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn btn-primary" type="submit">Anlegen</button>
            <div className="small muted">Aus dem Ideen-Board: Idee auf „Umsetzen“ setzen oder „In Artikelstamm übernehmen“ – Inhalt, Preis und Einkauf kommen mit.</div>
          </form>
        </aside>
      </div>
    </>
  );
}
