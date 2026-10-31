import Link from "next/link";
import { senderMailboxes } from "@/lib/mail/accounts";
import { ordnerName } from "@/lib/mail/ordner";
import { postfachStand } from "@/lib/mail/status";
import { nurAbrufAction, removeMailbox, setDefaultSenderAction, toggleMailbox } from "./actions";
import { SyncButton, TestMailButton, TestVerbindungButton } from "./inbox-forms";
import { ConfirmButton } from "@/components/confirm-button";

const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : null);

/** Postfächer verwalten (verbinden, Ordner, testen, Absender, pausieren, entfernen) – Teil der Einstellungen. */
export async function MailboxManager({ tenantId }: { tenantId: string }) {
  const [stand, senders] = await Promise.all([postfachStand(tenantId), senderMailboxes(tenantId)]);
  return (
    <section className="card card-pad stack" data-testid="mailbox-manager">
      <h2>Postfächer</h2>
      {stand.warnung && <div className="notice notice-warn small" data-testid="amazon-mail-warnung">{stand.warnung}</div>}
      {stand.postfaecher.length === 0 && <div className="small muted">Noch keins verbunden.</div>}
      {stand.postfaecher.map((b) => (
        <div key={b.id} style={{ fontSize: 13, borderBottom: "1px solid var(--row)", paddingBottom: 8 }} data-testid="mailbox-zeile">
          <div className="between" style={{ gap: 8 }}>
            <strong style={{ overflowWrap: "anywhere" }}>{b.adresse}</strong>
            <span style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
              {senders.defaultId === b.id && <span className="tag tag-ok">ABSENDER</span>}
              {b.nurAbruf && <span className="tag tag-neutral">NUR ABRUF</span>}
              <span className="tag tag-neutral">{b.art}</span>
            </span>
          </div>
          <div className="small muted">
            {b.letzterAbruf ? `Zuletzt abgerufen: ${zeit(b.letzterAbruf)}` : "Noch nicht abgerufen"}
            {!b.aktiv && " · pausiert"}
            {b.imap && ` · Ordner: ${b.ordner ? b.ordner.map(ordnerName).join(", ") : "automatisch"}`}
            {` · letzte Amazon-Mail: ${zeit(b.letzteAmazonMail) ?? "keine"}`}
          </div>
          {b.fehler && <div className="small" style={{ color: "var(--danger)" }} data-testid="mailbox-fehler">{b.fehlerArt ? <strong>{b.fehlerArt}: </strong> : null}{b.fehler}</div>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            <TestVerbindungButton id={b.id} />
            {b.imap && <Link className="btn-link small" href={`/posteingang/postfaecher/${b.id}#ordner`} data-testid="mailbox-ordner">Ordner</Link>}
            <form action={toggleMailbox}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">{b.aktiv ? "Pausieren" : "Aktivieren"}</button></form>
            <form action={nurAbrufAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">{b.nurAbruf ? "Auch senden" : "Nur abrufen"}</button></form>
            {b.aktiv && !b.nurAbruf && senders.defaultId !== b.id && <form action={setDefaultSenderAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">Als Absender</button></form>}
            {b.aktiv && !b.nurAbruf && <TestMailButton id={b.id} />}
            <Link className="btn-link small" href={`/posteingang/postfaecher/${b.id}`} data-testid="mailbox-profile">Name & Signatur</Link>
            <form action={removeMailbox}><input type="hidden" name="id" value={b.id} /><ConfirmButton className="btn-link small danger-link" confirm={`Postfach ${b.adresse} entfernen? Bereits abgerufene Mails bleiben im Posteingang.`}>Entfernen</ConfirmButton></form>
          </div>
        </div>
      ))}
      <div><Link className="btn btn-small btn-primary" href="/posteingang/verbinden">+ Postfach verbinden</Link></div>
      <div className="small muted">Standard: E-Mail-Adresse + App-Passwort (IMAP/SMTP, Server werden erkannt). Neue Mails werden alle 15 Minuten abgerufen; über das Absender-Postfach verschickt das System E-Mails (z. B. eBay-Rechnungen).</div>
      <SyncButton />
    </section>
  );
}

/** Kurzer Stand der Postfächer im Posteingang – verwaltet wird in den Einstellungen. */
export async function MailboxStatus({ tenantId, isOwner }: { tenantId: string; isOwner: boolean }) {
  const stand = await postfachStand(tenantId);
  return (
    <section className="card card-pad stack" style={{ gap: 6 }} data-testid="mailbox-status">
      <h2>Postfächer</h2>
      {stand.warnung && <div className="notice notice-warn small" data-testid="amazon-mail-warnung">{stand.warnung}</div>}
      {stand.postfaecher.length === 0 && <div className="small muted">Noch keins verbunden.</div>}
      {stand.postfaecher.map((b) => (
        <div key={b.id} className="small">
          <strong style={{ overflowWrap: "anywhere" }}>{b.adresse}</strong>
          <div className="muted">{b.letzterAbruf ? `Zuletzt: ${zeit(b.letzterAbruf)}` : "Noch nicht abgerufen"}{!b.aktiv && " · pausiert"}{b.imap ? ` · ${b.ordner ? b.ordner.map(ordnerName).join(", ") : "Ordner automatisch"}` : ""}</div>
          {b.fehler && <div style={{ color: "var(--danger)" }}>{b.fehlerArt ? `${b.fehlerArt}: ` : ""}{b.fehler}</div>}
        </div>
      ))}
      <SyncButton />
      {isOwner ? <Link className="btn btn-small" href="/einstellungen#postfaecher">Postfächer verwalten</Link> : <div className="small muted">Verbinden und verwalten kann der Inhaber unter Einstellungen.</div>}
    </section>
  );
}
