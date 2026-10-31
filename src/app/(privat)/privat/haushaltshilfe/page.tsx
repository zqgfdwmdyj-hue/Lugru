import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { HELFER_ART_TEXT, satzText, type Einsatz } from "@/lib/private/haushaltshilfe";
import { haushaltshilfeMonat } from "@/lib/private/haushaltshilfe-service";
import { requirePrivate } from "@/lib/private/service";
import { MonthNav, PrivatHead, dm, monthLabel, monthParam, weekday } from "../ui";
import { einsatzHandAction, einsatzSpeichernAction, einsatzZuruecksetzenAction, helferSpeichernAction } from "./actions";

// Familienalltag → Babysitter & Putzhilfe: Einsätze aus dem Familienkalender (Titel enthält z. B. „Babysitter“ oder
// „Putzfrau“), Kosten nach Stundensatz (Babysitter: wach/schlafend ab Schlafenszeit), von Hand korrigierbar,
// Monatsauswertung mit Export. Nur mit vollem Privat-Zugang.

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const std = (min: number) => `${(Math.round((min / 60) * 100) / 100).toLocaleString("de-DE")} Std.`;
const zahl = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

function EinsatzForm({ e, monat }: { e: Einsatz; monat: string }) {
  return (
    <details>
      <summary className="small" style={{ cursor: "pointer" }}>korrigieren</summary>
      <form action={einsatzSpeichernAction} className="stack small" style={{ gap: 6, marginTop: 6 }} data-testid="hh-korrigieren">
        <input type="hidden" name="monat" value={monat} />
        <input type="hidden" name="recordId" value={e.recordId ?? ""} />
        <input type="hidden" name="ref" value={e.ref ?? ""} />
        <input type="hidden" name="quelle" value={e.quelle} />
        <input type="hidden" name="helferId" value={e.helferId} />
        <input type="hidden" name="day" value={e.day} />
        <input type="hidden" name="titel" value={e.titel ?? ""} />
        <input type="hidden" name="fromKalender" value={e.recordId ? "" : (e.from ?? "")} />
        <input type="hidden" name="toKalender" value={e.recordId ? "" : (e.to ?? "")} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label>von <input name="from" type="time" defaultValue={e.from ?? ""} /></label>
          <label>bis <input name="to" type="time" defaultValue={e.to ?? ""} /></label>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label>Std. wach <input name="stdWach" inputMode="decimal" size={5} placeholder={zahl(Math.round((e.minWach / 60) * 100) / 100)} /></label>
          {e.art === "babysitter" && <label>Std. schlafend <input name="stdSchlaf" inputMode="decimal" size={5} placeholder={zahl(Math.round((e.minSchlaf / 60) * 100) / 100)} /></label>}
          <label>Betrag € <input name="betrag" inputMode="decimal" size={7} placeholder={zahl(e.berechnet)} defaultValue={e.vonHand && e.betrag !== e.berechnet ? zahl(e.betrag) : ""} /></label>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select name="status" defaultValue={e.status} aria-label="Status">
            <option value="stattgefunden">stattgefunden</option>
            <option value="geplant">geplant</option>
            <option value="ausgefallen">ausgefallen</option>
          </select>
          <label><input type="checkbox" name="bezahlt" defaultChecked={e.bezahlt} /> bezahlt</label>
          <input name="notiz" placeholder="Notiz" defaultValue={e.notiz ?? ""} maxLength={300} style={{ flex: 1, minWidth: 120 }} />
        </div>
        <div className="muted">Leere Felder = Rechnung aus Uhrzeit und Stundensatz. Ein Betrag geht immer vor.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-small btn-primary" type="submit">Speichern</button>
        </div>
      </form>
      {e.recordId && (
        <form action={einsatzZuruecksetzenAction} style={{ marginTop: 4 }}>
          <input type="hidden" name="monat" value={monat} />
          <input type="hidden" name="recordId" value={e.recordId} />
          <button className="btn-link small" type="submit" data-testid="hh-zuruecksetzen">{e.quelle === "hand" ? "Einsatz löschen" : "Korrektur zurücknehmen"}</button>
        </form>
      )}
    </details>
  );
}

