import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { leadSenders, senderInfo, signature } from "@/lib/leads/service";
import { mailboxCredentials } from "@/lib/mail/accounts";
import { imapOrdnerListe } from "@/lib/mail/connect";
import { ordnerName, standardOrdner, waehlbar, type ImapOrdner } from "@/lib/mail/ordner";
import { nurAbrufAction, ordnerAction, saveMailboxProfileAction } from "../../actions";
import { TestVerbindungButton } from "../../inbox-forms";

/** Ordnerliste live vom Server (nur IMAP); Fehler als Text. */
async function ordnerLaden(box: typeof schema.mailboxes.$inferSelect): Promise<{ liste: ImapOrdner[]; host: string } | { fehler: string } | null> {
  if (box.provider !== "imap") return null;
  try {
    const c = await mailboxCredentials(box);
    if (c.kind !== "imap") return null;
    return { liste: (await imapOrdnerListe(c.account)).filter(waehlbar), host: c.account.imapHost };
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : String(e) };
  }
}

/** Absendername und Signatur eines Postfachs – für Einkaufsanfragen an Großhändler und Nachfass-Mails. */
export default async function PostfachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("posteingang");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [box] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) notFound();
  const senders = await leadSenders(session.tenantId);
  const generated = signature(await senderInfo(session.tenantId, session.userId), "de");
  const ordner = await ordnerLaden(box);
  const auto = ordner && "liste" in ordner ? standardOrdner(ordner.liste, ordner.host) : [];
  const gewaehlt = new Set(box.ordner?.length ? box.ordner : auto);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/posteingang">Posteingang</Link></div><h1>{box.address}</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="box-msg">{sp.meldung}</div>}
      <div className="row">
        <form action={saveMailboxProfileAction} className="card card-pad stack" style={{ flexGrow: 1, gap: 10, maxWidth: 640 }}>
          <input type="hidden" name="id" value={box.id} />
          <h2>Absender & Signatur</h2>
          <div className="field">
            <label className="label" htmlFor="mb-name">Absendername</label>
            <input className="input" id="mb-name" name="fromName" defaultValue={box.fromName ?? ""} maxLength={80} placeholder="z. B. Max Mustermann – Firma GmbH" />
            <div className="small muted">So steht es beim Empfänger im Feld „Von“. Leer = nur die Adresse.</div>
          </div>
          <div className="field">
            <label className="label" htmlFor="mb-sig">Signatur</label>
            <textarea className="textarea" id="mb-sig" name="signature" defaultValue={box.signature ?? ""} maxLength={2000} style={{ minHeight: 180 }} placeholder={generated} />
            <div className="small muted">
              Wird an Einkaufsanfragen und Nachfass-Mails angehängt, die über dieses Postfach gehen – mit Grußformel, z. B. „Mit freundlichen Grüßen“ (bei englischen Mails wird daraus „Kind regards“). Leer = aus den Absenderdaten (Einstellungen → Versand), wie im Platzhalter.
            </div>
          </div>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="leadDefault" defaultChecked={senders.defaultId === box.id} /> Für Einkaufsanfragen vorauswählen
          </label>
          <div><button className="btn btn-primary" type="submit">Speichern</button></div>
        </form>
        <aside className="col-side">
          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="mailbox-verbindung">
            <h2>Verbindung</h2>
            <div className="small muted">{box.provider === "imap" ? "IMAP mit App-Passwort" : box.provider === "gmail" ? "Google (OAuth)" : "Microsoft (OAuth)"}{box.nurAbruf ? " · nur Abruf" : ""} · {box.lastSyncAt ? `zuletzt abgerufen ${box.lastSyncAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}` : "noch nicht abgerufen"}</div>
            {box.lastError && <div className="small" style={{ color: "var(--danger)" }}>{box.lastError}</div>}
            <TestVerbindungButton id={box.id} />
            <form action={nurAbrufAction}><input type="hidden" name="id" value={box.id} /><button className="btn-link small" type="submit">{box.nurAbruf ? "Auch zum Senden benutzen" : "Nur abrufen (nicht senden)"}</button></form>
          </section>
          <section className="card card-pad small muted">
            Im Schreibfenster bei „Großhändler finden“ wählst du je Anfrage, von welcher Adresse sie rausgeht – zuletzt benutzt ist vorausgewählt. Nachfass-Mails gehen vom selben Postfach wie die erste Anfrage.
          </section>
        </aside>
      </div>
      {ordner && (
        <section id="ordner" className="card card-pad stack" style={{ gap: 10, maxWidth: 820 }} data-testid="mailbox-ordner-wahl">
          <h2>Ordner / Labels abrufen</h2>
          <div className="small muted">
            Amazon-Mails landen per Filter oft im Archiv oder unter einem Label. Hier wählen, welche Ordner gelesen werden. Ohne Auswahl: automatisch – bei Gmail „Alle Nachrichten“ (auch archivierte), sonst Posteingang und Archiv. Gelesen werden nur Mails von Marktplätzen, Versanddiensten und „Deal prüfen“-Weiterleitungen.
          </div>
          {"fehler" in ordner ? (
            <div className="notice notice-warn small">{ordner.fehler}</div>
          ) : (
            <form action={ordnerAction} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={box.id} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                {ordner.liste.map((o) => (
                  <label key={o.path} className="small" style={{ display: "flex", gap: 6, alignItems: "center", overflowWrap: "anywhere" }}>
                    <input type="checkbox" name="ordner" value={o.path} defaultChecked={gewaehlt.has(o.path)} /> {ordnerName(o.path)}
                    {o.specialUse === "\\All" && <span className="tag tag-neutral">alle</span>}
                  </label>
                ))}
              </div>
              <div className="small muted">{box.ordner?.length ? `Eigene Auswahl (${box.ordner.length}).` : `Zurzeit automatisch: ${auto.map(ordnerName).join(", ")}.`}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-small" type="submit">Auswahl speichern</button>
                <button className="btn btn-small" type="submit" name="op" value="automatisch">Automatisch</button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
