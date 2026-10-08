import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { brandMatches, contactBlocker } from "@/lib/leads/logic";
import { DAILY_MAIL_LIMIT, sentToday } from "@/lib/leads/service";
import { draftAction, researchAction, searchRegisterAction, sendAction, setStatusAction } from "./actions";
import { AutoRefresh, SelectAll } from "./refresh";
import { KIND_LABEL, STATUS_LABEL } from "@/lib/leads/labels";

const VIEWS = { offen: "Offen", grosshandel: "Großhändler", entwurf: "Entwürfe", angeschrieben: "Angeschrieben", ausgeschlossen: "Ausgeschlossen" } as const;
type View = keyof typeof VIEWS;

export default async function GrosshaendlerFindenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; marke?: string; meldung?: string }> }) {
  const session = await requireArea("lieferanten");
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "offen";
  const t = session.tenantId;
  const L = schema.supplierLeads;
  const where: SQL[] = [eq(L.tenantId, t)];
  if (view === "offen") where.push(inArray(L.status, ["neu", "geprueft"]));
  if (view === "grosshandel") where.push(eq(L.kind, "grosshandel"), ne(L.status, "ausgeschlossen"));
  if (view === "entwurf") where.push(eq(L.status, "entwurf"));
  if (view === "angeschrieben") where.push(isNotNull(L.mailedAt));
  if (view === "ausgeschlossen") where.push(inArray(L.status, ["ausgeschlossen", "kein_interesse"]));
  const rows = await db.select().from(L).where(and(...where)).orderBy(desc(L.score), L.companyName).limit(400);
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      busyBrands: sql<number>`count(*) filter (where ${L.busy} = 'marken')::int`,
      busyCheck: sql<number>`count(*) filter (where ${L.busy} = 'pruefen')::int`,
      busyDraft: sql<number>`count(*) filter (where ${L.busy} = 'entwurf')::int`,
      wholesale: sql<number>`count(*) filter (where ${L.kind} = 'grosshandel' and ${L.status} <> 'ausgeschlossen')::int`,
      replies: sql<number>`count(*) filter (where ${L.status} = 'antwort')::int`,
    })
    .from(L)
    .where(eq(L.tenantId, t));
  const busy = counts.busyBrands + counts.busyCheck + counts.busyDraft > 0;
  const today = await sentToday(t);

  return (
    <>
      <AutoRefresh active={busy} />
      <div className="page-head">
        <div><div className="crumb"><Link href="/lieferanten">Lieferanten</Link></div><h1>Großhändler finden</h1></div>
      </div>

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Im Verpackungsregister suchen</h2>
        <div className="small muted">
          Im öffentlichen Register (LUCID) steht jede Firma, die Ware einer Marke in Deutschland in Verkehr bringt – also auch Importeure und Großhändler.
          Viele Marken im Eintrag sprechen für einen Händler. Danach prüft die KI per Websuche, wer wirklich an Wiederverkäufer liefert, und findet die Einkaufs-E-Mail.
        </div>
        <form action={searchRegisterAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="sr-only" htmlFor="brand">Marke</label>
          <input className="input" id="brand" name="brand" defaultValue={sp.marke ?? ""} placeholder="Marke, z. B. Wella" required style={{ maxWidth: 260 }} />
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="onlyActive" defaultChecked /> nur aktive Registrierungen</label>
          <button className="btn btn-primary" type="submit">Register abfragen</button>
        </form>
      </section>

      {sp.meldung && <div className="notice notice-info" data-testid="leads-msg">{sp.meldung}</div>}
      {busy && (
        <div className="notice notice-info small" data-testid="leads-busy">
          Läuft im Hintergrund: {[counts.busyBrands && `${counts.busyBrands} Markenlisten`, counts.busyCheck && `${counts.busyCheck} Websuchen`, counts.busyDraft && `${counts.busyDraft} Entwürfe`].filter(Boolean).join(", ")} – die Liste aktualisiert sich von selbst.
        </div>
      )}

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Kontakte</div><div className="kpi-value">{counts.total}</div></div>
        <div className="card card-pad"><div className="kpi-label">Großhändler (geprüft)</div><div className="kpi-value">{counts.wholesale}</div></div>
        <div className="card card-pad"><div className="kpi-label">Heute angeschrieben</div><div className="kpi-value">{today} / {DAILY_MAIL_LIMIT}</div></div>
        <div className="card card-pad"><div className="kpi-label">Antworten</div><div className="kpi-value">{counts.replies}</div></div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/lieferanten/finden?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
      </div>

      <form className="stack" style={{ gap: 10 }}>
        <section className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}><SelectAll /></th>
                <th>Firma</th>
                <th>Marken im Register</th>
                <th className="right">Score</th>
                <th>Einstufung</th>
                <th>Kontakt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="muted">Keine Einträge in dieser Ansicht. Oben eine Marke im Register suchen.</td></tr>}
              {rows.map((l) => {
                const brand = l.searchBrands[0] ?? "";
                const block = contactBlocker(l);
                return (
                  <tr key={l.id} data-testid="lead-row" data-name={l.companyName}>
                    <td><input type="checkbox" name="ids" value={l.id} aria-label={`${l.companyName} auswählen`} /></td>
                    <td style={{ maxWidth: 260 }}>
                      <Link href={`/lieferanten/finden/${l.id}`}><strong>{l.companyName}</strong></Link>
                      <div className="small muted">{[l.zip, l.city].filter(Boolean).join(" ")}{l.country ? ` · ${l.country}` : ""}</div>
                    </td>
                    <td className="small" style={{ maxWidth: 300 }}>
                      {l.brands === null ? <span className="muted">wird geladen …</span> : (
                        <>
                          <strong>{l.brands.length}</strong>{" "}
                          {l.brands.slice(0, 8).map((b) => (
                            <span key={b} className={`tag ${brandMatches([b], brand) ? "tag-ok" : "tag-neutral"}`} style={{ marginRight: 3, marginBottom: 2, display: "inline-block" }}>{b}</span>
                          ))}
                          {l.brands.length > 8 && <span className="muted">+{l.brands.length - 8}</span>}
                        </>
                      )}
                    </td>
                    <td className="num right">{l.score}</td>
                    <td className="small">
                      <span className={`tag ${KIND_LABEL[l.kind][1]}`}>{KIND_LABEL[l.kind][0]}</span>
                      {l.checkedAt ? <span className="muted"> · geprüft</span> : l.busy === "pruefen" ? <span className="muted"> · prüft …</span> : null}
                      {l.summary && <div className="muted" style={{ maxWidth: 260 }}>{l.summary}</div>}
                      {l.checkError && <div style={{ color: "var(--danger)" }}>{l.checkError}</div>}
                    </td>
                    <td className="small" style={{ maxWidth: 220, wordBreak: "break-all" }}>
                      {l.website && <div><a href={l.website} target="_blank" rel="noreferrer">{new URL(l.website).hostname}</a></div>}
                      {l.email && <div>{l.email}</div>}
                      {l.b2bUrl && <div><a href={l.b2bUrl} target="_blank" rel="noreferrer">B2B-Zugang</a></div>}
                      {!l.website && !l.email && <span className="muted">{l.phone ?? "–"}</span>}
                    </td>
                    <td className="small">
                      <span className={`tag ${l.status === "antwort" ? "tag-ok" : l.status === "angeschrieben" ? "tag-info" : "tag-neutral"}`}>{STATUS_LABEL[l.status]}</span>
                      {l.busy === "entwurf" && <div className="muted">schreibt …</div>}
                      {view === "entwurf" && l.mailSubject && <div className="muted" style={{ maxWidth: 260 }}>{l.mailSubject}</div>}
                      {view === "entwurf" && block && <div style={{ color: "var(--danger)" }}>{block}</div>}
                      {l.mailError && <div style={{ color: "var(--danger)" }}>{l.mailError}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card card-pad stack" style={{ gap: 10 }}>
          <h2>Mit der Auswahl</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" type="submit" formAction={researchAction}>Per Websuche prüfen</button>
            <button className="btn" type="submit" formAction={setStatusAction} name="status" value="ausgeschlossen">Ausschließen</button>
            {view === "ausgeschlossen" && <button className="btn" type="submit" formAction={setStatusAction} name="status" value="neu">Wieder aufnehmen</button>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" name="wish" placeholder="Worum geht es? z. B. „Wella Professionals Haarpflege, laufender Bedarf“" style={{ maxWidth: 420 }} />
            <button className="btn" type="submit" formAction={draftAction}>Anfrage-Entwürfe erstellen</button>
          </div>
          {view === "entwurf" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="confirm" /> Ich habe die ausgewählten Entwürfe gelesen</label>
              <button className="btn btn-primary" type="submit" formAction={sendAction}>Ausgewählte senden</button>
              <span className="small muted">höchstens {DAILY_MAIL_LIMIT} pro Tag · nie doppelt · Privatpersonen, Salons und Marktplätze nie</span>
            </div>
          )}
          <div className="small muted">
            Wichtig: Unaufgeforderte E-Mails an Firmen können in Deutschland auch als Einkaufsanfrage als Werbung gelten (§ 7 UWG, Abmahnrisiko).
            Deshalb nur einzeln geprüfte, persönliche Anfragen an Firmen, die selbst als Großhändler/B2B auftreten – bevorzugt über deren Händler-Kontakt oder B2B-Registrierung. Jede Mail enthält einen Satz, dass eine kurze Absage genügt.
          </div>
        </section>
      </form>
    </>
  );
}
