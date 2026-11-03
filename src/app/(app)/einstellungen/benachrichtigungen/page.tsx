import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { abos, protokoll } from "@/lib/push/service";
import { MELDE_ARTEN, RUHE_STANDARD, ZUSTAND_TEXT, artAn } from "@/lib/push/logic";
import { PushSchalter } from "@/components/push-schalter";
import { PushTest } from "@/components/push-test";
import { aboEntfernen, benachrichtigungenSpeichern, jetztAusliefern } from "./actions";

// Einstellungen → Benachrichtigungen (Bauauftrag Push-Handy, Teil A): Push aufs Handy ohne Discord – dieses Gerät
// einschalten und testen (mit Zustellzeit), Geräte, je Art an/aus, Ruhezeit (Standard 22–6 Uhr, nur „kritisch“) und
// das Protokoll je Meldung (Discord ja/nein, App-Push gesendet/zugestellt/fehlgeschlagen). Jede Person sieht nur ihre.

const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const artTitel = (k: string) => (k === "test" ? "Test" : (MELDE_ARTEN.find((a) => a.key === k)?.titel ?? k));

export default async function BenachrichtigungenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const p = (await getSettings(session.tenantId)).benachrichtigungen.personen[session.userId] ?? {};
  const ruheVon = p.ruheVon ?? RUHE_STANDARD.von;
  const ruheBis = p.ruheBis ?? RUHE_STANDARD.bis;
  const ohneRuhe = ruheVon === ruheBis;
  const [geraete, liste] = await Promise.all([abos(session.tenantId, session.userId), protokoll(session.tenantId, session.userId, 60)]);
  const gehalten = liste.filter((m) => m.zustand === "zurueckgehalten").length;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/einstellungen">Einstellungen</Link></div>
          <h1>Benachrichtigungen</h1>
          <div className="small muted">Wichtige Meldungen schickt das Seller-System selbst aufs Handy – unabhängig von Discord. Discord läuft parallel weiter.</div>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="benachrichtigungen-meldung">{sp.meldung}</div>}
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad stack" style={{ gap: 10 }} data-testid="push-geraet">
            <h2 style={{ margin: 0 }}>Dieses Gerät</h2>
            <PushSchalter />
            <PushTest />
            <div className="small muted">
              iPhone: Push gibt es nur in der App vom Home-Bildschirm (Safari → Teilen → „Zum Home-Bildschirm“, ab iOS 16.4). Zum Prüfen bei geschlossener App: „Test-Push“ tippen, App wegwischen, Mitteilung abwarten. Was am iPhone ankommt, erscheint automatisch auch auf der Apple Watch.
            </div>
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="push-arten">
            <h2 style={{ margin: 0 }}>Was gepusht wird</h2>
            <form action={benachrichtigungenSpeichern} className="stack" style={{ gap: 8 }}>
              {MELDE_ARTEN.map((a) => (
                <label key={a.key} className="small" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input type="checkbox" name={`art_${a.key}`} defaultChecked={artAn(a.key, p)} data-testid={`art-${a.key}`} style={{ marginTop: 3 }} />
                  <span>
                    <strong>{a.titel}</strong>
                    {"kritisch" in a && a.kritisch ? <span className="tag tag-critical" style={{ marginLeft: 6 }}>kritisch</span> : null}
                    <span className="muted"> – {a.text}</span>
                  </span>
                </label>
              ))}
              <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <strong className="small">Ruhezeit</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div className="field">
                    <label className="label" htmlFor="ruheVon">von</label>
                    <input className="input" type="time" id="ruheVon" name="ruheVon" defaultValue={ohneRuhe ? RUHE_STANDARD.von : ruheVon} data-testid="ruhe-von" />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="ruheBis">bis</label>
                    <input className="input" type="time" id="ruheBis" name="ruheBis" defaultValue={ohneRuhe ? RUHE_STANDARD.bis : ruheBis} data-testid="ruhe-bis" />
                  </div>
                  <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
                    <input type="checkbox" name="ohneRuhe" defaultChecked={ohneRuhe} data-testid="ruhe-aus" /> keine Ruhezeit
                  </label>
                </div>
                <div className="small muted">In der Ruhezeit kommt nur „kritisch“ (Amazon: Sperrung, Listing deaktiviert, Zahlung abgelehnt). Alles andere wird gesammelt und morgens mit dem Morgenbericht ausgeliefert.</div>
              </div>
              <div>
                <button className="btn btn-primary" type="submit" disabled={session.readOnly} data-testid="benachrichtigungen-speichern">Speichern</button>
              </div>
            </form>
          </section>

          <section className="card card-pad stack" style={{ gap: 8 }} data-testid="push-protokoll">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>Protokoll</h2>
              {gehalten > 0 && !session.readOnly && (
                <form action={jetztAusliefern}>
                  <button className="btn btn-sm" type="submit" data-testid="jetzt-ausliefern">{gehalten} zurückgehalten – jetzt ausliefern</button>
                </form>
              )}
            </div>
            {liste.length ? (
              <div className="table-wrap">
                <table className="table small">
                  <thead>
                    <tr><th>Zeit</th><th>Art</th><th>Meldung</th><th>Discord</th><th>App-Push</th><th>Zugestellt</th></tr>
                  </thead>
                  <tbody>
                    {liste.map((m) => (
                      <tr key={m.id} data-testid="protokoll-zeile" data-zustand={m.zustand} data-art={m.art}>
                        <td style={{ whiteSpace: "nowrap" }}>{zeit(m.createdAt)}</td>
                        <td>{artTitel(m.art)}{m.kritisch ? <span className="tag tag-critical" style={{ marginLeft: 4 }}>kritisch</span> : null}</td>
                        <td>{m.titel}</td>
                        <td data-testid="protokoll-discord">{m.discord === null ? <span className="muted">– (privat/nicht vorgesehen)</span> : m.discord ? "ja" : "nein"}</td>
                        <td>
                          <span className={`tag ${m.zustand === "gesendet" || m.zustand === "ausgeliefert" ? "tag-ok" : m.zustand === "fehlgeschlagen" ? "tag-critical" : "tag-neutral"}`}>{ZUSTAND_TEXT[m.zustand] ?? m.zustand}</span>
                          {m.pushGesendet + m.pushFehler > 1 ? <span className="muted"> ({m.pushGesendet}/{m.pushGesendet + m.pushFehler} Geräte)</span> : null}
                        </td>
                        <td data-testid="protokoll-zugestellt" style={{ whiteSpace: "nowrap" }}>{m.zugestelltAm ? `✓ ${zeit(m.zugestelltAm)}` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="small muted">Noch keine Meldungen.</div>
            )}
            <div className="small muted">„Zugestellt“ = das Gerät hat die Meldung abgeholt (die App holt den Inhalt nach dem Anstoß selbst – beim Push-Dienst liegt nichts Vertrauliches).</div>
          </section>
        </div>
        <aside className="col-side stack">
          <section className="card card-pad small stack" style={{ gap: 6 }} data-testid="push-geraete">
            <strong>Geräte mit Push</strong>
            {geraete.length ? (
              geraete.map((g) => (
                <div key={g.id} data-testid="push-geraet-zeile" data-stand={g.abgelaufenAm ? "abgelaufen" : "aktiv"} style={{ display: "flex", gap: 6, alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div>{g.geraet ?? "Gerät"} {g.abgelaufenAm ? <span className="tag tag-warn">abgelaufen</span> : <span className="tag tag-ok">aktiv</span>}</div>
                    <div className="muted">seit {zeit(g.createdAt)} · zuletzt ok {zeit(g.okAm)}{g.fehlerAnzahl ? ` · ${g.fehlerAnzahl} Fehlversuch${g.fehlerAnzahl === 1 ? "" : "e"}` : ""}</div>
                    {g.abgelaufenAm && <div className="muted">Wird beim nächsten Öffnen der App auf dem Gerät neu angefordert.</div>}
                  </div>
                  {!session.readOnly && (
                    <form action={aboEntfernen}>
                      <input type="hidden" name="id" value={g.id} />
                      <button className="btn btn-sm" type="submit" title="Gerät entfernen">✕</button>
                    </form>
                  )}
                </div>
              ))
            ) : (
              <div className="muted">Noch kein Gerät – links „Push auf diesem Gerät einschalten“.</div>
            )}
          </section>
          <section className="card card-pad small stack" style={{ gap: 6 }} data-testid="discord-iphone">
            <strong>Discord am iPhone (Gegencheck)</strong>
            <div className="muted">Discord schickt keine Handy-Pushs, solange du am Rechner aktiv bist. Wenn Discord-Meldungen am iPhone fehlen:</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Discord → Einstellungen → Benachrichtigungen → „Push-Benachrichtigungen“ auf <strong>„Immer“</strong> (statt „nur wenn inaktiv“).</li>
              <li>Server Lugru → Kanal Deals → Benachrichtigungen <strong>„Alle Nachrichten“</strong>.</li>
              <li>iPhone: Fokus / „Nicht stören“ prüfen.</li>
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
