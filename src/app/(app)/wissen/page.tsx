import Link from "next/link";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/numbers";
import { KNOWLEDGE_CATEGORIES, SNIPPET_CATEGORIES } from "@/lib/knowledge/categories";

export default async function WissenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kat?: string }>;
}) {
  const session = await requireSession();
  const { q = "", kat } = await searchParams;
  const K = schema.knowledgeEntries;
  const query = q.trim();

  const where = [eq(K.tenantId, session.tenantId)];
  if (kat) where.push(eq(K.category, kat));
  const doc = sql`to_tsvector('german', ${K.title} || ' ' || ${K.body})`;
  if (query) {
    where.push(
      sql`(${doc} @@ websearch_to_tsquery('german', ${query}) or ${K.title} ilike ${"%" + query + "%"} or ${query} = any(${K.tags}))`,
    );
  }

  const [entries, counts] = await Promise.all([
    db
      .select({ id: K.id, title: K.title, category: K.category, kind: K.kind, body: K.body, tags: K.tags, updatedAt: K.updatedAt })
      .from(K)
      .where(and(...where))
      .orderBy(
        ...(query ? [desc(sql`ts_rank(${doc}, websearch_to_tsquery('german', ${query}))`)] : []),
        desc(K.updatedAt),
      )
      .limit(100),
    db.select({ category: K.category, n: count() }).from(K).where(eq(K.tenantId, session.tenantId)).groupBy(K.category),
  ]);
  const countOf = new Map(counts.map((c) => [c.category, c.n]));
  const total = counts.reduce((a, c) => a + c.n, 0);

  const catLink = (c?: string) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (c) p.set("kat", c);
    const s = p.toString();
    return s ? `/wissen?${s}` : "/wissen";
  };

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1 style={{ flexShrink: 0 }}>Wissen</h1>
        <form action="/wissen" style={{ flexGrow: 1, maxWidth: 720 }}>
          {kat && <input type="hidden" name="kat" value={kat} />}
          <label htmlFor="wq" className="sr-only">Wissen durchsuchen</label>
          <input id="wq" name="q" type="search" className="input" defaultValue={query} placeholder="Durchsuchen: „fehlende Einheiten“, „Kleinpaket“, „A-bis-Z“ …" style={{ height: 46, fontSize: 15, borderWidth: 2, borderColor: "var(--accent)" }} />
        </form>
        <Link className="btn" href="/wissen/recherche" style={{ height: 46 }}>Themen-Recherche</Link>
        <Link className="btn btn-primary" href="/wissen/neu" style={{ height: 46 }}>+ Neuer Eintrag</Link>
      </div>

      <div className="kb">
        <aside className="card" style={{ padding: "14px 10px" }}>
          <Link className={`kb-cat${!kat ? " active" : ""}`} href={catLink()}>
            <span>Alle</span><span className="num muted">{total}</span>
          </Link>
          <div className="nav-head" style={{ padding: "12px 10px 6px" }}>Bereiche</div>
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <Link key={c} className={`kb-cat${kat === c ? " active" : ""}`} href={catLink(c)}>
              <span>{c}</span><span className="num muted">{countOf.get(c) ?? 0}</span>
            </Link>
          ))}
          <div className="nav-head" style={{ padding: "12px 10px 6px" }}>Textbausteine</div>
          {SNIPPET_CATEGORIES.map((c) => (
            <Link key={c} className={`kb-cat${kat === c ? " active" : ""}`} href={catLink(c)}>
              <span>{c}</span><span className="num muted">{countOf.get(c) ?? 0}</span>
            </Link>
          ))}
        </aside>

        <section className="card" style={{ overflow: "hidden" }}>
          <div className="card-head">
            <h2>{query ? `Treffer für „${query}“` : (kat ?? "Alle Einträge")}</h2>
            <span className="small muted">{entries.length} Einträge</span>
          </div>
          {entries.length === 0 && <div className="card-pad muted">Keine Einträge gefunden.</div>}
          {entries.map((e) => (
            <Link key={e.id} href={`/wissen/${e.id}`} style={{ display: "block", padding: "14px 20px", borderBottom: "1px solid var(--row)", color: "inherit", textDecoration: "none" }}>
              <div className="between">
                <span style={{ fontWeight: 600, fontSize: 15 }}>{e.title}</span>
                <span className={`tag ${e.kind === "snippet" ? "tag-info" : "tag-neutral"}`}>{e.kind === "snippet" ? "TEXTBAUSTEIN" : e.category.toUpperCase()}</span>
              </div>
              <div className="small muted" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.body.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").slice(0, 180) || "–"}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {e.category} · aktualisiert {formatDate(e.updatedAt.toISOString())}
                {e.tags.length > 0 && ` · ${e.tags.join(", ")}`}
              </div>
            </Link>
          ))}
        </section>
      </div>
    </>
  );
}
