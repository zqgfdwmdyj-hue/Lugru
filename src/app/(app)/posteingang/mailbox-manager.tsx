import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { senderMailboxes } from "@/lib/mail/accounts";
import { removeMailbox, setDefaultSenderAction, toggleMailbox } from "./actions";
import { SyncButton, TestMailButton } from "./inbox-forms";

const PROVIDER_TAG = { gmail: "GOOGLE", outlook: "MICROSOFT", imap: "IMAP", upload: "" } as const;

/** Postfächer verwalten (verbinden, Absender, pausieren, entfernen) – Teil der Einstellungen. */
export async function MailboxManager({ tenantId }: { tenantId: string }) {
  const [boxes, senders] = await Promise.all([
    db.select().from(schema.mailboxes).where(eq(schema.mailboxes.tenantId, tenantId)).orderBy(schema.mailboxes.createdAt),
    senderMailboxes(tenantId),
  ]);
  return (
          <section className="card card-pad stack" data-testid="mailbox-manager">
      <h2>Postfächer</h2>
      {boxes.filter((b) => b.provider !== "upload").length === 0 && <div className="small muted">Noch keins verbunden.</div>}
      {boxes.filter((b) => b.provider !== "upload").map((b) => (
        <div key={b.id} style={{ fontSize: 13, borderBottom: "1px solid var(--row)", paddingBottom: 8 }}>
          <div className="between" style={{ gap: 8 }}>
            <strong style={{ overflowWrap: "anywhere" }}>{b.address}</strong>
            <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {senders.defaultId === b.id && <span className="tag tag-ok">ABSENDER</span>}
              <span className="tag tag-neutral">{PROVIDER_TAG[b.provider]}</span>
            </span>
          </div>
          {(b.fromName || b.signature) && <div className="small muted">{b.fromName ?? ""}{b.fromName && b.signature ? " · " : ""}{b.signature ? "mit Signatur" : ""}</div>}
          <div className="small muted">{b.lastSyncAt ? `Zuletzt: ${b.lastSyncAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}` : "Noch nicht abgerufen"}{!b.active && " · pausiert"}</div>
          {b.lastError && <div className="small" style={{ color: "var(--danger)" }}>{b.lastError}</div>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            <form action={toggleMailbox}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">{b.active ? "Pausieren" : "Aktivieren"}</button></form>
            {b.active && senders.defaultId !== b.id && <form action={setDefaultSenderAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">Als Absender</button></form>}
            {b.active && <TestMailButton id={b.id} />}
            <Link className="btn-link small" href={`/posteingang/postfaecher/${b.id}`} data-testid="mailbox-profile">Name & Signatur</Link>
            <form action={removeMailbox}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Entfernen</button></form>
          </div>
        </div>
      ))}
      <div><Link className="btn btn-small btn-primary" href="/posteingang/verbinden">+ Postfach verbinden</Link></div>
      <div className="small muted">Mit Passwort/App-Passwort oder per Google-/Microsoft-Anmeldung. Neue Mails werden alle 15 Minuten abgerufen; über das Absender-Postfach verschickt das System E-Mails (z. B. eBay-Rechnungen).</div>
      <SyncButton />
    </section>
  );
}

/** Kurzer Stand der Postfächer im Posteingang – verwaltet wird in den Einstellungen. */
export async function MailboxStatus({ tenantId, isOwner }: { tenantId: string; isOwner: boolean }) {
  const boxes = (await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.tenantId, tenantId)).orderBy(schema.mailboxes.createdAt)).filter((b) => b.provider !== "upload");
  return (
    <section className="card card-pad stack" style={{ gap: 6 }} data-testid="mailbox-status">
      <h2>Postfächer</h2>
      {boxes.length === 0 && <div className="small muted">Noch keins verbunden.</div>}
      {boxes.map((b) => (
        <div key={b.id} className="small">
          <strong style={{ overflowWrap: "anywhere" }}>{b.address}</strong>
          <div className="muted">{b.lastSyncAt ? `Zuletzt: ${b.lastSyncAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}` : "Noch nicht abgerufen"}{!b.active && " · pausiert"}</div>
          {b.lastError && <div style={{ color: "var(--danger)" }}>{b.lastError}</div>}
        </div>
      ))}
      <SyncButton />
      {isOwner ? <Link className="btn btn-small" href="/einstellungen#postfaecher">Postfächer verwalten</Link> : <div className="small muted">Verbinden und verwalten kann der Inhaber unter Einstellungen.</div>}
    </section>
  );
}
