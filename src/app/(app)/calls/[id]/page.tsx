import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { ausschnitt, ERKENNTNIS_TEXT, istEigeneAufgabe, PUNKT_TEXT, type PunktArt } from "@/lib/calls/logic";
import { callDetail, wissenZumCall } from "@/lib/calls/service";
import { callBearbeitenAction, neuAuswertenAction, punktAnlegenAction, punktStatusAction, uebernehmenAction, wissenNeuAction } from "../actions";

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);
const ARTEN: PunktArt[] = ["aufgabe", "vereinbarung", "entscheidung", "frage"];
const STATUS = { vorschlag: { text: "Vorschlag", tag: "tag-warn" }, uebernommen: { text: "übernommen", tag: "tag-ok" }, verworfen: { text: "verworfen", tag: "" }, geklaert: { text: "geklärt", tag: "tag-ok" } } as const;

export default async function CallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string; stelle?: string }> }) {
  const session = await requireArea("amazon");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const d = await callDetail(session.tenantId, id);
  if (!d) notFound();
  const { call: c, punkte } = d;
  const wissen = await wissenZumCall(session.tenantId, c.id);
  const vorschlaege = punkte.filter((p) => p.status === "vorschlag");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/calls">Calls</Link> · {dmy(c.datum)}{c.art === "gruppe" ? " · Deal-Gruppe" : ""}</div>
          <h1>{c.titel}</h1>
        </div>
        <form action={neuAuswertenAction}>
          <input type="hidden" name="id" value={c.id} />
          <button className="btn" type="submit" title="Unbearbeitete Vorschläge werden ersetzt; Übernommenes bleibt.">KI neu auswerten</button>
        </form>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}
      {c.auswertung === "offen" && <div className="notice small" style={{ marginBottom: 12 }}>Wartet auf die KI-Auswertung (läuft im Hintergrund) – Seite später neu laden oder „KI neu auswerten“.</div>}
      {c.auswertung === "fehler" && <div className="notice notice-warn small" style={{ marginBottom: 12 }}>Auswertung fehlgeschlagen: {c.auswertungFehler}</div>}
      {c.auswertung === "ohne_ki" && <div className="notice notice-warn small" style={{ marginBottom: 12 }}>Ohne KI-Anbindung – Punkte unten von Hand ergänzen (<Link href="/anbindungen#anthropic">Anbindungen → Claude</Link>).</div>}

      {sp.stelle && /^\d+$/.test(sp.stelle) && Number(sp.stelle) < c.transkript.length && (
        <section id="stelle" className="card card-pad" style={{ marginBottom: 12, borderLeft: "4px solid var(--accent)" }} data-testid="call-stelle">
          <div className="small muted">Stelle im Transkript</div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{ausschnitt(c.transkript, Number(sp.stelle), 900)}</div>
        </section>
      )}
      {(c.zusammenfassung || c.quelleUrl) && (
        <section className="card card-pad" style={{ marginBottom: 12 }} data-testid="call-zusammenfassung">
          {c.zusammenfassung?.teilnehmer?.length ? <div className="small muted">Teilnehmer: {c.zusammenfassung.teilnehmer.join(", ")}</div> : null}
          {c.zusammenfassung?.ueberblick && <p style={{ margin: "6px 0 0", maxWidth: 820 }}>{c.zusammenfassung.ueberblick}</p>}
          {c.zusammenfassung?.themen?.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 10 }}>
              {c.zusammenfassung.themen.map((t) => (
                <div key={t.name} className="small">
                  <strong>{t.name}</strong>
                  {t.punkte.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{t.punkte.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                </div>
              ))}
            </div>
          ) : null}
          {c.quelleUrl && <div className="small" style={{ marginTop: 8 }}><a href={c.quelleUrl} target="_blank" rel="noreferrer noopener">Google-Dokument öffnen</a></div>}
        </section>
      )}

      <form action={uebernehmenAction}>
        <input type="hidden" name="call" value={c.id} />
        {ARTEN.map((art) => {
          const liste = punkte.filter((p) => p.art === art);
          if (!liste.length) return null;
          return (
            <section key={art} className="card card-pad" style={{ marginBottom: 12 }} data-testid={`call-${art}`}>
              <h2 style={{ marginTop: 0 }}>{art === "frage" ? "Offene Fragen" : `${PUNKT_TEXT[art]}en`}</h2>
              <div className="stack" style={{ gap: 8 }}>
                {liste.map((p) => (
                  <div key={p.id} id={`p-${p.id}`} className="small" data-testid="call-punkt" data-status={p.status} style={{ borderLeft: "3px solid var(--line, #ddd)", paddingLeft: 10, opacity: p.status === "verworfen" ? 0.55 : 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      {p.status === "vorschlag" && <input type="checkbox" name="punkt" value={p.id} defaultChecked={art !== "frage"} aria-label="übernehmen" />}
                      <strong>{p.text}</strong>
                      <span className={`tag ${STATUS[p.status].tag}`}>{STATUS[p.status].text}</span>
                      {p.verantwortlich && <span className="muted">→ {p.verantwortlich}</span>}
                      {p.frist && <span className="muted">bis {dmy(p.frist)}</span>}
                      {art === "aufgabe" && !istEigeneAufgabe(p) && <span className="tag">{c.art === "gruppe" ? "andere Person" : "beim Consultant"}</span>}
                    </div>
                    {p.position !== null && <div className="muted" style={{ marginTop: 3 }}>Call-Stelle: „{ausschnitt(c.transkript, p.position, 220)}“</div>}
                    {p.taskId && <div style={{ marginTop: 3 }}>Aufgabe: {p.aufgabeTitel} – {p.aufgabeStatus === "done" ? "erledigt ✓" : "offen"}</div>}
                    <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                      {p.status === "vorschlag" && (
                        <button className="btn-link small" formAction={punktStatusAction} name="verwerfen" value={p.id} type="submit">
                          verwerfen
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        <input type="hidden" name="status" value="verworfen" />
        {vorschlaege.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <button className="btn btn-primary" type="submit" data-testid="call-uebernehmen">Ausgewählte übernehmen</button>
            <span className="small muted" style={{ marginLeft: 10 }}>Eigene Aufgaben werden Aufgaben (Amazon/SAS) mit Link hierher; Fragen und Punkte beim Consultant landen bei „Offene Punkte“.</span>
          </div>
        )}
      </form>

      {punkte.filter((p) => p.art === "frage" && p.status === "uebernommen").length > 0 && (
        <div className="small" style={{ marginBottom: 14 }}>
          {punkte
            .filter((p) => p.art === "frage" && p.status === "uebernommen")
            .map((p) => (
              <form key={p.id} action={punktStatusAction} style={{ display: "inline-block", marginRight: 10 }}>
                <input type="hidden" name="call" value={c.id} />
                <input type="hidden" name="punkt" value={p.id} />
                <input type="hidden" name="status" value="geklaert" />
                <button className="btn-link small" type="submit">„{p.text.slice(0, 40)}“ als geklärt markieren</button>
              </form>
            ))}
        </div>
      )}

      <section className="card card-pad" style={{ marginBottom: 14 }} data-testid="call-wissen">
        <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Wissen aus diesem Call</h2>
          <form action={wissenNeuAction}>
            <input type="hidden" name="id" value={c.id} />
            <button className="btn btn-small" type="submit" title="Ungeprüfte, unbearbeitete Einträge dieses Calls werden ersetzt; Geprüftes und Bearbeitetes bleibt.">Wissen neu ziehen</button>
          </form>
        </div>
        {c.wissenFehler && <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>Letzter Versuch fehlgeschlagen: {c.wissenFehler}</div>}
        {!c.wissenAm ? (
          <div className="small muted" style={{ marginTop: 6 }}>Steht noch aus – die KI zieht Tipps und Insider-Wissen im Hintergrund ins Wissen.</div>
        ) : wissen.length === 0 ? (
          <div className="small muted" style={{ marginTop: 6 }}>Kein neues Wissen gefunden.</div>
        ) : (
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {wissen.map((w) => (
              <li key={w.id}>
                <Link href={`/wissen/${w.id}`}>{w.title}</Link>{" "}
                <span className="muted">
                  · {w.erkenntnis ? ERKENNTNIS_TEXT[w.erkenntnis] : w.category}
                  {w.quelleWer ? ` · ${w.quelleWer}` : ""}
                  {w.verifiedAt ? " · ✓ geprüft" : ""}
                </span>
                {w.callStelle !== null && (
                  <>
                    {" "}
                    <Link className="small" href={`/calls/${c.id}?stelle=${w.callStelle}#stelle`}>Stelle</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card card-pad" style={{ marginBottom: 14 }} data-testid="call-bearbeiten">
        <summary><strong>Titel und Datum ändern</strong></summary>
        <form action={callBearbeitenAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
          <input type="hidden" name="id" value={c.id} />
          <label className="small" style={{ flex: 1, minWidth: 220 }}>Titel<input name="titel" defaultValue={c.titel} required /></label>
          <label className="small">Datum<input name="datum" defaultValue={dmy(c.datum) ?? ""} placeholder="TT.MM.JJJJ" style={{ width: 110 }} required /></label>
          <label className="small">
            Art
            <select name="art" defaultValue={c.art}>
              <option value="consultant">Consultant-Call</option>
              <option value="gruppe">Wochen-Call Deal-Gruppe</option>
            </select>
          </label>
          <button className="btn" type="submit">Speichern</button>
        </form>
      </details>

      <details className="card card-pad" style={{ marginBottom: 14 }}>
        <summary><strong>Punkt von Hand ergänzen</strong></summary>
        <form action={punktAnlegenAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
          <input type="hidden" name="call" value={c.id} />
          <label className="small">Art<select name="art">{ARTEN.map((a) => <option key={a} value={a}>{PUNKT_TEXT[a]}</option>)}</select></label>
          <label className="small" style={{ flex: 1, minWidth: 220 }}>Text<input name="text" required /></label>
          <label className="small">Wer<input name="wer" placeholder="ich / consultant" style={{ width: 110 }} /></label>
          <label className="small">Frist<input name="frist" placeholder="TT.MM.JJJJ" style={{ width: 110 }} /></label>
          <button className="btn" type="submit">Hinzufügen</button>
        </form>
      </details>

      <details className="card card-pad">
        <summary><strong>Transkript</strong> <span className="small muted">({c.transkript.length.toLocaleString("de-DE")} Zeichen)</span></summary>
        <div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 8, maxHeight: 600, overflow: "auto" }}>{c.transkript}</div>
      </details>
    </>
  );
}
