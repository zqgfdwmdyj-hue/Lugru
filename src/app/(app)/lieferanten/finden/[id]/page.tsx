import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_KINDS } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/leads/labels";
import { brandMatches, isBrandNote, validEmail } from "@/lib/leads/logic";
import { canAccess } from "@/lib/auth/areas";
import { contactContext, DAILY_MAIL_LIMIT, leadSenders, leadSignature, sendBlocker } from "@/lib/leads/service";
import { daysSince, followUpMail } from "@/lib/board/logic";
import { composeSaveAction, composeSendAction, followUpAction, redraftAction, searchEmailAction, researchAction, saveLeadAction, setStatusAction, toSupplierAction } from "../actions";
import { AutoRefresh } from "../refresh";
import { AutoDraft } from "./auto-draft";
import { AutoFindEmail } from "./auto-find-email";
import { SenderPicker, type SenderOption } from "./sender-picker";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("lieferanten");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const L = schema.supplierLeads;
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, session.tenantId)));
  if (!l) notFound();
  const brand = l.searchBrands[0] ?? "";
  const block = l.mailedAt ? null : sendBlocker(l, await contactContext(session.tenantId));
  const hardBlock = block && block !== "keine E-Mail-Adresse" ? block : null;
  // Beim Öffnen gleich den Entwurf schreiben lassen – nur einmal (Fehler bleiben stehen) und nie für gesperrte Kontakte.
  const autoDraft = !l.mailedAt && !hardBlock && validEmail(l.email) && !l.mailBody && !l.busy && !l.mailError;
  // Ohne E-Mail beim Öffnen einmal suchen (Website, Impressum, Kontakt; ggf. kurze Websuche).
  const autoFind = !l.mailedAt && !hardBlock && !validEmail(l.email) && !l.emailSearchedAt && !l.busy;
  const emailFound = l.evidence.find((e) => e.label === "E-Mail gefunden");
  const emailMissing = l.evidence.find((e) => e.label === "E-Mail-Suche");
  const lang = l.mailLanguage === "en" ? "en" : "de";
  const senders = await leadSenders(session.tenantId);
  const senderOptions: SenderOption[] = await Promise.all(
    senders.boxes.map(async (b) => ({
      id: b.id,
      address: b.address,
      label: b.fromName ? `${b.fromName} <${b.address}>` : b.label ? `${b.address} (${b.label})` : b.address,
      signature: await leadSignature(session.tenantId, b, lang, session.userId),
      own: Boolean(b.signature?.trim()),
    })),
  );
  const fromBox = senders.boxes.find((b) => b.id === l.mailFromId) ?? null;
  // Nachfassen vom selben Postfach – mit dessen Signatur.
  const followUp = followUpMail(l, l.mailedAt ? await leadSignature(session.tenantId, fromBox ?? senders.boxes.find((b) => b.id === senders.defaultId) ?? null, lang, session.userId) : null);

  return (
    <>
      <AutoRefresh active={Boolean(l.busy)} />
      <div className="page-head">
        <div><div className="crumb"><Link href="/lieferanten/finden">Großhändler finden</Link></div><h1>{l.companyName}</h1></div>
        <div style={{ display: "flex", gap: 6 }}>
          <span className={`tag ${KIND_LABEL[l.kind][1]}`}>{KIND_LABEL[l.kind][0]}</span>
          <span className="tag tag-neutral">{STATUS_LABEL[l.status]}</span>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="lead-msg">{sp.meldung}</div>}
      {l.busy && <div className="notice notice-info small">Läuft gerade: {l.busy === "pruefen" ? "Websuche" : l.busy === "entwurf" ? "Entwurf" : l.busy === "email" ? "E-Mail-Suche" : "Markenliste"} …</div>}

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="compose">
            <h2>E-Mail an {l.companyName}</h2>
            {autoFind && <AutoFindEmail id={l.id} />}
            {autoDraft && <AutoDraft id={l.id} />}
            {l.mailedAt ? (
              <div className="small" data-testid="compose-sent">
                Gesendet am {l.mailedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} an {l.mailedTo}{l.mailFrom ? ` von ${l.mailFrom}` : ""}.
                {l.repliedAt ? <><br /><strong>Antwort erhalten</strong> am {l.repliedAt.toLocaleDateString("de-DE")} – siehe Posteingang.</> : " Antworten werden automatisch erkannt."}
              </div>
            ) : hardBlock ? (
              <div className="notice notice-warn small" data-testid="compose-blocked">Nicht anschreiben: {hardBlock}</div>
            ) : l.busy === "email" || autoFind ? (
              <div className="small muted" data-testid="compose-searching">Suche die E-Mail-Adresse – Website, Impressum, Kontaktseite … (dauert ein paar Sekunden)</div>
            ) : l.busy === "entwurf" || autoDraft ? (
              <div className="small muted" data-testid="compose-writing">Die KI schreibt den Entwurf … (dauert ein paar Sekunden)</div>
            ) : (
              <form action={composeSendAction} className="stack" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={l.id} />
                <div className="field">
                  <label className="label" htmlFor="c-to">An</label>
                  <input className="input" id="c-to" name="email" type="email" defaultValue={l.email ?? ""} placeholder="E-Mail-Adresse" />
                  {validEmail(l.email) && emailFound && (
                    <div className="small muted" data-testid="email-found">gefunden: {emailFound.value}{emailFound.url && <> – <a href={emailFound.url} target="_blank" rel="noreferrer">ansehen ↗</a></>}</div>
                  )}
                  {!validEmail(l.email) && l.emailSearchedAt && (
                    <div className="notice notice-warn small" data-testid="email-missing" style={{ marginTop: 6 }}>
                      {emailMissing?.value ?? "Keine E-Mail-Adresse gefunden."}
                      {l.contactUrl && <> · <a href={l.contactUrl} target="_blank" rel="noreferrer">Kontakt-/Impressumsseite ↗</a></>}
                      {" "}· Adresse von Hand eintragen oder <button className="btn btn-small" type="submit" formAction={searchEmailAction}>Erneut suchen</button>
                    </div>
                  )}
                </div>
                <div className="field"><label className="label" htmlFor="c-subj">Betreff</label><input className="input" id="c-subj" name="mailSubject" defaultValue={l.mailSubject ?? ""} /></div>
                <div className="field"><label className="label" htmlFor="c-body">Text</label><textarea className="textarea" id="c-body" name="mailBody" defaultValue={l.mailBody ?? ""} style={{ minHeight: 260 }} /></div>
                <SenderPicker options={senderOptions} defaultId={l.mailFromId && senders.boxes.some((b) => b.id === l.mailFromId) ? l.mailFromId : senders.defaultId} canEdit={canAccess(session, "posteingang")} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn btn-primary" type="submit">Gelesen – jetzt senden</button>
                  <button className="btn" type="submit" formAction={composeSaveAction}>Speichern</button>
                  <button className="btn" type="submit" formAction={redraftAction}>Neu formulieren (KI)</button>
                </div>
                <div className="small muted">Geht über das gewählte Postfach (beim nächsten Mal wieder vorausgewählt) · höchstens {DAILY_MAIL_LIMIT} pro Tag · nie doppelt an dieselbe Firma (auch nicht über eine andere Marke).</div>
              </form>
            )}
            {l.mailError && <div className="notice notice-warn small" data-testid="compose-error">{l.mailError}</div>}
          </section>

          {l.mailedAt && !l.repliedAt && (l.status === "angeschrieben" || l.status === "follow_up") && (
            <section className="card card-pad stack" style={{ gap: 8 }} data-testid="follow-up">
              <h2>Nachfassen</h2>
              {l.followUpAt ? (
                <div className="small">Nachfass-Mail gesendet am {l.followUpAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}.</div>
              ) : (
                <form action={followUpAction} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={l.id} />
                  <div className="small muted">Seit {daysSince(l.mailedAt)} Tagen keine Antwort. Kurze Erinnerung an {l.mailedTo}{l.mailFrom ? ` – von ${l.mailFrom}, wie die erste Anfrage` : ""} – mit Signatur und der ersten Anfrage als Zitat:</div>
                  <div className="field"><label className="label" htmlFor="fu-subj">Betreff</label><input className="input" id="fu-subj" name="subject" defaultValue={followUp.subject} /></div>
                  <div className="field"><label className="label" htmlFor="fu-body">Text</label><textarea className="textarea" id="fu-body" name="body" defaultValue={followUp.body} style={{ minHeight: 200 }} /></div>
                  <div><button className="btn btn-primary" type="submit">Nachfass-Mail senden</button></div>
                </form>
              )}
            </section>
          )}

          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Fundstellen</h2>
            <div className="small">
              {[l.street, [l.zip, l.city].filter(Boolean).join(" "), l.country].filter(Boolean).join(", ") || <span className="muted">Anschrift unbekannt</span>}
              {l.phone && <> · Tel. {l.phone}</>}
              {l.email && <> · {l.email}</>}
              {l.registerNumber && <> · {l.source === "lucid" ? "Reg.-Nr." : "Register-Nr."} {l.registerNumber}</>}
              {l.vatId && <> · USt-ID {l.vatId}</>}
              {l.registrationEnd && <span style={{ color: "var(--danger)" }}> · Registrierung beendet {l.registrationEnd}</span>}
            </div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="lead-findings">
              {l.findings.map((f, i) => (
                <li key={i}><strong>{f.label}</strong>{f.brand ? ` („${f.brand}“)` : ""}{f.detail ? `: ${f.detail}` : ""}{f.url && <> – <a href={f.url} target="_blank" rel="noreferrer">ansehen</a></>}</li>
              ))}
            </ul>
            {(l.brands !== null || l.source === "lucid") && (
              <div className="small">
                <div className="muted" style={{ marginBottom: 4 }}>Im Verpackungsregister gemeldete Marken:</div>
                {l.brands === null ? <span className="muted">{l.busy === "marken" ? "Markenliste wird geladen …" : (l.checkError ?? "Markenliste fehlt noch – wird automatisch nachgeladen.")}</span> : l.brands.map((b) => (
                  <span key={b} className={`tag ${brandMatches([b], brand) ? "tag-ok" : "tag-neutral"}`} style={{ marginRight: 4, marginBottom: 4, display: "inline-block" }}>{b}</span>
                ))}
              </div>
            )}
            {l.notes && <div className="small muted">{l.notes}</div>}
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }}>
            <div className="between">
              <h2>Prüfung per Websuche</h2>
              <form action={researchAction}><input type="hidden" name="ids" value={l.id} /><input type="hidden" name="back" value={`/lieferanten/finden/${l.id}`} /><button className="btn btn-small" type="submit" disabled={Boolean(l.busy)}>{l.checkedAt ? "Neu prüfen" : "Jetzt prüfen"}</button></form>
            </div>
            {!l.checkedAt && !l.checkError && <div className="small muted">Noch nicht geprüft.</div>}
            {l.checkError && !isBrandNote(l.checkError) && <div className="notice notice-warn small">{l.checkError}</div>}
            {l.summary && <div>{l.summary}</div>}
            <div className="small" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {l.website && <a href={l.website} target="_blank" rel="noreferrer">Website ↗</a>}
              {l.b2bUrl && <a href={l.b2bUrl} target="_blank" rel="noreferrer">B2B-/Händler-Zugang ↗</a>}
              {l.sellsBrand !== null && <span>{brand}: {l.sellsBrand ? "im Sortiment" : "nicht gefunden"}</span>}
            </div>
            {l.evidence.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {l.evidence.map((e, i) => <li key={i}><strong>{e.label}:</strong> {e.value}{e.url && <> – <a href={e.url} target="_blank" rel="noreferrer">Quelle</a></>}</li>)}
              </ul>
            )}
          </section>

          <form action={saveLeadAction} className="card card-pad stack" style={{ gap: 8 }}>
            <input type="hidden" name="id" value={l.id} />
            <input type="hidden" name="back" value={`/lieferanten/finden/${l.id}`} />
            <h2>Angaben</h2>
            <div className="field"><label className="label" htmlFor="kind">Einstufung</label><select className="select" id="kind" name="kind" defaultValue={l.kind}>{LEAD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k][0]}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="notes">Notizen</label><textarea className="textarea" id="notes" name="notes" defaultValue={l.notes ?? ""} style={{ minHeight: 60 }} /></div>
            <div><button className="btn" type="submit">Speichern</button></div>
          </form>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack" style={{ gap: 8 }}>
            <div className="between"><h2>Status</h2><Link className="small" href="/board">im Board ↗</Link></div>
            <form action={setStatusAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input type="hidden" name="ids" value={l.id} />
              {l.mailedAt && <button className="btn btn-small" type="submit" name="status" value="preisliste">Preisliste erhalten</button>}
              {l.mailedAt && <button className="btn btn-small" type="submit" name="status" value="abgeschlossen">Abgeschlossen</button>}
              <button className="btn btn-small" type="submit" name="status" value="kein_interesse">GH ist nix</button>
              <button className="btn btn-small" type="submit" name="status" value="ausgeschlossen">Ausschließen</button>
              {l.status !== "neu" && !l.mailedAt && <button className="btn btn-small" type="submit" name="status" value="neu">Zurücksetzen</button>}
            </form>
            {l.supplierId ? <div className="small">Als Lieferant angelegt – unter Einkauf auswählbar.</div> : (
              <form action={toSupplierAction}><input type="hidden" name="id" value={l.id} /><button className="btn btn-small" type="submit">Als Lieferant anlegen</button></form>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
