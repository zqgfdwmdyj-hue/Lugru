import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { vaAufgaben, vaAuswahl, vaHeute, vaNachrichtenListe, vaSpracheAktuell, vaStatus, VN_ART, VT_STATUS } from "@/lib/va/service";
import { glossarAlsText } from "@/lib/va/sprache";
import { anspruecheBeiVa, automatikHeute, automatikListe, VA_STATUS_LABEL } from "@/lib/va/automatik";
import { VA_KATEGORIE_LABEL, VA_KATEGORIEN, VA_ZIEL_LABEL } from "@/lib/va/automatik-logic";
import { AntwortForm } from "./antwort-form";
import { abgleichAction, antwortAction, anVaAction, automatikAnVaAction, automatikEinstellungenAction, einstellungenAction } from "./actions";

// VA über Discord: Status, offene Fragen der VA (Antwort geht in ihren Thread), Aufgabe abgeben, Aufgaben bei der
// VA, letzte Nachrichten mit Einordnung, Einstellungen (Zeitzone, Ruhezeiten, Erinnerungen, Rechnungen),
// VA-Automatik (B18): Ansprüche bei der VA, Entscheidungen je Anspruch/Fall, Regeln je Kategorie.

const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const STATUS_TAG: Record<string, string> = { gesendet: "tag-ok", sammel: "tag-ok", uebernommen: "tag-ok", vorschlag: "tag-info", ludwig: "tag-warn", nie: "", fehler: "tag-critical" };

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** B20.9: Sprachkennzeichen je VA-Nachricht – übersetzte Nachrichten „EN → DE“, sonst die Sprache der Nachricht. */
const spracheTag = (n: { original: string | null; sprache: string | null }) => (n.original ? `${(n.sprache ?? "en").toUpperCase()} → DE` : (n.sprache ?? "de").toUpperCase());

