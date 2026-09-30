import { requireOwner } from "@/lib/auth/session";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { integrationStatus } from "@/lib/integrations/store";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { REPORT_KINDS } from "@/lib/reports/amazon";
import { deleteIntegrationAction, requestAmazonReport, runAllNow, saveIntegrationAction } from "./actions";
import { TestButton } from "./test-button";

export default async function AnbindungenPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const session = await requireOwner();
  const { p } = await searchParams;
  const status = await integrationStatus(session.tenantId);
  const reports = await db.select().from(schema.apiReportRequests).where(eq(schema.apiReportRequests.tenantId, session.tenantId)).orderBy(desc(schema.apiReportRequests.requestedAt)).limit(12);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Einstellungen</div>
          <h1>Anbindungen</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        Zugangsdaten werden verschlüsselt gespeichert. Geheime Felder werden nie wieder angezeigt – leer lassen, um den gespeicherten Wert zu behalten.
        Bis eine Anbindung steht, lassen sich die meisten Daten auch als Datei importieren.
      </p>
      <section className="card card-pad stack">
        <div className="between">
          <h2>Hintergrund-Abrufe</h2>
          <form action={runAllNow}><button className="btn btn-small" type="submit">Jetzt alles abrufen</button></form>
        </div>
        <div className="small muted">Postfächer, Amazon- und eBay-Bestellungen alle 15 Minuten, Amazon-Reports nach Plan (Bestand alle 4 Std., Protokolle täglich), Rechnungen stündlich.</div>
        {status.get("amazon_sp") && (
          <form action={requestAmazonReport} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label htmlFor="rk" className="small">Amazon-Report sofort anfordern:</label>
            <select className="select" id="rk" name="kind" style={{ width: 280 }}>{Object.entries(REPORT_KINDS).filter(([k]) => k !== "settlement").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn btn-small" type="submit">Anfordern</button>
          </form>
        )}
        {reports.length > 0 && (
          <table className="table">
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}><td className="num small">{r.requestedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td><td className="small">{r.reportType}</td><td className="small">{r.status === "pending" ? "wartet auf Amazon" : r.status === "done" ? "übernommen" : `Fehler: ${r.error ?? ""}`}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="stack" style={{ gap: 14 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>eBay</h2>
              <div className="small muted" style={{ marginTop: 2 }}>Artikel einstellen, Rechnungen, Bestellungen abholen, Sendungsnummer zurückmelden.</div>
            </div>
            <a className="btn btn-small" href="/ebay?ansicht=einstellungen">Zu den eBay-Einstellungen</a>
          </div>
          <div className="card-pad small muted">Die eBay-Verbindung wird im eBay-Bereich eingerichtet (Zugang, Anmeldung, Verkaufsprofile, Artikelstandort) und gilt für alles, was mit eBay zu tun hat.</div>
        </section>
        {INTEGRATIONS.map((def) => {
          const st = status.get(def.provider);
          const open = p === def.provider;
          return (
            <section key={def.provider} className="card" id={def.provider}>
              <div className="card-head">
                <div>
                  <h2>{def.name}</h2>
                  <div className="small muted" style={{ marginTop: 2 }}>{def.purpose}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {st ? <span className="tag tag-ok">EINGERICHTET</span> : <span className="tag tag-neutral">NICHT VERBUNDEN</span>}
                  <a className="btn btn-small" href={open ? "/anbindungen" : `/anbindungen?p=${def.provider}#${def.provider}`}>{open ? "Schließen" : "Bearbeiten"}</a>
                </div>
              </div>
              {open && (
                <div className="row" style={{ padding: 20 }}>
                  <form action={saveIntegrationAction} className="stack" style={{ flexGrow: 1, gap: 12, maxWidth: 560 }}>
                    <input type="hidden" name="provider" value={def.provider} />
                    {def.fields.map((f) => {
                      const has = f.secret ? st?.secretKeys.includes(f.key) : Boolean(st?.config[f.key]);
                      return (
                        <div className="field" key={f.key}>
                          <label className="label" htmlFor={`${def.provider}-${f.key}`}>
                            {f.label} {f.secret && has && <span className="tag tag-ok" style={{ marginLeft: 6 }}>GESPEICHERT</span>}
                          </label>
                          {f.options ? (
                            <select className="input" id={`${def.provider}-${f.key}`} name={f.key} defaultValue={st?.config[f.key] || f.options[0].value}>
                              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : f.multiline ? (
                            <textarea className="textarea" style={{ minHeight: 120, fontFamily: "var(--mono)", fontSize: 12 }} id={`${def.provider}-${f.key}`} name={f.key} placeholder={f.secret && has ? "•••••• (unverändert)" : f.placeholder} />
                          ) : (
                            <input className="input" id={`${def.provider}-${f.key}`} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" defaultValue={f.secret ? "" : (st?.config[f.key] ?? "")} placeholder={f.secret && has ? "•••••• (unverändert)" : f.placeholder} />
                          )}
                          {f.help && <span className="small muted">{f.help}</span>}
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary" type="submit">Speichern</button>
                    </div>
                  </form>
                  <div className="col-side">
                    <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
                      <h2 style={{ fontSize: 14, marginBottom: 8 }}>So richtest du es ein</h2>
                      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                        {def.setup.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                      </ol>
                    </div>
                    {st && <TestButton provider={def.provider} />}
                    {st && (
                      <form action={deleteIntegrationAction}>
                        <input type="hidden" name="provider" value={def.provider} />
                        <button className="btn-link small" style={{ color: "var(--danger)" }} type="submit">Anbindung entfernen</button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
