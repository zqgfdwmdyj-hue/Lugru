import Link from "next/link";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/numbers";
import { KNOWLEDGE_CATEGORIES, SNIPPET_CATEGORIES } from "@/lib/knowledge/categories";
import { isFailedResearchBody } from "@/lib/research/summary";

const ORIGIN = {
  anleitung: { label: "Anleitung", cls: "tag-ok" },
  notiz: { label: "Eigene Notiz", cls: "tag-neutral" },
  recherche: { label: "Recherche (automatisch, ungeprüft)", cls: "tag-warn" },
} as const;
type Origin = keyof typeof ORIGIN;
type Area = "wissen" | "anleitung" | "notiz" | "recherche" | "alle";
const AREA_LABEL: Record<Area, string> = { wissen: "Anleitungen & Notizen", anleitung: "Anleitungen", notiz: "Eigene Notizen", recherche: "Automatische Recherche", alle: "Alles" };
const AREAS = Object.keys(AREA_LABEL) as Area[];

export default async function WissenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kat?: string; herkunft?: string; bereich?: string; nur?: string }>;
}) {
  const session = await requireSession();
  const { q = "", kat, herkunft: rawOrigin, bereich: rawArea, nur } = await searchParams;
  // Alte Links mit ?herkunft=… landen im passenden Einstieg.
  const herkunft = rawOrigin && rawOrigin in ORIGIN ? (rawOrigin as Origin) : null;
  const K = schema.knowledgeEntries;
  const query = q.trim();
  // Getrennte Einstiege: Anleitungen & Notizen (Standard), nur Anleitungen, nur Notizen, automatische Recherche, alles (Suche).
  const bereich: Area = rawArea && (AREAS as string[]).includes(rawArea) ? (rawArea as Area) : herkunft ? herkunft : kat === "Recherche" ? "recherche" : query || kat ? "alle" : "wissen";

  const where = [eq(K.tenantId, session.tenantId)];
  if (bereich === "wissen") where.push(sql`${K.origin} <> 'recherche'`);
  if (bereich === "anleitung" || bereich === "notiz" || bereich === "recherche") where.push(eq(K.origin, bereich));
  if (kat) where.push(eq(K.category, kat));
  const doc = sql`to_tsvector('german', ${K.title} || ' ' || ${K.body})`;
  if (query) {
    where.push(
      sql`(${doc} @@ websearch_to_tsquery('german', ${query}) or ${K.title} ilike ${"%" + query + "%"} or ${query} = any(${K.tags}))`,
    );
  }

  const [entries, counts, origins] = await Promise.all([
    db
      .select({ id: K.id, title: K.title, category: K.category, kind: K.kind, body: K.body, tags: K.tags, updatedAt: K.updatedAt, origin: K.origin, verifiedAt: K.verifiedAt })
      .from(K)
      .where(and(...where))
      .orderBy(
        ...(query ? [desc(sql`ts_rank(${doc}, websearch_to_tsquery('german', ${query}))`)] : []),
        // Verbindliches zuerst: Anleitungen, dann eigene Notizen, automatische Recherche zuletzt.
        sql`case ${K.origin} when 'anleitung' then 0 when 'notiz' then 1 else 2 end`,
        desc(K.updatedAt),
      )
      .limit(100),
    db.select({ category: K.category, n: count() }).from(K).where(eq(K.tenantId, session.tenantId)).groupBy(K.category),
    db.select({ origin: K.origin, n: count() }).from(K).where(eq(K.tenantId, session.tenantId)).groupBy(K.origin),
  ]);
  const originCount = new Map(origins.map((o) => [o.origin, o.n]));
  const areaCount: Record<Area, number> = { wissen: (originCount.get("anleitung") ?? 0) + (originCount.get("notiz") ?? 0), anleitung: originCount.get("anleitung") ?? 0, notiz: originCount.get("notiz") ?? 0, recherche: originCount.get("recherche") ?? 0, alle: [...originCount.values()].reduce((a, b) => a + b, 0) };
  // Fehlgeschlagene Recherche (KI hat nichts zusammengefasst) erkennbar machen und ans Ende stellen – nichts wird gelöscht.
  const withFail = entries.map((e) => ({ ...e, failed: e.origin === "recherche" && isFailedResearchBody(e.body) }));
  const failedCount = withFail.filter((e) => e.failed).length;
  const shown = (nur === "fehlgeschlagen" ? withFail.filter((e) => e.failed) : withFail).sort((a, b) => Number(a.failed) - Number(b.failed));
  const countOf = new Map(counts.map((c) => [c.category, c.n]));
  const total = counts.reduce((a, c) => a + c.n, 0);

  const catLink = (c?: string, a: Area | null = rawArea || herkunft ? bereich : null) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (c) p.set("kat", c);
    if (a) p.set("bereich", a);
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
          <div className="kb-head">Bereiche</div>
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <Link key={c} className={`kb-cat${kat === c ? " active" : ""}`} href={catLink(c)}>
              <span>{c}</span><span className="num muted">{countOf.get(c) ?? 0}</span>
            </Link>
          ))}
          <div className="kb-head">Textbausteine</div>
          {SNIPPET_CATEGORIES.map((c) => (
            <Link key={c} className={`kb-cat${kat === c ? " active" : ""}`} href={catLink(c)}>
              <span>{c}</span><span className="num muted">{countOf.get(c) ?? 0}</span>
            </Link>
          ))}
        </aside>

        <section className="card" style={{ overflow: "hidden" }}>
          <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2>{query ? `Treffer für „${query}“` : (kat ?? AREA_LABEL[bereich])}</h2>
            <span className="small muted">{shown.length} Einträge</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 20px 8px" }} data-testid="wissen-areas">
            {AREAS.map((a) => (
              <Link key={a} className={`chip${bereich === a ? " active" : ""}`} href={catLink(a === "recherche" ? undefined : kat, a)} data-testid={`wissen-area-${a}`}>{AREA_LABEL[a]} · {areaCount[a]}</Link>
            ))}
          </div>
          {bereich === "recherche" && (
            <div className="small muted" style={{ padding: "0 20px 8px" }}>
              Automatisch gefunden und ungeprüft – keine Anleitung. Wichtiges in einen eigenen Eintrag übernehmen oder als geprüft markieren.
              {failedCount > 0 && <> {" "}<Link href={nur === "fehlgeschlagen" ? catLink(undefined, "recherche") : `${catLink(undefined, "recherche")}&nur=fehlgeschlagen`} data-testid="failed-filter">{nur === "fehlgeschlagen" ? "alle zeigen" : `${failedCount} fehlgeschlagene Recherche${failedCount === 1 ? "" : "n"} zeigen`}</Link></>}
            </div>
          )}
          {shown.length === 0 && <div className="card-pad muted">{bereich === "wissen" || bereich === "anleitung" || bereich === "notiz" ? "Hier ist noch nichts – „+ Neuer Eintrag“. Automatische Recherche steht unter „Automatische Recherche“." : "Keine Einträge gefunden."}</div>}
          {shown.map((e) => (
            <Link key={e.id} href={`/wissen/${e.id}`} style={{ display: "block", padding: "14px 20px", borderBottom: "1px solid var(--row)", color: "inherit", textDecoration: "none" }}>
              <div className="between">
                <span style={{ fontWeight: 600, fontSize: 15 }}>{e.title}</span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {e.failed ? <span className="tag tag-danger" data-testid="failed-tag">Recherche fehlgeschlagen</span> : <span className={`tag ${ORIGIN[e.origin].cls}`} data-testid="origin-tag">{ORIGIN[e.origin].label}{e.verifiedAt ? " ✓ geprüft" : ""}</span>}
                  <span className={`tag ${e.kind === "snippet" ? "tag-info" : "tag-neutral"}`}>{e.kind === "snippet" ? "TEXTBAUSTEIN" : e.category.toUpperCase()}</span>
                </span>
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
