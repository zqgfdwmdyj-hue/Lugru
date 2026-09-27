import { requireOwner } from "@/lib/auth/session";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { integrationStatus } from "@/lib/integrations/store";
import { deleteIntegrationAction, saveIntegrationAction } from "./actions";
import { TestButton } from "./test-button";

export default async function AnbindungenPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const session = await requireOwner();
  const { p } = await searchParams;
  const status = await integrationStatus(session.tenantId);

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
      <div className="stack" style={{ gap: 14 }}>
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
                          {f.multiline ? (
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
