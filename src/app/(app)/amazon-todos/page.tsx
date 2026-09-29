import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/amazon-todos/logic";
import { isRunning, todoStats } from "@/lib/amazon-todos/service";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { formatDate } from "@/lib/numbers";
import { saveNoteAction, setStatusAction } from "./actions";
import { ImportForm, RefreshButton } from "./forms";

const FILTERS = { offen: "Offene ToDos", alle: "Alle", erledigt: "Erledigt / Infos", ignoriert: "Ignoriert" } as const;
const SORTS = { prio: "Priorität + Frist", frist: "Frist zuerst", neu: "Eingang neu", alt: "Eingang alt" } as const;
type Filter = keyof typeof FILTERS;
type Sort = keyof typeof SORTS;

const PRIO_LABEL = { high: ["Hoch", "tag-danger"], medium: ["Mittel", "tag-warn"], low: ["Niedrig", "tag-neutral"] } as const;

function countdown(deadline: string | null, today: string): { text: string; urgent: boolean } | null {
  if (!deadline) return null;
  const days = Math.round((Date.parse(deadline) - Date.parse(today)) / 86400_000);
  if (days < 0) return { text: `Frist seit ${-days} ${-days === 1 ? "Tag" : "Tagen"} abgelaufen`, urgent: true };
  if (days === 0) return { text: "Frist heute", urgent: true };
  return { text: `noch ${days} ${days === 1 ? "Tag" : "Tage"} (${formatDate(deadline)})`, urgent: days <= 7 };
}

