import Link from "next/link";
import { ordnerName } from "@/lib/mail/ordner";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { TOPIC_LABEL, isUncertainRule, type Topic } from "@/lib/inbox/classify";
import { MAIL_CATEGORY_LABEL } from "@/lib/labels";
import { mailUpgrades } from "@/lib/inbox/service";
import { applyMailUpgradesAction, archiveMails } from "./actions";
import { EmlUpload } from "./inbox-forms";
import { AuftragAnClaude } from "@/components/auftrag-an-claude";
import { MailboxStatus } from "./mailbox-manager";

const VIEWS = { wichtig: "Wichtig", kritisch: "Kritisch", handeln: "Handeln", info: "Info", unwichtig: "Unwichtig", archiv: "Archiv" } as const;
type View = keyof typeof VIEWS;

export default async function PosteingangPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; verbunden?: string; hinweis?: string; fehler?: string; hochgestuft?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "wichtig";
  const E = schema.emails;
  const where: SQL[] = [eq(E.tenantId, session.tenantId), eq(E.archived, view === "archiv")];
  const cat = { wichtig: ["critical", "action"], kritisch: ["critical"], handeln: ["action"], info: ["info"], unwichtig: ["noise"], archiv: null }[view];
  if (cat) where.push(inArray(E.category, cat as ("critical" | "action" | "info" | "noise")[]));
  const [mails, upgrades] = await Promise.all([db.select().from(E).where(and(...where)).orderBy(desc(E.receivedAt)).limit(200), mailUpgrades(session.tenantId)]);

  return (
    <>
      <div className="page-head"><div><div className="crumb">Heute</div><h1>Posteingang</h1></div></div>
      <div style={{ marginBottom: 12 }}><AuftragAnClaude beispiel="archiviere alle „Amazon hat Ihre Artikel versandt“-Mails" kontext="Posteingang" /></div>
      {sp.verbunden && <div className="notice notice-ok" data-testid="mailbox-verbunden">Postfach {sp.verbunden} verbunden.{sp.hinweis ? ` ${sp.hinweis}` : ""}</div>}
      {sp.fehler && <div className="notice notice-error">{sp.fehler}</div>}
      {sp.hochgestuft && <div className="notice notice-ok" data-testid="mail-upgraded">{sp.hochgestuft === "1" ? "1 Mail" : `${sp.hochgestuft} Mails`} höher eingestuft – sie stehen jetzt unter „Wichtig“, mit Aufgabe auf der Startseite.</div>}
      {upgrades.length > 0 && (
        <div className="notice notice-warn" data-testid="mail-upgrades">
          <strong>{upgrades.length === 1 ? "1 Mail der letzten 60 Tage würde" : `${upgrades.length} Mails der letzten 60 Tage würden`} mit den aktuellen Regeln höher eingestuft</strong> (z. B. Zahlungsprobleme, die als „Info“ ankamen):
          <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
            {upgrades.slice(0, 5).map(({ r, c }) => (
              <li key={r.id}>
                <Link href={`/posteingang/${r.id}`}>{r.subject || "(ohne Betreff)"}</Link>{" "}
                <span className="small muted">{MAIL_CATEGORY_LABEL[r.category][0]} → <strong>{MAIL_CATEGORY_LABEL[c.category][0]}</strong> · {TOPIC_LABEL[c.topic]}</span>
              </li>
            ))}
          </ul>
          {upgrades.length > 5 && <div className="small muted">… und {upgrades.length - 5} weitere.</div>}
          <form action={applyMailUpgradesAction} style={{ marginTop: 6 }}>
            <button className="btn btn-small btn-primary" type="submit" data-testid="mail-upgrades-apply">Höher einstufen und Aufgaben anlegen</button>
            <span className="small muted" style={{ marginLeft: 8 }}>Nur hochstufen – von Hand korrigierte Mails bleiben, wie sie sind.</span>
          </form>
        </div>
      )}

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/posteingang?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`} aria-current={view === v ? "true" : undefined}>{VIEWS[v]}</Link>)}
          </div>
          <form action={archiveMails} className="card" style={{ overflow: "auto" }}>
            <table className="table sticky-head">
              <thead><tr><th style={{ width: 28 }}></th><th>Einordnung</th><th>Betreff</th><th>Von</th><th>Eingang</th><th>Aufgabe</th></tr></thead>
              <tbody>
                {mails.length === 0 && <tr><td colSpan={6} className="muted">Keine Mails in dieser Ansicht.</td></tr>}
                {mails.map((m) => {
                  const [label, cls] = MAIL_CATEGORY_LABEL[m.category];
                  return (
                    <tr key={m.id}>
                      <td><input type="checkbox" name="ids" value={m.id} aria-label="Auswählen" /></td>
                      <td><span className={`tag ${cls}`}>{label}</span>{isUncertainRule(m.matchedRule) && <> <span className="tag tag-warn" title="Nur Absender oder Text passte – bitte prüfen" data-testid="mail-uncertain">unsicher</span></>}<div className="small muted">{TOPIC_LABEL[(m.topic ?? "other") as Topic] ?? m.topic}</div></td>
                      <td style={{ maxWidth: 420 }}><Link href={`/posteingang/${m.id}`} style={{ fontWeight: 600 }}>{m.subject || "(ohne Betreff)"}</Link><div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snippet}</div></td>
                      <td className="small">{m.fromName ?? m.fromAddress}{(m.an || m.ordner) && <div className="muted" data-testid="mail-an-ordner">{m.an ? `an ${m.an}` : ""}{m.an && m.ordner ? " · " : ""}{m.ordner ? ordnerName(m.ordner) : ""}</div>}</td>
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
          <MailboxStatus tenantId={session.tenantId} isOwner={session.role === "owner"} />
          <section className="card card-pad"><EmlUpload /></section>
          <section className="card card-pad small muted">
            Kritisch und „Handeln“ werden automatisch zu To-dos. Zahlungsprobleme (Zahlung/Karte/Lastschrift fehlgeschlagen, offene Beträge, Mahnungen, Auszahlung gestoppt) sind immer kritisch – auch von Bank, PayPal oder Hosting-Anbietern. „unsicher“ heißt: nur Absender oder Text passte – in der Mail lässt sich Thema und Wichtigkeit korrigieren. A-bis-Z, eBay-Fälle und Rücksendeanfragen landen zusätzlich unter „Fälle“. Mails mit derselben Message-ID aus mehreren Postfächern erscheinen nur einmal.
          </section>
        </aside>
      </div>
    </>
  );
}
