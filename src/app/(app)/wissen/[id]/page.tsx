import Link from "next/link";
import { notFound } from "next/navigation";
import { and, arrayOverlaps, eq, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { deleteEntry } from "@/lib/knowledge/actions";
import { formatDate } from "@/lib/numbers";
import { CopyButton } from "@/components/copy-button";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EintragPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const K = schema.knowledgeEntries;
  const [entry] = await db.select().from(K).where(and(eq(K.id, id), eq(K.tenantId, session.tenantId)));
  if (!entry) notFound();

  const related = await db
    .select({ id: K.id, title: K.title })
    .from(K)
    .where(
      and(
        eq(K.tenantId, session.tenantId),
        ne(K.id, entry.id),
        entry.tags.length ? or(eq(K.category, entry.category), arrayOverlaps(K.tags, entry.tags)) : eq(K.category, entry.category),
      ),
    )
    .limit(6);

  return (
    <>
      <div className="crumb">
        <Link href="/wissen">Wissen</Link> › <Link href={`/wissen?kat=${encodeURIComponent(entry.category)}`}>{entry.category}</Link>
      </div>
      <div className="row">
        <article className="card" style={{ flexGrow: 1, minWidth: 0, padding: "26px 34px" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div className="small muted">
              {entry.kind === "snippet" ? "Textbaustein" : "Wissen"} · aktualisiert am {formatDate(entry.updatedAt.toISOString())}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {entry.kind === "snippet" && <CopyButton text={entry.body} />}
              <Link className="btn btn-small" href={`/wissen/${entry.id}/bearbeiten`}>Bearbeiten</Link>
            </div>
          </div>
          <h1 className="article-title" style={{ marginTop: 10 }}>{entry.title}</h1>
          {entry.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {entry.tags.map((t) => (
                <Link key={t} href={`/wissen?q=${encodeURIComponent(t)}`} className="tag tag-neutral" style={{ textDecoration: "none" }}>{t}</Link>
              ))}
            </div>
          )}
          <div className={entry.kind === "snippet" ? "snippet article-body" : "article-body"} style={{ marginTop: 18 }}>
            {entry.body || <span className="muted">Noch kein Inhalt.</span>}
          </div>
          <form action={deleteEntry} style={{ marginTop: 28 }}>
            <input type="hidden" name="id" value={entry.id} />
            <button type="submit" className="btn-link" style={{ color: "var(--danger)", fontSize: 13 }}>Eintrag löschen</button>
          </form>
        </article>
        <aside className="col-side" style={{ width: 300 }}>
          <section className="card card-pad">
            <h2 style={{ marginBottom: 10, fontSize: 15 }}>Verwandte Einträge</h2>
            {related.length === 0 ? (
              <div className="small muted">Keine.</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {related.map((r) => <Link key={r.id} href={`/wissen/${r.id}`}>{r.title}</Link>)}
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
