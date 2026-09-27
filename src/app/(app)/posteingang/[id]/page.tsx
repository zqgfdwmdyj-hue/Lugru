import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAIL_CATEGORIES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { TOPIC_LABEL, type Topic } from "@/lib/inbox/classify";
import { MAIL_CATEGORY_LABEL } from "@/lib/labels";
import { archiveMails, createTaskFromMail, setCategory } from "../actions";

const TOPIC_SEARCH: Partial<Record<Topic, string>> = { a_to_z: "A-bis-Z", buyer_message: "Kunde", ebay_case: "eBay", return_request: "Rücksendung", inbound_problem: "Wareneingang", listing_blocked: "Rechnung", negative_feedback: "Bewertung" };

export default async function MailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [m] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.tenantId, session.tenantId)));
  if (!m) notFound();
  const refs = m.references;
  const topic = (m.topic ?? "other") as Topic;
  const term = TOPIC_SEARCH[topic];
  const snippets = term
    ? await db.select({ id: schema.knowledgeEntries.id, title: schema.knowledgeEntries.title }).from(schema.knowledgeEntries).where(and(eq(schema.knowledgeEntries.tenantId, session.tenantId), or(ilike(schema.knowledgeEntries.title, `%${term}%`), ilike(schema.knowledgeEntries.category, `%${term}%`)))).limit(5)
    : [];
  const [label, cls] = MAIL_CATEGORY_LABEL[m.category];

  return (
    <>
      <div className="crumb"><Link href="/posteingang">Posteingang</Link> › {TOPIC_LABEL[topic]}</div>
      <div className="row">
        <article className="card" style={{ flexGrow: 1, minWidth: 0, padding: "22px 28px" }}>
          <div className="between"><span className={`tag ${cls}`}>{label}</span><span className="small muted">{m.receivedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</span></div>
          <h1 style={{ fontSize: 20, marginTop: 10 }}>{m.subject}</h1>
          <div className="small muted" style={{ marginTop: 4 }}>{m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress} · Regel: {m.matchedRule}</div>
          <div className="article-body" style={{ marginTop: 16, fontSize: 14 }}>{m.bodyText}</div>
        </article>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Bezüge</h2>
            {Object.keys(refs).length === 0 && <div className="small muted">Keine erkannt.</div>}
            {refs.amazonOrder && <div>Bestellung: <Link href={`/suche?q=${refs.amazonOrder}`} className="num">{refs.amazonOrder}</Link></div>}
            {refs.ebayOrder && <div>eBay-Bestellung: <Link href={`/suche?q=${refs.ebayOrder}`} className="num">{refs.ebayOrder}</Link></div>}
            {refs.asin && <div>ASIN: <Link href={`/chargen?q=${refs.asin}`} className="num">{refs.asin}</Link></div>}
            {refs.caseId && <div>Fall-ID: <span className="num">{refs.caseId}</span></div>}
            {refs.fbaShipment && <div>FBA-Sendung: <span className="num">{refs.fbaShipment}</span></div>}
          </section>
          <section className="card card-pad stack">
            <h2>Bearbeiten</h2>
            {m.taskId ? <div className="small">✓ Als To-do auf der Startseite</div> : <form action={createTaskFromMail}><input type="hidden" name="id" value={m.id} /><button className="btn btn-small" type="submit">To-do anlegen</button></form>}
            <form action={setCategory} style={{ display: "flex", gap: 6 }}>
              <input type="hidden" name="id" value={m.id} />
              <label className="sr-only" htmlFor="cat">Einordnung</label>
              <select className="select" id="cat" name="category" defaultValue={m.category}>{MAIL_CATEGORIES.map((c) => <option key={c} value={c}>{MAIL_CATEGORY_LABEL[c][0]}</option>)}</select>
              <button className="btn btn-small" type="submit">Ändern</button>
            </form>
            {!m.archived && <form action={archiveMails}><input type="hidden" name="id" value={m.id} /><button className="btn-link small" type="submit">Archivieren</button></form>}
          </section>
          {snippets.length > 0 && (
            <section className="card card-pad stack">
              <h2>Passende Textbausteine</h2>
              {snippets.map((s) => <Link key={s.id} href={`/wissen/${s.id}`}>{s.title}</Link>)}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
