import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { integrationStatus } from "@/lib/integrations/store";
import { deleteIntegrationAction, saveIntegrationAction } from "./actions";
import { TestButton } from "./test-button";
import { SellerboardCard } from "./sellerboard-card";
import { FEHLT_OHNE } from "@/lib/integrations/fehlt";
import { ordnerName } from "@/lib/mail/ordner";
import { postfachStand } from "@/lib/mail/status";
import { ABRUF_PLAN, ABRUFE_JE_ANBINDUNG } from "@/lib/today/abruf-plan";
import { abrufListe } from "./abrufe";

// Einstellungen › Anbindungen: Zugangsdaten und Verbindungen. Abrufe und Importe stehen im Reiter
// „Hintergrund & Importe“ (/einstellungen/hintergrund).

/** Anmeldung per OAuth für Postfächer – nur optional („Erweitert“); Standard ist IMAP mit App-Passwort. */
const OAUTH_POSTFACH = new Set(["google", "microsoft"]);
const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : null);

export default async function AnbindungenPage({ searchParams }: { searchParams: Promise<{ p?: string; sellerboard?: string }> }) {
  const session = await requireOwner();
  const { p, sellerboard } = await searchParams;
  const status = await integrationStatus(session.tenantId);
  const [postfach, abrufe] = await Promise.all([postfachStand(session.tenantId), abrufListe(session.tenantId)]);

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
      <section className="card card-pad small" data-testid="hinweis-hintergrund">
        Hintergrund-Abrufe (letzter/nächster Lauf), Amazon-Berichte sofort anfordern, Discord live und die Importe (ArbitrageOne, BQool-Uploads) stehen im eigenen Reiter <Link href="/einstellungen/hintergrund">Hintergrund &amp; Importe</Link>.
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
        <SellerboardCard tenantId={session.tenantId} message={sellerboard} />
        <section className="card" id="postfaecher" data-testid="anbindung-postfaecher">
          <div className="card-head">
            <div>
              <h2>Postfächer (IMAP mit App-Passwort)</h2>
              <div className="small muted" style={{ marginTop: 2 }}>Seller-Central-, eBay- und Kundenmails abrufen und darüber senden. Standard: Adresse + App-Passwort, Server werden erkannt.</div>
            </div>
            <a className="btn btn-small" href="/posteingang/verbinden">Postfach verbinden</a>
          </div>
          <div className="card-pad stack" style={{ gap: 8 }}>
            {postfach.warnung && <div className="notice notice-warn small" data-testid="amazon-mail-warnung">{postfach.warnung}</div>}
            {postfach.postfaecher.map((b) => (
              <div key={b.id} className="small" data-testid="anbindung-postfach">
                <strong style={{ overflowWrap: "anywhere" }}>{b.adresse}</strong> <span className="tag tag-neutral">{b.art}</span>{b.nurAbruf && <> <span className="tag tag-neutral">NUR ABRUF</span></>}{!b.aktiv && <> <span className="tag tag-neutral">PAUSIERT</span></>}
                <div className="muted">
                  {b.letzterAbruf ? `Zuletzt abgerufen: ${zeit(b.letzterAbruf)}` : "Noch nicht abgerufen"}
                  {b.imap && ` · Ordner: ${b.ordner ? b.ordner.map(ordnerName).join(", ") : "automatisch"}`}
                  {` · letzte Amazon-Mail: ${zeit(b.letzteAmazonMail) ?? "keine"}`}
                </div>
                {b.fehler && <div style={{ color: "var(--danger)" }}>{b.fehlerArt ? <strong>{b.fehlerArt}: </strong> : null}{b.fehler}</div>}
              </div>
            ))}
            <div><a className="btn-link small" href="/einstellungen#postfaecher">Postfächer verwalten (Ordner, Test, nur Abruf)</a></div>
          </div>
        </section>
        {INTEGRATIONS.filter((d) => !OAUTH_POSTFACH.has(d.provider)).map((def) => karte(def))}
        <details className="card card-pad" id="erweitert" open={OAUTH_POSTFACH.has(p ?? "")} data-testid="anbindung-erweitert">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Erweitert: Postfächer per Google-/Microsoft-Anmeldung (OAuth, optional)</summary>
          <div className="small muted" style={{ margin: "8px 0 12px" }}>
            {postfach.nurImap ? "Nicht nötig – deine Postfächer laufen über IMAP mit App-Passwort." : "Nur nötig, wenn ein Anbieter keine App-Passwörter erlaubt."}
          </div>
          <div className="stack" style={{ gap: 14 }}>{INTEGRATIONS.filter((d) => OAUTH_POSTFACH.has(d.provider)).map((def) => karte(def, true))}</div>
        </details>
      </div>
    </>
  );

  function karte(def: (typeof INTEGRATIONS)[number], optional = false) {
    const st = status.get(def.provider);
    const open = p === def.provider;
    return (
            <section key={def.provider} className="card" id={def.provider}>
              <div className="card-head">
                <div>
                  <h2>{def.name}</h2>
                  <div className="small muted" style={{ marginTop: 2 }}>{def.purpose}</div>
                  {!st && FEHLT_OHNE[def.provider] && <div className="small" style={{ marginTop: 4 }} data-testid={`fehlt-${def.provider}`}><strong>Ohne diese Anbindung fehlen:</strong> {FEHLT_OHNE[def.provider]}.</div>}
                  {st && (ABRUFE_JE_ANBINDUNG[def.provider] ?? []).length > 0 && (
                    <div className="small muted" style={{ marginTop: 4 }} data-testid={`intervall-${def.provider}`}>
                      {(ABRUFE_JE_ANBINDUNG[def.provider] ?? []).map((name) => {
                        const a = abrufe.find((x) => x.name === name);
                        const plan = ABRUF_PLAN[name] ?? a?.plan;
                        return `${name}: ${plan ? plan.text.replace(/^(Zeitplan|Auslöser): /, "") : "noch kein Lauf"}${a?.letzter ? ` (zuletzt ${zeit(a.letzter)})` : ""}`;
                      }).join(" · ")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {st ? <span className="tag tag-ok">EINGERICHTET</span> : <span className="tag tag-neutral">{optional ? "OPTIONAL" : "NICHT VERBUNDEN"}</span>}
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
                            <input className="input" id={`${def.provider}-${f.key}`} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" defaultValue={f.secret ? "" : (st?.config[f.key] || (f.vorbelegen && st?.config[f.vorbelegen.aus]?.toLowerCase().includes(f.vorbelegen.von) ? st.config[f.vorbelegen.aus]!.replace(new RegExp(f.vorbelegen.von, "i"), f.vorbelegen.nach) : ""))} placeholder={f.secret && has ? "•••••• (unverändert)" : f.placeholder} />
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
  }
}
