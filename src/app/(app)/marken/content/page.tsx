import Link from "next/link";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { CONTENT_STATUS_LABEL } from "@/lib/brands/ai";
import { listBrands } from "@/lib/brands/service";
import { formatDate } from "@/lib/numbers";
import { deletePostAction, updatePostAction } from "../actions";
import { CopyButton, SuggestContent } from "../forms";

const PLATFORM = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" } as const;

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ marke?: string; status?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const t = session.tenantId;
  const brands = await listBrands(t);
  const brand = brands.find((b) => b.id === sp.marke) ?? null;
  const C = schema.contentPosts;
  const where: SQL[] = [eq(C.tenantId, t)];
  if (brand) where.push(eq(C.brandId, brand.id));
  if (sp.status && sp.status in CONTENT_STATUS_LABEL) where.push(eq(C.status, sp.status as (typeof schema.CONTENT_STATUSES)[number]));
  else where.push(sql`${C.status} <> 'published'`);
  const posts = await db
    .select({ p: C, idea: schema.ideas.title })
    .from(C)
    .leftJoin(schema.ideas, eq(schema.ideas.id, C.ideaId))
    .where(and(...where))
    .orderBy(sql`${C.plannedFor} asc nulls last`, desc(C.createdAt))
    .limit(200);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const q = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ marke: brand?.id, status: sp.status, ...p })) if (v) u.set(k, v);
    return `/marken/content${u.size ? `?${u}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/marken">Marken</Link></div><h1>Content-Plan</h1></div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        Video-Ideen mit Hook, Ablauf, Szenen, Caption und Hashtags – für TikTok, YouTube (Zeitlux) und Instagram. Drehen, schneiden, Datum eintragen: geplante Posts stehen im Kalender.
        Caption und Hashtags lassen sich mit einem Klick kopieren.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={q({ marke: undefined })} className={`chip${!brand ? " active" : ""}`}>Alle Marken</Link>
        {brands.map((b) => <Link key={b.id} href={q({ marke: b.id })} className={`chip${brand?.id === b.id ? " active" : ""}`}>{b.name}</Link>)}
        <span style={{ width: 12 }} />
        <Link href={q({ status: undefined })} className={`chip${!sp.status ? " active" : ""}`}>Offen</Link>
        {Object.entries(CONTENT_STATUS_LABEL).map(([k, [l]]) => <Link key={k} href={q({ status: k })} className={`chip${sp.status === k ? " active" : ""}`}>{l}</Link>)}
      </div>

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          {posts.length === 0 && <div className="card card-pad muted">Noch keine Content-Ideen in dieser Ansicht – rechts erstellen oder bei einer Idee „Video-Ideen erstellen“.</div>}
          {posts.map(({ p, idea }) => {
            const b = brandById.get(p.brandId);
            const post = [p.caption, p.hashtags].filter(Boolean).join("\n\n");
            return (
              <article key={p.id} className="card card-pad stack" style={{ gap: 8, borderLeft: `4px solid ${b?.color ?? "var(--accent)"}` }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`tag ${CONTENT_STATUS_LABEL[p.status][1]}`}>{CONTENT_STATUS_LABEL[p.status][0]}</span>
                  <span className="tag tag-neutral">{PLATFORM[p.platform]}</span>
                  {p.format && <span className="small muted">{p.format}</span>}
                  <span className="small muted" style={{ marginLeft: "auto" }}>{b?.name}{idea ? ` · ${idea}` : ""}{p.plannedFor ? ` · geplant ${formatDate(p.plannedFor)}` : ""}</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>„{p.hook}“</div>
                {(p.script || p.shots.length > 0) && (
                  <details className="small">
                    <summary style={{ cursor: "pointer" }}>Ablauf und Szenen</summary>
                    {p.script && <div style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{p.script}</div>}
                    {p.shots.length > 0 && <ol style={{ margin: 0, paddingLeft: 18 }}>{p.shots.map((s, n) => <li key={n}>{s}</li>)}</ol>}
                    {p.soundIdea && <div className="muted" style={{ marginTop: 6 }}>Sound: {p.soundIdea}</div>}
                  </details>
                )}
                {post && (
                  <div className="snippet small" style={{ whiteSpace: "pre-wrap", maxWidth: "none" }}>
                    {post}
                    <div style={{ marginTop: 6 }}><CopyButton text={post} label="Caption + Hashtags kopieren" /></div>
                  </div>
                )}
                <form action={updatePostAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <input type="hidden" name="id" value={p.id} />
                  <select className="input" name="status" defaultValue={p.status} style={{ width: "auto" }} aria-label="Status">
                    {Object.entries(CONTENT_STATUS_LABEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input className="input" type="date" name="plannedFor" defaultValue={p.plannedFor ?? ""} style={{ width: "auto" }} aria-label="Geplant für" />
                  <input className="input" name="publishedUrl" defaultValue={p.publishedUrl ?? ""} placeholder="Link zum Video (nach dem Posten)" style={{ flex: "1 1 180px" }} />
                  <button className="btn btn-small" type="submit">Speichern</button>
                </form>
                <form action={deletePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn-link small muted" type="submit">Löschen</button></form>
              </article>
            );
          })}
        </div>
        <aside className="col-side">
          {(brand ? [brand] : brands).map((b) => (
            <section key={b.id} className="card card-pad stack">
              <h2>{b.name}: neue Video-Ideen</h2>
              <SuggestContent brandId={b.id} withTopic />
            </section>
          ))}
          <section className="card card-pad small muted stack">
            <strong style={{ color: "var(--ink)" }}>Automatisch hochladen?</strong>
            <div>TikTok erlaubt das automatische Posten nur über eine eigene, von TikTok geprüfte App (Content Posting API). Bis dahin: Skript drehen, im TikTok-Editor schneiden, Caption hier kopieren. Details siehe Testanleitung.</div>
          </section>
        </aside>
      </div>
    </>
  );
}
