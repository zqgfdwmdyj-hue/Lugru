import { todayIso } from "@/lib/dates";
import { ANLAGE_TEXT, EINKOMMEN_TEXT, type Anlage, type Einkommen, type Erinnerung, type Fixkosten, type Ruecklage, type Steuerfrage } from "@/lib/private/geld";
import { privatFinanzen } from "@/lib/private/geld-service";
import { requirePrivate } from "@/lib/private/service";
import { PrivatHead, dmy } from "../ui";
import { anlagenCsvAction, geldAendernAction, geldEintragAction, geldLoeschenAction, privatKontoAction, standardErinnerungenAction } from "./actions";

// Privates Geld (nur für dich – andere mit Privat-Zugang sehen diese Seite leer). Keine Steuerberatung.

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const monatText = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

function Loeschen({ id }: { id: string }) {
  return (
    <form action={geldLoeschenAction} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <button className="btn-link small" type="submit" aria-label="löschen" style={{ color: "var(--danger)" }}>×</button>
    </form>
  );
}

export default async function PrivatGeldPage({ searchParams }: { searchParams: Promise<{ monat?: string; meldung?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const g = await privatFinanzen(session, heute, sp.monat);
  const k = g.konto;

  return (
    <>
      <PrivatHead active="geld" title="Privates Geld" />
      <p className="small muted" style={{ marginTop: 0 }}>Nur für dich sichtbar. Zahlen und Erinnerungen – <strong>keine Steuerberatung</strong>; offene Fragen unten für den Steuerberater sammeln.</p>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}

      {g.faellig.length > 0 && (
        <div className="notice notice-info small" style={{ marginBottom: 12 }} data-testid="geld-erinnerungen-faellig">
          {g.faellig.map((e) => (
            <form key={(e as Erinnerung & { id: string }).id} action={geldAendernAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="hidden" name="id" value={(e as Erinnerung & { id: string }).id} />
              <span>⏰ {e.titel} – {dmy(e.faellig)}</span>
              <button className="btn-link small" type="submit">erledigt</button>
            </form>
          ))}
        </div>
      )}

      <div className="grid-kpi" style={{ marginBottom: 14 }} data-testid="geld-summen">
        <div className="card card-pad">
          <div className="kpi-label">Einkommen {g.monat.slice(0, 4)} (GmbH)</div>
          <div className="kpi-value">{eur0(g.summen.einkommenJahr.erhalten)}</div>
          <div className="small muted">erhalten · geplant {eur0(g.summen.einkommenJahr.geplant)}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Fixkosten je Monat</div>
          <div className="kpi-value">{eur0(g.summen.fixkostenMonat)}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Anlagen + Rücklagen</div>
          <div className="kpi-value" data-testid="geld-vermoegen">{eur0(g.summen.vermoegen)}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Privatkonto</div>
          <div className="kpi-value">{k.stand ? eur0(k.stand.saldo) : "–"}</div>
          <div className="small muted">{k.stand ? `Stand ${dmy(k.stand.stand)}` : "noch kein Kontoauszug"}</div>
        </div>
      </div>

      <section className="card card-pad" style={{ marginBottom: 12 }} data-testid="geld-konto">
        <h2 style={{ marginTop: 0 }}>Privatkonto – {monatText(k.monat.monat)}</h2>
        {k.letzterImport ? (
          <>
            <div className="small">Einnahmen <strong>{eur(k.monat.einnahmen)}</strong> · Ausgaben <strong>{eur(k.monat.ausgaben)}</strong> · Saldo <strong style={{ color: k.monat.saldo < 0 ? "var(--danger)" : undefined }}>{eur(k.monat.saldo)}</strong> · {k.monat.buchungen} Buchungen</div>
            {k.monat.groessteAusgaben.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>Größte Ausgaben: {k.monat.groessteAusgaben.map((x) => `${x.name} ${eur0(x.betrag)}`).join(" · ")}</div>}
            <div className="small" style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {k.verlauf.map((v) => (
                <a key={v.monat} href={`/privat/geld?monat=${v.monat}`} className={`chip${v.monat === k.monat.monat ? " active" : ""}`}>{v.monat.slice(5)}/{v.monat.slice(2, 4)}: {v.saldo >= 0 ? "+" : ""}{eur0(v.saldo)}</a>
              ))}
            </div>
            {k.wiederkehrend.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="small">Wiederkehrende Abbuchungen ({k.wiederkehrend.length}) – Vorschläge für die Fixkosten</summary>
                <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {k.wiederkehrend.map((w) => <li key={w.gruppeHash}>{w.name}: {eur(w.betrag)} ({w.rhythmus}) · nächste {dmy(w.naechste)}</li>)}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="small muted">Noch kein Kontoauszug vom Privatkonto.</p>
        )}
        <form action={privatKontoAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 10 }}>
          <label className="small">Kontoauszug (CSV, CAMT oder PDF)<input type="file" name="datei" accept=".csv,.xml,.txt,.pdf" required data-testid="geld-kontoauszug" /></label>
          <label className="small">Kontostand laut Bank (optional)<input name="saldo" inputMode="decimal" style={{ width: 120 }} /></label>
          <button className="btn" type="submit">Einlesen</button>
        </form>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <section className="card card-pad" data-testid="geld-einkommen">
          <h2 style={{ marginTop: 0 }}>Gehalt / Ausschüttung</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {g.einkommen.sort((a, b) => (b.data as Einkommen).monat.localeCompare((a.data as Einkommen).monat)).slice(0, 18).map((e) => {
              const d = e.data as Einkommen;
              return (
                <li key={e.id}>
                  {d.monat} · {EINKOMMEN_TEXT[d.art]} {eur(d.betrag)} ·{" "}
                  <form action={geldAendernAction} style={{ display: "inline" }}><input type="hidden" name="id" value={e.id} /><button className="btn-link small" type="submit">{d.status === "erhalten" ? "erhalten ✓" : "geplant"}</button></form> <Loeschen id={e.id} />
                </li>
              );
            })}
          </ul>
          <form action={geldEintragAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <input type="hidden" name="typ" value="einkommen" />
            <select className="select" name="art" aria-label="Art"><option value="gehalt">Gehalt</option><option value="ausschuettung">Ausschüttung</option><option value="sonstiges">Sonstiges</option></select>
            <input className="input" name="monat" defaultValue={heute.slice(0, 7)} aria-label="Monat (JJJJ-MM)" style={{ width: 100 }} />
            <input className="input" name="betrag" placeholder="Betrag netto" inputMode="decimal" style={{ width: 110 }} />
            <select className="select" name="status" aria-label="Status"><option value="geplant">geplant</option><option value="erhalten">erhalten</option></select>
            <button className="btn btn-small" type="submit">+</button>
          </form>
        </section>

        <section className="card card-pad" data-testid="geld-fixkosten">
          <h2 style={{ marginTop: 0 }}>Private Fixkosten</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {g.fixkosten.map((e) => {
              const d = e.data as Fixkosten;
              return <li key={e.id}>{d.name}: {eur(d.betrag)} {d.rhythmus === "monatlich" ? "/ Monat" : d.rhythmus === "quartal" ? "/ Quartal" : "/ Jahr"} <Loeschen id={e.id} /></li>;
            })}
          </ul>
          <form action={geldEintragAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <input type="hidden" name="typ" value="fixkosten" />
            <input className="input" name="name" placeholder="z. B. Miete, Versicherung" style={{ flex: 1, minWidth: 140 }} />
            <input className="input" name="betrag" placeholder="Betrag" inputMode="decimal" style={{ width: 90 }} />
            <select className="select" name="rhythmus" aria-label="Rhythmus"><option value="monatlich">monatlich</option><option value="quartal">Quartal</option><option value="jaehrlich">jährlich</option></select>
            <button className="btn btn-small" type="submit">+</button>
          </form>
        </section>

        <section className="card card-pad" data-testid="geld-ruecklagen">
          <h2 style={{ marginTop: 0 }}>Rücklagen-Ziele</h2>
          {g.ruecklagen.map((e) => {
            const d = e.data as Ruecklage;
            const st = g.summen.ruecklagen.find((r) => r.id === e.id)!;
            return (
              <div key={e.id} className="small" style={{ marginBottom: 6 }}>
                <strong>{d.name}</strong>: {eur0(d.stand)} von {eur0(d.ziel)} ({st.prozent} %){st.monateBisZiel ? ` · noch ${st.monateBisZiel} Monate` : st.fehlt === 0 ? " · erreicht ✓" : ""} <Loeschen id={e.id} />
                <div style={{ height: 6, background: "var(--line, #eee)", borderRadius: 3, marginTop: 3 }}><div style={{ width: `${st.prozent}%`, height: 6, background: "var(--accent)", borderRadius: 3 }} /></div>
                <form action={geldAendernAction} style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <input type="hidden" name="id" value={e.id} />
                  <input className="input" name="stand" defaultValue={String(d.stand).replace(".", ",")} inputMode="decimal" aria-label="neuer Stand" style={{ width: 100, height: 28 }} />
                  <button className="btn btn-small" type="submit">Stand</button>
                </form>
              </div>
            );
          })}
          <form action={geldEintragAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <input type="hidden" name="typ" value="ruecklage" />
            <input className="input" name="name" placeholder="z. B. Notgroschen, Steuern" style={{ flex: 1, minWidth: 140 }} />
            <input className="input" name="ziel" placeholder="Ziel" inputMode="decimal" style={{ width: 80 }} />
            <input className="input" name="stand" placeholder="Stand" inputMode="decimal" style={{ width: 80 }} />
            <input className="input" name="monatlich" placeholder="je Monat" inputMode="decimal" style={{ width: 80 }} />
            <button className="btn btn-small" type="submit">+</button>
          </form>
        </section>

        <section className="card card-pad" data-testid="geld-anlagen">
          <h2 style={{ marginTop: 0 }}>Anlagen</h2>
          {g.anlagen.map((e) => {
            const d = e.data as Anlage;
            return (
              <form key={e.id} action={geldAendernAction} className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <input type="hidden" name="id" value={e.id} />
                <span><strong>{d.name}</strong> ({ANLAGE_TEXT[d.art]}{d.sparrate ? `, Sparrate ${eur0(d.sparrate)}` : ""}) · Stand {dmy(d.standAm)}</span>
                <input className="input" name="wert" defaultValue={String(d.wert).replace(".", ",")} inputMode="decimal" aria-label="Wert" style={{ width: 110, height: 28 }} />
                <button className="btn btn-small" type="submit">Wert</button>
                <Loeschen id={e.id} />
              </form>
            );
          })}
          <form action={geldEintragAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <input type="hidden" name="typ" value="anlage" />
            <input className="input" name="name" placeholder="z. B. ETF Welt" style={{ flex: 1, minWidth: 120 }} />
            <select className="select" name="art" aria-label="Art">{Object.entries(ANLAGE_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="input" name="wert" placeholder="Wert" inputMode="decimal" style={{ width: 90 }} />
            <input className="input" name="sparrate" placeholder="Sparrate" inputMode="decimal" style={{ width: 80 }} />
            <button className="btn btn-small" type="submit">+</button>
          </form>
          <form action={anlagenCsvAction} className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
            <span className="muted">oder CSV (Name; Art; Wert):</span>
            <input type="file" name="datei" accept=".csv,.txt,.xlsx" />
            <button className="btn btn-small" type="submit">Einlesen</button>
          </form>
        </section>

        <section className="card card-pad" data-testid="geld-erinnerungen">
          <h2 style={{ marginTop: 0 }}>Erinnerungen</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {g.erinnerungen.filter((e) => !(e.data as Erinnerung).erledigtAm).sort((a, b) => (a.data as Erinnerung).faellig.localeCompare((b.data as Erinnerung).faellig)).map((e) => {
              const d = e.data as Erinnerung;
              return <li key={e.id}>{dmy(d.faellig)} · {d.titel}{d.wiederholung !== "einmal" ? ` (${d.wiederholung === "jaehrlich" ? "jährlich" : "monatlich"})` : ""} <Loeschen id={e.id} /></li>;
            })}
          </ul>
          <form action={standardErinnerungenAction} style={{ marginTop: 6 }}><button className="btn-link small" type="submit">Vorschläge anlegen (Sparpläne, Freistellungsauftrag, Steuerunterlagen)</button></form>
          <form action={geldEintragAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <input type="hidden" name="typ" value="erinnerung" />
            <input className="input" name="titel" placeholder="z. B. Steuervorauszahlung privat" style={{ flex: 1, minWidth: 140 }} />
            <input className="input" type="date" name="faellig" aria-label="fällig" />
            <select className="select" name="wiederholung" aria-label="Wiederholung"><option value="einmal">einmal</option><option value="monatlich">monatlich</option><option value="jaehrlich">jährlich</option></select>
            <button className="btn btn-small" type="submit">+</button>
          </form>
        </section>

        <section className="card card-pad" data-testid="geld-steuerberater">
          <h2 style={{ marginTop: 0 }}>Mit dem Steuerberater klären</h2>
          <p className="small muted" style={{ marginTop: 0 }}>z. B. Gehalt oder Ausschüttung, Höhe der Vorauszahlungen – das System rechnet nichts davon aus.</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {g.fragen.map((e) => {
              const d = e.data as Steuerfrage;
              return (
                <li key={e.id} style={d.erledigt ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                  {d.frage}{" "}
                  <form action={geldAendernAction} style={{ display: "inline" }}><input type="hidden" name="id" value={e.id} /><button className="btn-link small" type="submit">{d.erledigt ? "wieder offen" : "geklärt"}</button></form> <Loeschen id={e.id} />
                </li>
              );
            })}
          </ul>
          <form action={geldEintragAction} style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input type="hidden" name="typ" value="steuerberater" />
            <input className="input" name="frage" placeholder="Frage für den Steuerberater" style={{ flex: 1 }} data-testid="geld-frage" />
            <button className="btn btn-small" type="submit">+</button>
          </form>
        </section>
      </div>
    </>
  );
}
