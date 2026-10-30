import Link from "next/link";
import { Linkify } from "@/components/linkify";
import { notFound } from "next/navigation";
import { and, arrayOverlaps, eq, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { verifyEntry, deleteEntry } from "@/lib/knowledge/actions";
import { formatDate } from "@/lib/numbers";
import { pruefungFaellig } from "@/lib/knowledge/anleitung";
import { CopyButton } from "@/components/copy-button";
import { wissenSichtbar } from "@/lib/knowledge/sichtbar";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EintragPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const K = schema.knowledgeEntries;
  const sichtbar = wissenSichtbar(session);
  const [entry] = await db.select().from(K).where(and(eq(K.id, id), eq(K.tenantId, session.tenantId), sichtbar));
  if (!entry) notFound();
  const [call] = entry.callId ? await db.select({ id: schema.calls.id, titel: schema.calls.titel, datum: schema.calls.datum }).from(schema.calls).where(and(eq(schema.calls.id, entry.callId), eq(schema.calls.tenantId, session.tenantId))) : [];

  const related = await db
    .select({ id: K.id, title: K.title })
    .from(K)
    .where(
      and(
        eq(K.tenantId, session.tenantId),
        sichtbar,
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
              <span className={`tag ${entry.origin === "anleitung" ? "tag-ok" : entry.origin === "recherche" ? "tag-warn" : entry.origin === "call" ? "tag-info" : "tag-neutral"}`} data-testid="entry-origin" style={{ marginRight: 6 }}>
                {entry.origin === "anleitung" ? "Anleitung" : entry.origin === "recherche" ? "Recherche (automatisch, ungeprüft)" : entry.origin === "call" ? "Aus einem Call (ungeprüft)" : "Eigene Notiz"}
                {entry.verifiedAt ? ` ✓ geprüft am ${formatDate(entry.verifiedAt.toISOString())}` : ""}
              </span>
              {entry.kind === "snippet" ? "Textbaustein" : entry.kind === "anleitung" ? "Anleitung" : "Wissen"} · aktualisiert am {formatDate(entry.updatedAt.toISOString())}
              {entry.kind === "anleitung" && pruefungFaellig(entry.verifiedAt) && <span className="tag tag-warn" style={{ marginLeft: 6 }} data-testid="entry-pruefen">Prüfung fällig</span>}
              {entry.anleitung?.wer && <> · zuständig: {entry.anleitung.wer}</>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <form action={verifyEntry}><input type="hidden" name="id" value={entry.id} /><button className="btn btn-small" type="submit" data-testid="entry-verify">{entry.verifiedAt ? "Prüfung zurücknehmen" : entry.origin === "recherche" ? "Geprüft – als Anleitung übernehmen" : "Als geprüft markieren"}</button></form>
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
            {entry.body ? <Linkify text={entry.body} /> : <span className="muted">Noch kein Inhalt.</span>}
          </div>
          {entry.origin === "call" && (
            <div className="small" style={{ marginTop: 14 }} data-testid="entry-call">
              {call ? (
                <>
                  Quelle: <Link href={`/calls/${call.id}`}>„{call.titel}“ vom {call.datum.split("-").reverse().join(".")}</Link> – im Call steht die Stelle im Transkript.
                </>
              ) : (
                <span className="muted">Der Call ist nicht mehr im Archiv.</span>
              )}
            </div>
          )}
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