export default async function VaPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireOwner();
  const t = session.tenantId;
  const sp = await searchParams;
  const heute = todayIso();
  const seit = new Date(Date.now() - 7 * 86_400_000);
  const [st, offen, aufgaben, nachrichten, auswahl, tag, s, vaSpr, entscheidungen, ansprueche] = await Promise.all([
    vaStatus(t),
    vaNachrichtenListe(t, { nurOffen: true, limit: 50 }),
    vaAufgaben(t),
    vaNachrichtenListe(t, { seit, limit: 60 }),
    vaAuswahl(t),
    vaHeute(t, heute),
    getSettings(t),
    vaSpracheAktuell(t),
    automatikListe(t, { tage: 7, limit: 100 }),
    anspruecheBeiVa(t),
  ]);
  const a = s.va.automatik;
  const zahl = await automatikHeute(t, s.va.zeitzone);

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
              {tag ? <span className={tag.fristenVerpasst > 0 ? "tag tag-critical" : undefined} data-testid="va-heute">{tag.text}</span> : "VA heute: –"} · Konto der VA: {st.vaKonto ?? <span className="tag tag-warn">keins hinterlegt – keine automatischen Antworten außer Rechnungen</span>}
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
                      {aufgabe ? ` · ${aufgabe}` : ""} <span className="tag" data-testid="va-sprache-tag" title="Sprache der Nachricht (übersetzt → Deutsch)">{spracheTag(n)}</span>
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

          <div className="card card-pad" data-testid="va-ansprueche">
            <h2 style={{ marginTop: 0 }}>Ansprüche bei der VA ({ansprueche.filter((x) => x.status !== "erledigt").length} offen)</h2>
            {ansprueche.length === 0 ? (
              <p className="small muted">Noch kein Anspruch über Discord an die VA gegangen.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Anspruch</th>
                      <th>Frist</th>
                      <th>Betrag</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ansprueche.map((x) => (
                      <tr key={x.threadId}>
                        <td>
                          <Link href={`/ansprueche/${x.claimId}`}>{x.titel}</Link>
                        </td>
                        <td>{x.verpasstAm ? <span className="tag tag-critical">{dmy(x.frist)} verpasst</span> : dmy(x.frist)}</td>
                        <td>{x.betrag === null ? "–" : `${Number(x.betrag).toFixed(2).replace(".", ",")} €`}</td>
                        <td>
                          {x.claimStatus === "submitted" ? <span className="tag tag-ok">eingereicht{x.fallnummer ? ` · Fall ${x.fallnummer}` : ""}</span> : <span className={`tag ${x.status === "rueckfrage" ? "tag-warn" : ""}`}>{x.status === "erledigt" ? "geschlossen" : VT_STATUS[x.status]}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card card-pad" id="automatik" data-testid="va-automatik">
            <h2 style={{ marginTop: 0 }}>Automatik: Ansprüche und Fälle an die VA</h2>
            <div className="small" style={{ marginBottom: 8 }}>
              Modus: <b data-testid="va-automatik-modus">{a.modus === "automatisch" ? "automatisch" : a.modus === "vorschlag" ? "Vorschlag" : "aus"}</b>
              {a.modus === "vorschlag" && " – nichts geht von selbst an die VA; hier steht, was gegangen wäre."}
              {a.modus === "automatisch" && ` – seit ${a.seit ? zeit(new Date(a.seit)) : "–"}.`}
              <span className="muted">
                {" "}
                Heute (VA-Zeit): {zahl.threads} von {a.maxThreadsTag} neuen Threads · {zahl.vorschlag ?? 0} Vorschläge · {zahl.sammel ?? 0} im Sammel-Thread · {zahl.ludwig ?? 0} erst bei dir. Erinnerungen {a.erinnerungTage.join("/")} Tage vor der Frist um {a.uhrzeit} ({s.va.zeitzone}); „Daily overview“ {a.tagesuebersicht ? `${a.arbeitstage.map((d) => WT[d - 1]).join(", ")} ${a.uhrzeit}` : "aus"}.
              </span>
            </div>
            {entscheidungen.length === 0 ? (
              <p className="small muted">In den letzten 7 Tagen keine neuen Ansprüche oder Fälle.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Zeit</th>
                      <th>Was</th>
                      <th>Ergebnis</th>
                      <th>Grund</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {entscheidungen.map((e) => (
                      <tr key={e.id} data-testid="va-entscheidung">
                        <td style={{ whiteSpace: "nowrap" }}>{zeit(e.am)}</td>
                        <td>
                          <span className="muted">{e.typ === "anspruch" ? "Anspruch" : "Fall"}:</span> <Link href={e.typ === "anspruch" ? `/ansprueche/${e.bezugId}` : `/amazon-faelle/${e.bezugId}`}>{e.titel}</Link>
                          {e.betrag !== null && <span className="muted"> · {Number(e.betrag).toFixed(2).replace(".", ",")} €</span>}
                          {e.frist && <span className="muted"> · Frist {dmy(e.frist)}</span>}
                        </td>
                        <td>
                          <span className={`tag ${STATUS_TAG[e.status] ?? ""}`}>{VA_STATUS_LABEL[e.status] ?? e.status}</span>
                          {e.fehler && <div className="muted">{e.fehler}</div>}
                        </td>
                        <td className="muted">{e.grund}</td>
                        <td>
                          {(e.status === "vorschlag" || e.status === "ludwig" || e.status === "fehler") && st.eingerichtet && (
                            <form action={automatikAnVaAction}>
                              <input type="hidden" name="id" value={e.id} />
                              <button className="btn btn-small" type="submit" data-testid="va-entscheidung-an-va">
                                An die VA
                              </button>
                            </form>
                          )}
                        </td>
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
                          <span className="tag" data-testid="va-sprache-tag" title="Sprache der Nachricht (übersetzt → Deutsch)">{spracheTag(n)}</span>
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
          <div className="card card-pad" data-testid="va-automatik-einstellungen">
            <h2 style={{ marginTop: 0 }}>Automatik – Regeln</h2>
            <form action={automatikEinstellungenAction} className="stack" style={{ gap: 8 }}>
              <label className="small">
                Modus
                <select name="modus" defaultValue={a.modus} data-testid="va-automatik-modus-wahl">
                  <option value="vorschlag">Vorschlag (nur anzeigen, was an die VA ginge)</option>
                  <option value="automatisch">automatisch</option>
                  <option value="aus">aus</option>
                </select>
              </label>
              <div className="small muted">Erst auf „automatisch“, wenn die Fall-Zentrale zuverlässig einstuft (B17.2). Ältere Ansprüche gehen nach dem Umschalten nicht von selbst an die VA.</div>
              {VA_KATEGORIEN.map((k) => (
                <label key={k} className="small">
                  {VA_KATEGORIE_LABEL[k]}
                  <select name={`regel_${k}`} defaultValue={a.regeln[k] ?? "ludwig"}>
                    {(["va", "ludwig", "nie"] as const).map((z) => (
                      <option key={z} value={z}>
                        {VA_ZIEL_LABEL[z]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label>
                  Betrag über (€) erst an dich
                  <input name="schwelle" type="number" min={0} step="1" defaultValue={a.schwelle} style={{ width: 90 }} />
                </label>
                <label>
                  Höchstens neue Threads am Tag
                  <input name="maxThreadsTag" type="number" min={1} max={500} defaultValue={a.maxThreadsTag} style={{ width: 70 }} />
                </label>
              </div>
              <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label>
                  Uhrzeit (VA-Zeit)
                  <input name="uhrzeit" defaultValue={a.uhrzeit} size={5} />
                </label>
                <label>
                  Erinnern … Tage vor der Frist
                  <input name="erinnerungTage" defaultValue={a.erinnerungTage.join(", ")} size={8} />
                </label>
              </div>
              <div className="small">
                Arbeitstage der VA:{" "}
                {WT.map((w, i) => (
                  <label key={w} style={{ marginRight: 6 }}>
                    <input type="checkbox" name="arbeitstag" value={i + 1} defaultChecked={a.arbeitstage.includes(i + 1)} /> {w}
                  </label>
                ))}
              </div>
              <label className="small">
                Feiertage der VA (je Zeile, TT.MM.JJJJ)
                <textarea name="feiertage" rows={2} defaultValue={a.feiertage.map((d) => d.split("-").reverse().join(".")).join("\n")} />
              </label>
              <label className="small">
                <input type="checkbox" name="tagesuebersicht" defaultChecked={a.tagesuebersicht} /> „Daily overview“ an Arbeitstagen (Englisch)
              </label>
              <button className="btn" type="submit" data-testid="va-automatik-speichern">
                Speichern
              </button>
            </form>
          </div>
          <div className="card card-pad" data-testid="va-einstellungen">
            <h2 style={{ marginTop: 0 }}>Einstellungen</h2>
            <form action={einstellungenAction} className="stack" style={{ gap: 8 }}>
              <label className="small">
                Zeitzone der VA
                <input name="zeitzone" defaultValue={s.va.zeitzone} placeholder="Asia/Manila" />
              </label>
              {s.va.zeitzone !== "Asia/Manila" && <div className="small muted">Die VA sitzt laut Auftrag in Manila: „Asia/Manila“.</div>}
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