export default async function HaushaltshilfePage({ searchParams }: { searchParams: Promise<{ monat?: string; meldung?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const monat = monthParam(sp.monat);
  const d = await haushaltshilfeMonat(session, monat, heute);
  const a = d.auswertung;
  const max = Math.max(1, ...d.verlauf.map((v) => v.kosten));

  return (
    <>
      <PrivatHead active="haushaltshilfe" title="🧹 Babysitter & Putzhilfe" month={monat} sub={<MonthNav path="/privat/haushaltshilfe" month={monat} />} />
      <p className="small muted" style={{ marginTop: 0 }}>
        Einsätze kommen aus dem Familienkalender und den Privat-Terminen, wenn der Titel z. B. „Babysitter“ oder „Putzfrau“ enthält.
        Gerechnet wird nach Stundensatz – beim Babysitter bis zur Schlafenszeit als „wach“, danach als „schlafend“. Genaue Zeiten und
        Beträge kannst du je Einsatz korrigieren. Nur mit vollem Privat-Zugang sichtbar.
      </p>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="hh-meldung">{sp.meldung}</div>}

      <section className="card card-pad stack" data-testid="hh-auswertung">
        <div className="priv-grid">
          <div><div className="kpi-label">{monthLabel(monat)}</div><strong data-testid="hh-kosten">{eur(a.kosten)}</strong> · {a.anzahl}× · {a.stunden.toLocaleString("de-DE")} Std.</div>
          {a.helfer.map((h) => (
            <div key={h.helferId} data-testid="hh-helfer-summe"><div className="kpi-label">{h.name}</div><strong>{eur(h.kosten)}</strong> · {h.anzahl}× · {h.stunden.toLocaleString("de-DE")} Std.{h.art === "babysitter" && h.stundenSchlaf > 0 ? ` (davon ${h.stundenSchlaf.toLocaleString("de-DE")} schlafend)` : ""}{h.offen > 0 ? <div className="small muted">noch nicht bezahlt: {eur(h.offen)}</div> : null}</div>
          ))}
          {a.geplant.anzahl > 0 && <div><div className="kpi-label">geplant</div>{a.geplant.anzahl}× · ca. {eur(a.geplant.kosten)}</div>}
        </div>
        {(a.ohneBetrag > 0 || a.ausgefallen > 0) && <div className="small muted">{a.ohneBetrag > 0 ? `${a.ohneBetrag} Einsatz/Einsätze ohne Betrag (Uhrzeit oder Stundenlohn fehlt) – nicht in der Summe. ` : ""}{a.ausgefallen > 0 ? `${a.ausgefallen} ausgefallen (zählt nicht).` : ""}</div>}
        {d.paarzeitKosten > 0 && <div className="small muted" data-testid="hh-paarzeit-hinweis">In „Paarzeit“ sind für {monthLabel(monat)} zusätzlich {eur(d.paarzeitKosten)} Babysitter-Kosten von Hand eingetragen – bitte nicht doppelt zählen.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-small" href={`/privat/haushaltshilfe/export?monat=${monat}`} data-testid="hh-export">Auswertung {monthLabel(monat)} als CSV</a>
        </div>
        <div className="small" data-testid="hh-verlauf" style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 4, alignItems: "end" }} aria-label="Kosten der letzten 12 Monate">
          {d.verlauf.map((v) => (
            <Link key={v.monat} href={`/privat/haushaltshilfe?monat=${v.monat}`} title={`${monthLabel(v.monat)}: ${eur(v.kosten)} (${v.anzahl}×)`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textDecoration: "none" }}>
              <span style={{ display: "block", width: "100%", height: Math.max(2, Math.round((v.kosten / max) * 48)), background: v.monat === monat ? "var(--accent)" : "var(--border)", borderRadius: 3 }} />
              <span className="muted" style={{ fontSize: 10 }}>{monthLabel(v.monat).slice(0, 3)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card table-wrap" data-testid="hh-einsaetze">
        <div className="card-head"><h2>Einsätze {monthLabel(monat)}</h2></div>
        {d.einsaetze.length === 0 ? (
          <div className="card-pad small muted">Keine Einsätze gefunden. Steht die Babysitterin oder Putzfrau im Familienkalender, prüfe unten die Begriffe – oder trage den Einsatz von Hand ein.</div>
        ) : (
          <table className="table small">
            <thead>
              <tr><th>Tag</th><th>Hilfe</th><th>Zeit</th><th className="right">Stunden</th><th className="right">Betrag</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {d.einsaetze.map((e) => (
                <tr key={e.key} data-testid="hh-einsatz" style={e.status === "ausgefallen" ? { opacity: 0.55 } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{weekday(e.day).slice(0, 2)} {dm(e.day)}</td>
                  <td>{e.helferName}<div className="muted">{e.quelleText}{e.titel && e.titel !== e.helferName ? ` · ${e.titel}` : ""}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{e.from ? `${e.from}–${e.to ?? "?"}` : "–"}</td>
                  <td className="right num">{e.art === "babysitter" && e.minSchlaf > 0 ? <>{std(e.minWach)} wach<br />{std(e.minSchlaf)} schlafend</> : std(e.minWach + e.minSchlaf)}</td>
                  <td className="right num" data-testid="hh-betrag">{eur(e.betrag)}{e.vonHand && <div className="muted">von Hand</div>}{e.bezahlt && <div className="muted">bezahlt</div>}</td>
                  <td>{e.status}{e.hinweis && <div style={{ color: "var(--warn)" }}>{e.hinweis}</div>}{e.notiz && <div className="muted">{e.notiz}</div>}</td>
                  <td style={{ minWidth: 110 }}><EinsatzForm e={e} monat={monat} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details className="card-pad">
          <summary className="small" style={{ cursor: "pointer" }} data-testid="hh-hand-oeffnen">+ Einsatz von Hand eintragen</summary>
          <form action={einsatzHandAction} className="stack small" style={{ gap: 6, marginTop: 6 }} data-testid="hh-hand">
            <input type="hidden" name="monat" value={monat} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select name="helferId" aria-label="Hilfe" required>
                {d.helfer.filter((h) => h.aktiv !== false).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              <input name="day" type="date" required defaultValue={heute.startsWith(monat) ? heute : `${monat}-01`} aria-label="Tag" />
              <label>von <input name="from" type="time" /></label>
              <label>bis <input name="to" type="time" /></label>
              <label>oder Betrag € <input name="betrag" inputMode="decimal" size={7} /></label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select name="status" defaultValue="stattgefunden" aria-label="Status"><option value="stattgefunden">stattgefunden</option><option value="geplant">geplant</option></select>
              <label><input type="checkbox" name="bezahlt" /> bezahlt</label>
              <input name="notiz" placeholder="Notiz" maxLength={300} style={{ flex: 1, minWidth: 120 }} />
              <button className="btn btn-small btn-primary" type="submit">Eintragen</button>
            </div>
          </form>
        </details>
      </section>

      <section className="card card-pad" data-testid="hh-einstellungen">
        <h2 style={{ marginTop: 0 }}>Stundensätze und Erkennung</h2>
        <form action={helferSpeichernAction} className="stack small" style={{ gap: 10 }}>
          <input type="hidden" name="monat" value={monat} />
          {d.helfer.map((h) => (
            <fieldset key={h.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }} data-testid="hh-helfer">
              <legend><strong>{h.name}</strong> <span className="muted">· {HELFER_ART_TEXT[h.art]} · {satzText(h)}</span></legend>
              <input type="hidden" name="id" value={h.id} />
              <input type="hidden" name="art" value={h.art} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <label>Name <input name="name" defaultValue={h.name} maxLength={60} /></label>
                <label style={{ flex: 1, minWidth: 180 }}>Begriffe im Kalender (Komma) <input name="begriffe" defaultValue={h.begriffe.join(", ")} style={{ width: "100%" }} /></label>
                <label><input type="checkbox" name="aktiv" value={h.id} defaultChecked={h.aktiv !== false} /> aktiv</label>
              </div>
              {h.art === "babysitter" ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <label>€/Std. wach <input name="satzWach" inputMode="decimal" size={5} defaultValue={zahl(h.satzWach)} /></label>
                  <label>€/Std. schlafend <input name="satzSchlaf" inputMode="decimal" size={5} defaultValue={zahl(h.satzSchlaf)} /></label>
                  <label>Schlafenszeit <input name="schlafAb" type="time" defaultValue={h.schlafAb ?? "20:00"} /></label>
                  <label>Aufwachen <input name="wachAb" type="time" defaultValue={h.wachAb ?? "06:00"} /></label>
                  <input type="hidden" name="satz" value={zahl(h.satz)} />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <label>€/Std. <input name="satz" inputMode="decimal" size={5} defaultValue={zahl(h.satz)} placeholder="z. B. 15" /></label>
                  <input type="hidden" name="satzWach" value="" />
                  <input type="hidden" name="satzSchlaf" value="" />
                  <input type="hidden" name="schlafAb" value={h.schlafAb ?? "20:00"} />
                  <input type="hidden" name="wachAb" value={h.wachAb ?? "06:00"} />
                </div>
              )}
            </fieldset>
          ))}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">Neue Hilfe:</span>
            <input name="neuName" placeholder="Name, z. B. Oma" maxLength={60} />
            <select name="neuArt" aria-label="Art" defaultValue="sonstiges"><option value="babysitter">Babysitter</option><option value="putzhilfe">Putzhilfe</option><option value="sonstiges">Sonstige Hilfe</option></select>
            <input name="neuSatz" inputMode="decimal" size={5} placeholder="€/Std." />
            <input name="neuBegriffe" placeholder="weitere Begriffe" />
          </div>
          <div><button className="btn btn-small btn-primary" type="submit" data-testid="hh-saetze-speichern">Stundensätze speichern</button></div>
        </form>
      </section>
    </>
  );
}
