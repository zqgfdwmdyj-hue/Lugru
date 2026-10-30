import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAIL_CATEGORIES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { TOPICS, TOPIC_LABEL, describeRule, isUncertainRule, type Topic } from "@/lib/inbox/classify";
import { MAIL_CATEGORY_LABEL } from "@/lib/labels";
import { archiveMails, correctMail, createTaskFromMail, draftAction } from "../actions";
import { desc } from "drizzle-orm";
import { wissenSichtbar } from "@/lib/knowledge/sichtbar";

const TOPIC_SEARCH: Partial<Record<Topic, string>> = { a_to_z: "A-bis-Z", buyer_message: "Kunde", ebay_case: "eBay", return_request: "Rücksendung", inbound_problem: "Wareneingang", listing_blocked: "Rechnung", negative_feedback: "Bewertung" };

const DRAFT_MSG: Record<string, [string, string]> = {
  gespeichert: ["Entwurf gespeichert.", "notice-ok"],
  gesendet: ["Antwort gesendet.", "notice-ok"],
  verworfen: ["Entwurf verworfen.", "notice-info"],
  "nicht-bestaetigt": ["Nicht gesendet: bitte erst „Geprüft – jetzt senden“ anhaken.", "notice-warn"],
  unvollstaendig: ["Nicht gespeichert: Empfänger, Betreff und Text angeben.", "notice-warn"],
  "schon-gesendet": ["Dieser Entwurf wurde schon gesendet.", "notice-info"],
  fehler: ["Senden fehlgeschlagen – Postfach unter Posteingang prüfen. Der Entwurf ist gespeichert.", "notice-error"],
};

export default async function MailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ entwurf?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [m] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.tenantId, session.tenantId)));
  if (!m) notFound();
  const refs = m.references;
  const topic = (m.topic ?? "other") as Topic;
  const term = TOPIC_SEARCH[topic];
  const snippets = term
    ? await db.select({ id: schema.knowledgeEntries.id, title: schema.knowledgeEntries.title }).from(schema.knowledgeEntries).where(and(eq(schema.knowledgeEntries.tenantId, session.tenantId), wissenSichtbar(session), or(ilike(schema.knowledgeEntries.title, `%${term}%`), ilike(schema.knowledgeEntries.category, `%${term}%`)))).limit(5)
    : [];
  const [label, cls] = MAIL_CATEGORY_LABEL[m.category];
  const drafts = await db.select().from(schema.emailDrafts).where(and(eq(schema.emailDrafts.tenantId, session.tenantId), eq(schema.emailDrafts.emailId, m.id))).orderBy(desc(schema.emailDrafts.createdAt));
  const draftMsg = DRAFT_MSG[(await searchParams).entwurf ?? ""];
  const uncertain = isUncertainRule(m.matchedRule);

  return (
    <>
      <div className="crumb"><Link href="/posteingang">Posteingang</Link> › {TOPIC_LABEL[topic]}</div>
      <div className="row">
        <article className="card" style={{ flexGrow: 1, minWidth: 0, padding: "22px 28px" }}>
          <div className="between"><span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><span className={`tag ${cls}`}>{label}</span><span className="tag tag-neutral">{TOPIC_LABEL[topic] ?? topic}</span>{uncertain && <span className="tag tag-warn" data-testid="mail-uncertain">unsicher</span>}</span><span className="small muted">{m.receivedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</span></div>
          <h1 style={{ fontSize: 20, marginTop: 10 }}>{m.subject}</h1>
          <div className="small muted" style={{ marginTop: 4 }}>{m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress}</div>
          <div className="small muted" style={{ marginTop: 2 }} data-testid="mail-rule">Einordnung: {describeRule(m.matchedRule)}{uncertain ? " – bitte prüfen und rechts korrigieren" : ""}</div>
          <div className="article-body" style={{ marginTop: 16, fontSize: 14 }}>{m.bodyText}</div>
          {(drafts.length > 0 || draftMsg) && (
            <section id="entwurf" className="stack" style={{ marginTop: 24, gap: 12 }} data-testid="mail-drafts">
              <h2 style={{ fontSize: 16 }}>Antwort-Entwurf</h2>
              {draftMsg && <div className={`notice ${draftMsg[1]} small`} role="status" data-testid="draft-msg">{draftMsg[0]}</div>}
              {drafts.map((d) =>
                d.sentAt ? (
                  <div key={d.id} className="small muted" data-testid="draft-sent">✓ Gesendet {d.sentAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} von {d.sentFrom} an {d.to}: „{d.subject}“</div>
                ) : (
                  <form key={d.id} action={draftAction} className="card card-pad stack" style={{ gap: 8 }} data-testid="draft-form">
                    <input type="hidden" name="draftId" value={d.id} />
                    <div className="small muted">{d.via === "claude" ? "Von Claude vorbereitet" : d.via === "app" ? "Vom Assistenten vorbereitet" : "Entwurf"} · {d.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · wird erst gesendet, wenn du es hier bestätigst</div>
                    <label className="small" htmlFor={`to-${d.id}`}>An</label>
                    <input className="input" id={`to-${d.id}`} name="to" defaultValue={d.to} required />
                    <label className="small" htmlFor={`su-${d.id}`}>Betreff</label>
                    <input className="input" id={`su-${d.id}`} name="subject" defaultValue={d.subject} required />
                    <label className="small" htmlFor={`bo-${d.id}`}>Text</label>
                    <textarea className="input" id={`bo-${d.id}`} name="body" rows={10} defaultValue={d.body} required />
                    <label className="check small"><input type="checkbox" name="geprueft" /> Geprüft – jetzt senden</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btn-primary" name="op" value="senden" type="submit" data-testid="draft-send">Senden</button>
                      <button className="btn" name="op" value="speichern" type="submit">Speichern</button>
                      <button className="btn btn-small btn-danger" name="op" value="verwerfen" type="submit" formNoValidate>Verwerfen</button>
                    </div>
                  </form>
                ),
              )}
            </section>
          )}
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
            {m.taskId ? <div className="small">✓ Als To-do auf der Startseite</div> : <form action={createTaskFromMail}><input type="hidden" name="id" value={m.id} /><button className="btn btn-primary btn-small" type="submit">To-do anlegen</button></form>}
            <form action={correctMail} className="stack" style={{ gap: 6 }} data-testid="mail-correct">
              <input type="hidden" name="id" value={m.id} />
              <label className="small" htmlFor="topic">Thema</label>
              <select className="select" id="topic" name="topic" defaultValue={TOPICS.includes(topic) ? topic : "other"}>{TOPICS.map((t) => <option key={t} value={t}>{TOPIC_LABEL[t]}</option>)}</select>
              <label className="small" htmlFor="cat">Wichtigkeit</label>
              <select className="select" id="cat" name="category" defaultValue={m.category}>{MAIL_CATEGORIES.map((c) => <option key={c} value={c}>{MAIL_CATEGORY_LABEL[c][0]}</option>)}</select>
              <button className="btn btn-primary btn-small" type="submit">Einordnung speichern</button>
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
