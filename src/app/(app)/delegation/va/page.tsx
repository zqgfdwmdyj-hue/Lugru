import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { vaAufgaben, vaAuswahl, vaHeute, vaNachrichtenListe, vaSpracheAktuell, vaStatus, VN_ART, VT_STATUS } from "@/lib/va/service";
import { glossarAlsText } from "@/lib/va/sprache";
import { AntwortForm } from "./antwort-form";
import { abgleichAction, antwortAction, anVaAction, einstellungenAction } from "./actions";

// VA über Discord: Status, offene Fragen der VA (Antwort geht in ihren Thread), Aufgabe abgeben, Aufgaben bei der
// VA, letzte Nachrichten mit Einordnung, Einstellungen (Zeitzone, Ruhezeiten, Erinnerungen, Rechnungen).

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function VaPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireOwner();
  const t = session.tenantId;
  const sp = await searchParams;
  const heute = todayIso();
  const seit = new Date(Date.now() - 7 * 86_400_000);
  const [st, offen, aufgaben, nachrichten, auswahl, tag, s, vaSpr] = await Promise.all([vaStatus(t), vaNachrichtenListe(t, { nurOffen: true, limit: 50 }), vaAufgaben(t), vaNachrichtenListe(t, { seit, limit: 60 }), vaAuswahl(t), vaHeute(t, heute), getSettings(t), vaSpracheAktuell(t)]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">
            <Link href="/delegation">Delegation</Link>
          </div>
          <h1>VA (Discord)</h1>
          <div className="small muted">Aufgaben gehen als eigener Thread in den VA-Kanal. ✅ oder „erledigt“ hakt ab, Fragen landen hier. Datenfragen (Rechnungen, Sendungen, Ansprüche, Aufträge, Produkte, Anleitungen) beantwortet das System selbst.</div>
        </div>
        {st.eingerichtet && (
          <form action={abgleichAction}>
            <button className="btn" type="submit" data-testid="va-abgleich">Jetzt abgleichen</button>
          </form>
        )}
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="va-meldung">{sp.meldung}</div>}

      <section className="card card-pad small" style={{ marginBottom: 14 }} data-testid="va-status">
        {!st.eingerichtet ? (
          <>
            Noch nicht eingerichtet – <Link href="/einstellungen/anbindungen">Einstellungen → Anbindungen → „Discord – VA-Kanal“</Link> (Bot-Token, Kanal, Discord-Nutzer der VA, Konto der VA).
          </>
        ) : (
          <>
            <div>
              {tag?.text ?? "VA heute: –"} · Konto der VA: {st.vaKonto ?? <span className="tag tag-warn">keins hinterlegt – keine automatischen Antworten außer Rechnungen</span>}
            </div>
            <div className="muted">
              Letzter Abgleich: {st.letzterAbgleich ? zeit(st.letzterAbgleich) : "noch keiner"} (automatisch alle 30 Sekunden)
              {st.letzterFehler && <span className="tag tag-critical" style={{ marginLeft: 6 }}>{st.letzterFehler}</span>}
            </div>
            {st.kontoFehlt && <div className="notice notice-warn" style={{ marginTop: 6 }}>Das eingetragene Konto der VA gibt es in diesem System nicht.</div>}
          </>
        )}
      </section>

      <div className="row">
        <section className="stack" style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <div className="card card-pad" data-testid="va-offen">
            <h2 style={{ marginTop: 0 }}>Wartet auf deine Antwort ({offen.length})</h2>
            {offen.length === 0 ? (
              <p className="small muted">Keine offenen Fragen der VA.</p>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {offen.map(({ n, aufgabe }) => (
                  <div key={n.id} className="card card-pad" data-testid="va-frage">
                    <div className="small muted">
                      {zeit(n.gesendetAm)} · {VN_ART[n.art] ?? n.art}
                      {aufgabe ? ` · ${aufgabe}` : ""}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", margin: "4px 0 8px" }}>{n.text}</div>
                    {n.original && (
                      <details className="small" style={{ marginBottom: 6 }} data-testid="va-original">
                        <summary style={{ cursor: "pointer" }}>Original ({(n.sprache ?? "en").toUpperCase()})</summary>
                        <div style={{ whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>{n.original}</div>
                      </details>
                    )}
                    {n.dateiIds.length > 0 && (
                      <div className="small">
                        {n.dateiIds.map((d, i) => (
                          <a key={d} href={`/datei/${d}`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                            📎 Datei {i + 1}
                          </a>
                        ))}
                      </div>
                    )}
                    <AntwortForm nachrichtId={n.id} englisch={vaSpr !== "de"} vorschauOffen={s.va.antwortVorschau} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card card-pad" data-testid="va-aufgaben">
            <h2 style={{ marginTop: 0 }}>Aufgaben bei der VA ({aufgaben.filter((a) => a.status !== "erledigt").length} offen)</h2>
            {aufgaben.length === 0 ? (
              <p className="small muted">Noch keine Aufgabe über Discord abgegeben.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Aufgabe</th>
                      <th>Frist</th>
                      <th>Status</th>
                      <th>seit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aufgaben.map((a) => (
                      <tr key={a.id}>
                        <td>{a.titel}</td>
                        <td>{a.faellig && a.faellig < heute && a.status !== "erledigt" ? <span className="tag tag-critical">{dmy(a.faellig)}</span> : dmy(a.faellig)}</td>
                        <td>
                          <span className={`tag ${a.status === "erledigt" ? "tag-ok" : a.status === "rueckfrage" ? "tag-warn" : ""}`}>{VT_STATUS[a.status]}</span>
                        </td>
                        <td>{a.seit.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card card-pad" data-testid="va-nachrichten">
            <h2 style={{ marginTop: 0 }}>Nachrichten der VA (7 Tage)</h2>
            {nachrichten.length === 0 ? (
              <p className="small muted">Keine Nachrichten.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table small">
                  <tbody>
                    {nachrichten.map(({ n, aufgabe }) => (
                      <tr key={n.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{zeit(n.gesendetAm)}</td>
                        <td>
                          <span className="tag">{VN_ART[n.art] ?? n.art}</span>
                          {n.autoBeantwortet && <span className="tag tag-ok">automatisch beantwortet</span>}
                        </td>
                        <td>
                          {n.text.slice(0, 300)}
                          {n.original && (
                            <details>
                              <summary style={{ cursor: "pointer" }} className="muted">Original ({(n.sprache ?? "en").toUpperCase()})</summary>
                              <div style={{ whiteSpace: "pre-wrap" }}>{n.original.slice(0, 600)}</div>
                            </details>
                          )}
                          {aufgabe && <div className="muted">→ {aufgabe}</div>}
                          {n.antwort && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>↳ {n.antwort.slice(0, 300)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <aside className="col-side">
          {st.eingerichtet && (
            <div className="card card-pad" data-testid="va-geben">
              <h2 style={{ marginTop: 0 }}>An die VA geben</h2>
              <form action={anVaAction} className="stack" style={{ gap: 8 }}>
                <select name="id" required data-testid="va-aufgabe-wahl" defaultValue="">
                  <option value="" disabled>
                    Aufgabe wählen …
                  </option>
                  {auswahl.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title.slice(0, 80)}
                      {a.dueDate ? ` (${dmy(a.dueDate)})` : ""}
                    </option>
                  ))}
                </select>
                <textarea name="notiz" rows={2} placeholder="Notiz für die VA (optional)" maxLength={1500} />
                <button className="btn btn-primary" type="submit" data-testid="va-geben-senden">An VA geben</button>
                <div className="small muted">Passende Anleitungen hängen automatisch an. Links nur zu Bereichen, die die VA sehen darf – sonst ohne Beträge.</div>
              </form>
            </div>
          )}
          <div className="card card-pad" data-testid="va-einstellungen">
            <h2 style={{ marginTop: 0 }}>Einstellungen</h2>
            <form action={einstellungenAction} className="stack" style={{ gap: 8 }}>
              <label className="small">
                Zeitzone der VA
                <input name="zeitzone" defaultValue={s.va.zeitzone} placeholder="Europe/Berlin" />
              </label>
              <div className="small" style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <label>
                  Ruhezeit von
                  <input name="ruheVon" defaultValue={s.va.ruheVon} placeholder="20:00" size={5} />
                </label>
                <label>
                  bis
                  <input name="ruheBis" defaultValue={s.va.ruheBis} placeholder="08:00" size={5} />
                </label>
              </div>
              <label className="small">
                <input type="checkbox" name="erinnerungUeberfaellig" defaultChecked={s.va.erinnerungUeberfaellig} /> Überfällige Aufgaben täglich erinnern
              </label>
              <label className="small">
                <input type="checkbox" name="darfEinkaufsrechnungen" defaultChecked={s.va.darfEinkaufsrechnungen} /> VA darf Einkaufsrechnungen sehen (automatisch schicken)
              </label>
              <label className="small">
                Sprache der VA
                <select name="sprache" defaultValue={s.va.sprache} data-testid="va-sprache">
                  <option value="en">Englisch</option>
                  <option value="de">Deutsch</option>
                </select>
              </label>
              <div className="small muted">Gilt, wenn am Konto der VA keine eigene Sprache steht (Einstellungen → Benutzer). Aktuell: {vaSpr === "en" ? "Englisch" : "Deutsch"}.</div>
              <label className="small">
                <input type="checkbox" name="antwortVorschau" defaultChecked={s.va.antwortVorschau} /> Antworten vor dem Senden auf Englisch zeigen
              </label>
              <label className="small">
                Glossar (Deutsch = Englisch, je Zeile)
                <textarea name="glossar" rows={6} defaultValue={glossarAlsText(s.va.glossar)} data-testid="va-glossar" />
              </label>
              <div className="small muted">SKUs, ASINs, Bestell- und Fallnummern, Beträge und Links werden nie übersetzt.</div>
              <button className="btn" type="submit">Speichern</button>
              <div className="small muted">In der Ruhezeit keine Erinnerungen; neue Nachrichten gehen dann ohne Benachrichtigung raus.</div>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}
