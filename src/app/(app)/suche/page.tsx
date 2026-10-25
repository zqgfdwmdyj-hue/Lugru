import { redirect } from "next/navigation";
import Link from "next/link";
import { rowAnchor } from "@/lib/products/logic";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { productSearch } from "@/lib/products/service";

export default async function SuchePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  // Die Suche geht über alle Bereiche – nur für Inhaber und Mitarbeiter ohne Einschränkung.
  if (session.role === "staff" && session.areas !== null) redirect("/kein-zugriff");
  const q = ((await searchParams).q ?? "").trim();
  const like = `%${q}%`;
  const L = schema.lots;
  const P = schema.products;
  const K = schema.knowledgeEntries;
  const T = schema.tasks;

  const [products, lots, knowledge, tasks] = q
    ? await Promise.all([
        productSearch(session.tenantId, q),
        db
          .select({ id: L.id, sku: L.sku, asin: P.asin, cost: L.unitCostNet })
          .from(L)
          .innerJoin(P, eq(P.id, L.productId))
          .leftJoin(schema.suppliers, eq(schema.suppliers.id, L.supplierId))
          .where(and(eq(L.tenantId, session.tenantId), or(ilike(L.sku, like), ilike(P.asin, like), ilike(P.title, like), ilike(L.fnsku, like), ilike(schema.suppliers.code, like))))
          .limit(20),
        db
          .select({ id: K.id, title: K.title, category: K.category })
          .from(K)
          .where(and(eq(K.tenantId, session.tenantId), or(ilike(K.title, like), sql`to_tsvector('german', ${K.title} || ' ' || ${K.body}) @@ websearch_to_tsquery('german', ${q})`)))
          .limit(10),
        db
          .select({ id: T.id, title: T.title, status: T.status, link: T.link })
          .from(T)
          .where(and(eq(T.tenantId, session.tenantId), or(ilike(T.title, like), ilike(T.notes, like))))
          .limit(10),
      ])
    : [{ rows: [], total: 0 }, [], [], []];
  const exact = products.rows.filter((p) => p.exact);
  const back = `/suche?q=${encodeURIComponent(q)}`;

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1 style={{ flexShrink: 0 }}>Suche</h1>
        <form action="/suche" style={{ flexGrow: 1, maxWidth: 720 }}>
          <label htmlFor="sq" className="sr-only">Suche</label>
          <input id="sq" name="q" type="search" className="input" defaultValue={q} autoFocus style={{ height: 46, fontSize: 15 }} />
        </form>
      </div>
      {!q && <div className="muted">Suchbegriff eingeben.</div>}
      {q && (
        <div className="stack" style={{ gap: 16 }}>
          {exact.length > 0 && (
            <div className="notice notice-ok" data-testid="search-exact">
              <strong>Genauer Treffer:</strong>{" "}
              {exact.map((p, i) => (
                <span key={p.key}>
                  {i > 0 && " · "}
                  <Link href={`${p.matched.length === 1 ? `/produkte/sku/${encodeURIComponent(p.matched[0])}` : p.href}?von=${encodeURIComponent(back)}`}>{p.matched.length === 1 ? p.matched[0] : p.skus[0]} – {p.title ?? "Name fehlt"}</Link>
                </span>
              ))}
            </div>
          )}
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Produkte</h2><span className="small muted">{products.total > products.rows.length ? `erste ${products.rows.length} von ${products.total} – ` : ""}<Link href={`/produkte?ansicht=alle&q=${encodeURIComponent(q)}`}>in Produkte öffnen</Link></span></div>
            {products.rows.length === 0 ? <div className="card-pad muted">Keine Treffer in SKU, Name, ASIN oder EAN.</div> : (
              <table className="table" data-testid="search-products"><tbody>
                {products.rows.map((p) => (
                  <tr key={p.key} id={rowAnchor(p.key)} data-testid="search-product" style={{ scrollMarginTop: 80 }}>
                    <td style={{ maxWidth: 380 }}>
                      <Link href={`${p.href}?von=${encodeURIComponent(`${back}#${rowAnchor(p.key)}`)}`} style={{ fontWeight: 600 }}>{p.title ?? "– Name fehlt –"}</Link>
                      {p.exact && <span className="tag tag-ok" style={{ marginLeft: 6 }}>genau</span>}
                      <div className="small muted num">{[p.asin, p.ean].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="num small">
                      {p.skus.slice(0, 6).map((s, i) => (
                        <span key={s}>{i > 0 && ", "}<Link href={`/produkte/sku/${encodeURIComponent(s)}?von=${encodeURIComponent(`${back}#${rowAnchor(p.key)}`)}`} style={p.matched.includes(s) ? { fontWeight: 700 } : undefined}>{s}</Link></span>
                      ))}
                      {p.skus.length > 6 && ` … +${p.skus.length - 6}`}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Chargen</h2><span className="small muted">{lots.length === 20 ? "erste 20" : lots.length}</span></div>
            {lots.length === 0 ? <div className="card-pad muted">Keine Treffer.</div> : (
              <table className="table"><tbody>
                {lots.map((l) => (
                  <tr key={l.id}><td className="num"><Link href={`/chargen/${l.id}`}>{l.sku}</Link></td><td className="num">{l.asin}</td><td className="num right">{l.cost ? formatEuro(l.cost) : "EK fehlt"}</td></tr>
                ))}
              </tbody></table>
            )}
          </section>
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Wissen</h2></div>
            {knowledge.length === 0 ? <div className="card-pad muted">Keine Treffer.</div> : (
              <div className="card-pad stack">{knowledge.map((k) => <Link key={k.id} href={`/wissen/${k.id}`}>{k.title} <span className="small muted">· {k.category}</span></Link>)}</div>
            )}
          </section>
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Aufgaben</h2></div>
            {tasks.length === 0 ? <div className="card-pad muted">Keine Treffer.</div> : (
              <div className="card-pad stack">{tasks.map((t) => (t.link && t.link.startsWith("/") ? <Link key={t.id} href={t.link}>{t.status === "done" ? "✓ " : ""}{t.title}</Link> : <span key={t.id}>{t.status === "done" ? "✓ " : ""}{t.title}</span>))}</div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