export default async function AmazonTodosPage({ searchParams }: { searchParams: Promise<{ filter?: string; sort?: string; q?: string; kat?: string }> }) {
  const session = await requireOwner();
  const sp = await searchParams;
  const t = session.tenantId;
  const filter: Filter = sp.filter && sp.filter in FILTERS ? (sp.filter as Filter) : "offen";
  const sort: Sort = sp.sort && sp.sort in SORTS ? (sp.sort as Sort) : "prio";
  const q = (sp.q ?? "").trim();
  const T = schema.amazonTodos;

  const where: SQL[] = [eq(T.tenantId, t)];
  if (filter === "offen") where.push(eq(T.status, "open"));
  if (filter === "erledigt") where.push(eq(T.status, "done"));
  if (filter === "ignoriert") where.push(eq(T.status, "ignored"));
  if (sp.kat) where.push(eq(T.category, sp.kat));
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(T.subject, like), ilike(T.summary, like), ilike(T.bodyShort, like), ilike(T.note, like), sql`${T.asins}::text ilike ${like}`)!);
  }
  const prioOrder = sql`case ${T.priority} when 'high' then 0 when 'medium' then 1 else 2 end`;
  const orderBy =
    sort === "prio" ? [prioOrder, sql`${T.deadline} asc nulls last`, desc(T.receivedAt)]
    : sort === "frist" ? [sql`${T.deadline} asc nulls last`, prioOrder, desc(T.receivedAt)]
    : sort === "alt" ? [asc(T.receivedAt)]
    : [desc(T.receivedAt)];

  const [stats, todos, cats, ai, discord] = await Promise.all([
    todoStats(t),
    db.select().from(T).where(and(...where)).orderBy(...orderBy).limit(300),
    db
      .select({ category: T.category, n: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${T.deadline} < ${todayIso()}::date)::int` })
      .from(T)
      .where(and(eq(T.tenantId, t), eq(T.status, "open")))
      .groupBy(T.category)
      .orderBy(desc(sql`count(*)`)),
    getIntegration(t, "anthropic"),
    getIntegration(t, "discord"),
  ]);
  const today = todayIso();
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { filter, sort, q: q || undefined, kat: sp.kat, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/amazon-todos?${p}`;
  };
  const tile = (label: string, value: number, color?: string, link?: string) => (
    <Link href={link ?? "#"} className="card card-pad" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="small muted">{label}</div>
      <div className="num" style={{ fontSize: 28, fontWeight: 600, color }}>{value}</div>
    </Link>
  );

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Amazon FBA</div><h1>Amazon-ToDos</h1></div>
        <RefreshButton />
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 900 }}>
        Aus den Amazon-Systemmails aller verbundenen Postfächer: Rauschen fällt weg, der Rest wird {ai?.apiKey ? "von der KI" : "nach Regeln (ohne KI-Schlüssel)"} eingestuft – Kategorie, Priorität, Frist, ASINs.
        Erledigen im Seller Central, danach hier „✓ erledigt“. Freigabe-Mails zur selben ASIN („Bestand freigegeben“, „Angebot wieder aktiv“) haken ältere Aufgaben automatisch ab.
        {!discord?.webhookUrl && <> Neue hohe Prioritäten können auch nach <Link href="/anbindungen?p=discord#discord">Discord</Link> gemeldet werden.</>}
      </p>

      <div className="grid-kpi">
        {tile("Offen", stats.open, undefined, href({ filter: "offen", kat: undefined }))}
        {tile("davon hohe Priorität", stats.high, "var(--danger)", href({ filter: "offen", sort: "prio" }))}
        {tile("Frist ≤ 7 Tage", stats.dueSoon, "var(--warn)", href({ filter: "offen", sort: "frist" }))}
        {tile("Frist abgelaufen", stats.overdue, stats.overdue ? "var(--danger)" : undefined, href({ filter: "offen", sort: "frist" }))}
      </div>

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <form className="card card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="input" name="filter" defaultValue={filter} style={{ width: "auto" }} aria-label="Filter">
              {(Object.keys(FILTERS) as Filter[]).map((f) => <option key={f} value={f}>{FILTERS[f]}</option>)}
            </select>
            <select className="input" name="sort" defaultValue={sort} style={{ width: "auto" }} aria-label="Sortierung">
              {(Object.keys(SORTS) as Sort[]).map((s) => <option key={s} value={s}>{SORTS[s]}</option>)}
            </select>
            {sp.kat && <input type="hidden" name="kat" value={sp.kat} />}
            <input className="input" name="q" defaultValue={q} placeholder="Suche: Betreff, ASIN, Text, Notiz" style={{ flex: "1 1 200px" }} />
            <button className="btn" type="submit">Anzeigen</button>
          </form>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link href={href({ kat: undefined })} className={`chip${!sp.kat ? " active" : ""}`}>Alle Kategorien</Link>
            {cats.map((c) => (
              <Link key={c.category} href={href({ kat: c.category, filter: "offen" })} className={`chip${sp.kat === c.category ? " active" : ""}`}>
                {categoryLabel(c.category)} {c.n}{c.overdue ? ` (${c.overdue} abgelaufen)` : ""}
              </Link>
            ))}
          </div>

          {todos.length === 0 && <div className="card card-pad muted">Keine Aufgaben in dieser Ansicht.</div>}
          {todos.map((x) => {
            const cd = x.status === "open" ? countdown(x.deadline, today) : null;
            const [pl, pc] = PRIO_LABEL[x.priority];
            return (
              <article key={x.id} className="card card-pad stack" style={{ gap: 8, borderLeft: `4px solid ${x.status !== "open" ? "var(--border)" : x.priority === "high" ? "var(--danger)" : x.priority === "medium" ? "var(--warn)" : "var(--border-strong)"}` }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`tag ${pc}`}>{pl}</span>
                  <span className="tag tag-neutral">{categoryLabel(x.category)}</span>
                  {x.status !== "open" && <span className="tag tag-ok">{x.status === "ignored" ? "Ignoriert" : x.infoOnly ? "Info" : "Erledigt"}</span>}
                  {cd && <span className="small" style={{ color: cd.urgent ? "var(--danger)" : "var(--ink-2)", fontWeight: cd.urgent ? 600 : 400 }}>⏱ {cd.text}</span>}
                  <span className="small muted" style={{ marginLeft: "auto" }}>{x.receivedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} · {(x.sender ?? "").replace(/<.*>/, "").trim().slice(0, 40)}</span>
                </div>
                <div style={{ fontWeight: 600 }}>{x.summary ?? x.subject}</div>
                {x.summary && x.subject && x.summary !== x.subject && <div className="small muted">{x.subject}</div>}
                {x.asins.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {x.asins.slice(0, 20).map((a) => (
                      <a key={a} className="chip num" href={`https://sellercentral.amazon.de/myinventory/inventory?searchField=all&searchTerm=${a}`} target="_blank" rel="noopener" style={{ fontSize: 12 }}>{a} ↗</a>
                    ))}
                    {x.asins.length > 20 && <span className="small muted">+{x.asins.length - 20} weitere</span>}
                  </div>
                )}
                {x.closedBy && x.status !== "open" && <div className="small muted">{x.closedBy}{x.closedAt ? ` · ${x.closedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}` : ""}</div>}
                {x.bodyShort && (
                  <details className="small">
                    <summary style={{ cursor: "pointer" }}>Original-Text{x.emailId && <> · <Link href={`/posteingang/${x.emailId}`}>ganze Mail</Link></>}</summary>
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 6, color: "var(--ink-2)" }}>{x.bodyShort}</div>
                  </details>
                )}
                <form action={saveNoteAction} style={{ display: "flex", gap: 6 }}>
                  <input type="hidden" name="id" value={x.id} />
                  <input className="input" name="note" defaultValue={x.note ?? ""} placeholder="Notiz, z. B. „Unterlagen am 30.09. hochgeladen“" style={{ flex: 1, fontSize: 13 }} aria-label="Notiz" />
                  <button className="btn btn-small" type="submit">Notiz speichern</button>
                </form>
                <div style={{ display: "flex", gap: 8 }}>
                  {x.status === "open" ? (
                    <>
                      <form action={setStatusAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="done" /><button className="btn btn-primary btn-small" type="submit">✓ erledigt</button></form>
                      <form action={setStatusAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="ignored" /><button className="btn btn-small" type="submit">ignorieren</button></form>
                    </>
                  ) : (
                    <form action={setStatusAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="open" /><button className="btn btn-small" type="submit">↩ wieder öffnen</button></form>
                  )}
                </div>
              </article>
            );
          })}
          {todos.length === 300 && <div className="small muted">Die ersten 300 – Filter oder Suche eingrenzen.</div>}
        </div>

        <aside className="col-side">
          <section className="card card-pad stack small">
            <h2>So arbeitest du die Liste ab</h2>
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Filter „Offene ToDos“, Sortierung „Priorität + Frist“.</li>
              <li>Im Seller Central erledigen (Unterlagen hochladen, Remission beauftragen, Widerspruch einreichen) – ASIN anklicken öffnet das Inventar.</li>
              <li>Hier „✓ erledigt“, gern mit Notiz.</li>
              <li>Was nur immer wieder kommt: „ignorieren“.</li>
            </ol>
            <div className="muted">Fristen sind geschätzt („innerhalb von 30 Tagen“ ab Maildatum) – maßgeblich ist das Datum im Seller Central. Offene Fristen stehen auch im Kalender.</div>
            <div className="muted">
              Erledigt/Infos: {stats.done} · Ignoriert: {stats.ignored}
              {isRunning(t) && <> · <strong>Prüfung läuft gerade</strong></>}
            </div>
          </section>
          <section className="card card-pad">
            <ImportForm />
          </section>
        </aside>
      </div>
    </>
  );
}
