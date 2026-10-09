import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_KINDS } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/leads/labels";
import { brandMatches, contactBlocker, isBrandNote } from "@/lib/leads/logic";
import { draftAction, researchAction, saveLeadAction, sendOneAction, setStatusAction, toSupplierAction } from "../actions";
import { AutoRefresh } from "../refresh";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("lieferanten");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const L = schema.supplierLeads;
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, session.tenantId)));
  if (!l) notFound();
  const brand = l.searchBrands[0] ?? "";
  const block = contactBlocker(l);

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
      {l.busy && <div className="notice notice-info small">Läuft gerade: {l.busy === "pruefen" ? "Websuche" : l.busy === "entwurf" ? "Entwurf" : "Markenliste"} …</div>}

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
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
            <h2>Anfrage</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="field"><label className="label" htmlFor="kind">Einstufung</label><select className="select" id="kind" name="kind" defaultValue={l.kind}>{LEAD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k][0]}</option>)}</select></div>
              <div className="field" style={{ flexGrow: 1 }}><label className="label" htmlFor="email">E-Mail für die Anfrage</label><input className="input" id="email" name="email" type="email" defaultValue={l.email ?? ""} /></div>
            </div>
            <div className="field"><label className="label" htmlFor="subj">Betreff</label><input className="input" id="subj" name="mailSubject" defaultValue={l.mailSubject ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="body">Text</label><textarea className="textarea" id="body" name="mailBody" defaultValue={l.mailBody ?? ""} style={{ minHeight: 240 }} /></div>
            <div className="field"><label className="label" htmlFor="notes">Notizen</label><textarea className="textarea" id="notes" name="notes" defaultValue={l.notes ?? ""} style={{ minHeight: 60 }} /></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" type="submit">Speichern</button>
              {/* Server-Action-Knöpfe dürfen kein eigenes name/value tragen (React überschreibt es) – die Kennung kommt als verstecktes Feld. */}
              <input type="hidden" name="ids" value={l.id} />
              <button className="btn" type="submit" formAction={draftAction}>{l.mailBody ? "Neu formulieren (KI)" : "Entwurf schreiben (KI)"}</button>
            </div>
          </form>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Senden</h2>
            {l.mailedAt ? (
              <div className="small">Gesendet am {l.mailedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} an {l.mailedTo}.{l.repliedAt && <><br /><strong>Antwort erhalten</strong> am {l.repliedAt.toLocaleDateString("de-DE")} – siehe Posteingang.</>}</div>
            ) : block && block !== "keine E-Mail-Adresse" ? (
              <div className="small" style={{ color: "var(--danger)" }}>{block}</div>
            ) : (
              <form action={sendOneAction} className="stack" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={l.id} />
                <label className="small" style={{ display: "flex", gap: 6 }}><input type="checkbox" name="confirm" /> Text geprüft, Firma tritt als Großhändler/B2B auf</label>
                <button className="btn btn-primary" type="submit" disabled={!l.mailBody || Boolean(block)}>{block ? block : "Anfrage senden"}</button>
                <div className="small muted">Geht über dein Standard-Postfach (Posteingang). Antworten werden automatisch erkannt.</div>
              </form>
            )}
            {l.mailError && <div className="notice notice-warn small">{l.mailError}</div>}
          </section>
          <section className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Status</h2>
            <form action={setStatusAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input type="hidden" name="ids" value={l.id} />
              <button className="btn btn-small" type="submit" name="status" value="kein_interesse">Kein Interesse</button>
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
