import Link from "next/link";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { CONTENT_STATUS_LABEL } from "@/lib/brands/ai";
import { visibleBrands } from "@/lib/brands/access";
import { formatDate } from "@/lib/numbers";
import { deletePostAction, updatePostAction } from "../actions";
import { contentDateKind, contentPhase, isOverdue, PHASE_LABEL, PHASES, phaseOrder, postUnaccepted, type Phase } from "@/lib/brands/phases";
import { todayIso } from "@/lib/dates";
import { CopyButton, SuggestContent } from "../forms";

const PLATFORM = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" } as const;

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ marke?: string; status?: string; phase?: string }> }) {
  const session = await requireArea("marken");
  const sp = await searchParams;
  const t = session.tenantId;
  const brands = await visibleBrands(session);
  const brand = brands.find((b) => b.id === sp.marke) ?? null;
  const C = schema.contentPosts;
  const where: SQL[] = [eq(C.tenantId, t), inArray(C.brandId, brands.length ? brands.map((b) => b.id) : ["00000000-0000-0000-0000-000000000000"])];
  if (brand) where.push(eq(C.brandId, brand.id));
  const phase = PHASES.includes(sp.phase as Phase) ? (sp.phase as Phase) : null;
  if (sp.status && sp.status in CONTENT_STATUS_LABEL) where.push(eq(C.status, sp.status as (typeof schema.CONTENT_STATUSES)[number]));
  else if (phase !== "veroeffentlichung") where.push(sql`${C.status} <> 'published'`);
  const posts = await db
    .select({ p: C, idea: schema.ideas.title })
    .from(C)
    .leftJoin(schema.ideas, eq(schema.ideas.id, C.ideaId))
    .where(and(...where))
    .orderBy(sql`${C.plannedFor} asc nulls last`, desc(C.createdAt))
    .limit(200);
  const today = todayIso();
  const byPhase = (ph: Phase) => posts.filter(({ p }) => contentPhase(p.status, p.plannedFor, p.source) === ph).length;
  const shownPosts = phaseOrder(
    posts.filter(({ p }) => !phase || contentPhase(p.status, p.plannedFor, p.source) === phase).map((x) => ({ ...x, source: x.p.source, date: x.p.plannedFor, done: x.p.status === "published" || postUnaccepted(x.p.status, x.p.source) })),
    today,
  );
  const late = (p: (typeof posts)[number]["p"]) => isOverdue(p.plannedFor, p.status === "published" || postUnaccepted(p.status, p.source), today);
  // Nur ein fester Termin ist „überfällig“; ein verstrichenes Wunschdatum ist bloß ein Hinweis.
  const overdue = posts.filter(({ p }) => late(p) && contentDateKind(p.status) === "termin").length;
  const wishLate = posts.filter(({ p }) => late(p) && contentDateKind(p.status) === "wunsch").length;
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const q = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ marke: brand?.id, status: sp.status, phase: phase ?? undefined, ...p })) if (v) u.set(k, v);
    return `/marken/content${u.size ? `?${u}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/marken">Marken</Link></div><h1>Content-Plan</h1></div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        Video-Ideen mit Hook, Ablauf, Szenen, Caption und Hashtags – für TikTok, YouTube (Zeitlux) und Instagram. Drehen, schneiden, Datum eintragen: Das Datum ist zunächst ein <strong>Wunschdatum</strong> (unverbindlich); erst mit Status „Fester Termin“ wird es zum <strong>verbindlichen Veröffentlichungstermin</strong>. Beides steht im Kalender, getrennt gekennzeichnet.
        Caption und Hashtags lassen sich mit einem Klick kopieren.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={q({ marke: undefined })} className={`chip${!brand ? " active" : ""}`}>Alle Marken</Link>
        {brands.map((b) => <Link key={b.id} href={q({ marke: b.id })} className={`chip${brand?.id === b.id ? " active" : ""}`}>{b.name}</Link>)}
        <span style={{ width: 12 }} />
        <Link href={q({ status: undefined, phase: undefined })} className={`chip${!sp.status && !phase ? " active" : ""}`}>Alle offenen</Link>
        {PHASES.map((ph) => (
          <Link key={ph} href={q({ status: undefined, phase: ph })} className={`chip${phase === ph ? " active" : ""}`} data-testid={`content-phase-${ph}`}>{PHASE_LABEL[ph]}{ph !== "veroeffentlichung" || phase === ph ? ` · ${byPhase(ph)}` : ""}</Link>
        ))}
      </div>
      {(overdue > 0 || wishLate > 0) && (
        <div className="notice notice-warn" data-testid="content-overdue">
          {overdue > 0 && <div data-testid="content-overdue-termin">{overdue} Beitr{overdue === 1 ? "ag ist" : "äge sind"} überfällig (fester Veröffentlichungstermin vorbei, noch nicht veröffentlicht) – oben in der Liste.</div>}
          {wishLate > 0 && <div data-testid="content-overdue-wunsch">{wishLate} Wunschdat{wishLate === 1 ? "um" : "en"} verstrichen – unverbindlich: neues Datum eintragen oder mit „Fester Termin“ verbindlich festlegen.</div>}
        </div>
      )}
      <details className="small"><summary style={{ cursor: "pointer" }}>Nach einzelnem Status filtern</summary>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {Object.entries(CONTENT_STATUS_LABEL).map(([k, [l]]) => <Link key={k} href={q({ status: k, phase: undefined })} className={`chip${sp.status === k ? " active" : ""}`}>{l}</Link>)}
        </div>
      </details>

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          {shownPosts.length === 0 && <div className="card card-pad muted">{posts.length ? "Nichts in dieser Phase." : "Noch keine Content-Ideen in dieser Ansicht – rechts erstellen oder bei einer Idee „Video-Ideen erstellen“."}</div>}
          {shownPosts.map(({ p, idea }) => {
            const b = brandById.get(p.brandId);
            const post = [p.caption, p.hashtags].filter(Boolean).join("\n\n");
            return (
              <article key={p.id} className="card card-pad stack" style={{ gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {b && <span className="small" style={{ fontWeight: 650 }}><span className="brand-dot" style={{ background: b.color ?? "var(--area)" }} aria-hidden="true" />{b.name}</span>}
                  <span className="tag tag-neutral">{PHASE_LABEL[contentPhase(p.status, p.plannedFor, p.source)]}</span>
                  <span className={`tag ${CONTENT_STATUS_LABEL[p.status][1]}`}>{CONTENT_STATUS_LABEL[p.status][0]}</span>
                  {late(p) && (contentDateKind(p.status) === "termin" ? <span className="tag tag-danger" data-testid="content-late">überfällig</span> : <span className="tag tag-warn" data-testid="content-wish-late">Wunschdatum verstrichen</span>)}
                  {p.source === "ai" && <span className="tag tag-neutral">KI-Vorschlag</span>}
                  <span className="tag tag-neutral">{PLATFORM[p.platform]}</span>
                  {p.format && <span className="small muted">{p.format}</span>}
                  <span className="small muted" style={{ marginLeft: "auto" }} data-testid="content-date">
                    {idea ?? ""}
                    {p.plannedFor ? (contentDateKind(p.status) === "termin" ? <>{idea ? " · " : ""}<strong style={{ color: "var(--ink)" }} data-kind="termin">Veröffentlichung am {formatDate(p.plannedFor)} (fester Termin)</strong></> : <span data-kind="wunsch">{idea ? " · " : ""}Wunschdatum {formatDate(p.plannedFor)} (unverbindlich)</span>) : p.status === "scheduled" ? <span data-kind="termin-fehlt" style={{ color: "var(--danger)" }}>{idea ? " · " : ""}Fester Termin ohne Datum – bitte eintragen</span> : ""}
                  </span>
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
                  <label className="small muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    {contentDateKind(p.status) === "termin" ? "Veröffentlichung am" : "Wunschdatum"}
                    <input className="input" type="date" name="plannedFor" defaultValue={p.plannedFor ?? ""} style={{ width: "auto" }} aria-label={contentDateKind(p.status) === "termin" ? "Veröffentlichung am (fester Termin)" : "Wunschdatum (unverbindlich)"} />
                  </label>
                  <input className="input" name="publishedUrl" defaultValue={p.publishedUrl ?? ""} placeholder="Link zum Video (nach dem Posten)" style={{ flex: "1 1 180px" }} />
                  <button className="btn btn-primary btn-small" type="submit">Speichern</button>
                </form>
                <form action={deletePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn-link small danger" type="submit">Löschen</button></form>
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
