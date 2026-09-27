import Link from "next/link";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { TOPIC_LABEL, type Topic } from "@/lib/inbox/classify";
import { MAIL_CATEGORY_LABEL } from "@/lib/labels";
import { archiveMails, toggleMailbox } from "./actions";
import { EmlUpload, SyncButton } from "./inbox-forms";

const VIEWS = { wichtig: "Wichtig", kritisch: "Kritisch", handeln: "Handeln", info: "Info", unwichtig: "Unwichtig", archiv: "Archiv" } as const;
type View = keyof typeof VIEWS;

export default async function PosteingangPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; verbunden?: string; fehler?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "wichtig";
  const E = schema.emails;
  const where: SQL[] = [eq(E.tenantId, session.tenantId), eq(E.archived, view === "archiv")];
  const cat = { wichtig: ["critical", "action"], kritisch: ["critical"], handeln: ["action"], info: ["info"], unwichtig: ["noise"], archiv: null }[view];
  if (cat) where.push(inArray(E.category, cat as ("critical" | "action" | "info" | "noise")[]));
  const [mails, boxes] = await Promise.all([
    db.select().from(E).where(and(...where)).orderBy(desc(E.receivedAt)).limit(200),
    db.select().from(schema.mailboxes).where(eq(schema.mailboxes.tenantId, session.tenantId)),
  ]);

  return (
    <>
      <div className="page-head"><div><div className="crumb">Start</div><h1>Posteingang</h1></div></div>
      {sp.verbunden && <div className="notice notice-ok">Postfach {sp.verbunden} verbunden.</div>}
      {sp.fehler && <div className="notice notice-error">{sp.fehler}</div>}

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/posteingang?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
          </div>
          <form action={archiveMails} className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th style={{ width: 28 }}></th><th>Einordnung</th><th>Betreff</th><th>Von</th><th>Eingang</th><th>Aufgabe</th></tr></thead>
              <tbody>
                {mails.length === 0 && <tr><td colSpan={6} className="muted">Keine Mails in dieser Ansicht.</td></tr>}
                {mails.map((m) => {
                  const [label, cls] = MAIL_CATEGORY_LABEL[m.category];
                  return (
                    <tr key={m.id}>
                      <td><input type="checkbox" name="ids" value={m.id} aria-label="Auswählen" /></td>
                      <td><span className={`tag ${cls}`}>{label}</span><div className="small muted">{TOPIC_LABEL[(m.topic ?? "other") as Topic]}</div></td>
                      <td style={{ maxWidth: 420 }}><Link href={`/posteingang/${m.id}`} style={{ fontWeight: 600 }}>{m.subject || "(ohne Betreff)"}</Link><div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snippet}</div></td>
                      <td className="small">{m.fromName ?? m.fromAddress}</td>
                      <td className="num small">{m.receivedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</td>
                      <td>{m.taskId ? <Link href="/" className="small">✓ To-do</Link> : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {view !== "archiv" && mails.length > 0 && <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}><button className="btn btn-small" type="submit">Auswahl archivieren</button></div>}
          </form>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Postfächer</h2>
            {boxes.filter((b) => b.provider !== "upload").length === 0 && <div className="small muted">Noch keins verbunden.</div>}
            {boxes.filter((b) => b.provider !== "upload").map((b) => (
              <div key={b.id} style={{ fontSize: 13, borderBottom: "1px solid var(--row)", paddingBottom: 8 }}>
                <div className="between"><strong>{b.address}</strong><span className="tag tag-neutral">{b.provider === "gmail" ? "GMAIL" : "OUTLOOK"}</span></div>
                <div className="small muted">{b.lastSyncAt ? `Zuletzt: ${b.lastSyncAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}` : "Noch nicht abgerufen"}{!b.active && " · pausiert"}</div>
                {b.lastError && <div className="small" style={{ color: "var(--danger)" }}>{b.lastError}</div>}
                <form action={toggleMailbox}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">{b.active ? "Pausieren" : "Aktivieren"}</button></form>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn-small" href="/api/oauth/google/start">+ Gmail verbinden</a>
              <a className="btn btn-small" href="/api/oauth/microsoft/start">+ Outlook verbinden</a>
            </div>
            <div className="small muted">Vorher unter Anbindungen die Google- bzw. Microsoft-App eintragen. Neue Mails werden automatisch alle 15 Minuten abgerufen.</div>
            <SyncButton />
          </section>
          <section className="card card-pad"><EmlUpload /></section>
          <section className="card card-pad small muted">
            Kritisch und „Handeln“ werden automatisch zu To-dos. A-bis-Z, eBay-Fälle und Rücksendeanfragen landen zusätzlich unter „Fälle“. Mails mit derselben Message-ID aus mehreren Postfächern erscheinen nur einmal.
          </section>
        </aside>
      </div>
    </>
  );
}
