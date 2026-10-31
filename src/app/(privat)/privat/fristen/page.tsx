import { todayIso } from "@/lib/dates";
import { FAHRZEUG_TEXT, FRIST_TYP_TEXT, VORSORGE_VORSCHLAEGE, type FristEintrag } from "@/lib/private/fristen";
import { fristenLaden } from "@/lib/private/fristen-service";
import { requirePrivate } from "@/lib/private/service";
import { PrivatHead, dmy } from "../ui";
import { fristAnlegenAction, fristDatumAction, fristErledigtAction, fristLoeschenAction, vorsorgeVorschlaegeAction } from "./actions";

// Vorsorge, Fristen & Verträge (Privatbereich): nächste Frist je Eintrag, rechtzeitige Vorschläge, Fixkosten.

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function beschreibung(e: FristEintrag): string {
  switch (e.typ) {
    case "vorsorge":
      return `${e.intervallMonate ? `alle ${e.intervallMonate} Monate` : "einmalig"}${e.zuletzt ? ` · zuletzt ${dmy(e.zuletzt)}` : ""}`;
    case "dokument":
      return `${e.person} · gültig bis ${dmy(e.ablauf)}`;
    case "fahrzeug":
      return `${FAHRZEUG_TEXT[e.was]}${e.bezeichnung ? ` (${e.bezeichnung})` : ""}`;
    case "garantie":
      return e.haendler ? `gekauft bei ${e.haendler}` : "";
    case "vertrag":
      return `${eur(e.kostenMonat)}/Monat${e.kuendigungsfristWochen ? ` · Kündigungsfrist ${e.kuendigungsfristWochen} Wochen` : ""}${e.verlaengerungMonate ? ` · verlängert sich um ${e.verlaengerungMonate} Monate` : ""}${e.ansprechpartner ? ` · ${e.ansprechpartner}` : ""}`;
  }
}

export default async function FristenPage({ searchParams }: { searchParams: Promise<{ meldung?: string; neu?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const f = await fristenLaden(session, heute);
  const neu = (["vorsorge", "dokument", "fahrzeug", "garantie", "vertrag"] as const).includes(sp.neu as never) ? (sp.neu as FristEintrag["typ"]) : "vorsorge";

  return (
    <>
      <PrivatHead active="fristen" title="Fristen & Verträge" />
      <p className="small muted" style={{ marginTop: 0 }}>Vorsorge, Ausweise, Auto, Garantien und Verträge – das System erinnert rechtzeitig. Geschäftliche Verträge mit Kennzeichen „Firma“ stehen getrennt.</p>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}

      {f.jetzt.length > 0 && (
        <div className="notice notice-info small" style={{ marginBottom: 12 }} data-testid="fristen-jetzt">
          <strong>Jetzt kümmern:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {f.jetzt.map((e) => <li key={e.id}>{e.frist!.vorschlag ?? `${e.frist!.titel}: ${e.frist!.text}`}</li>)}
          </ul>
        </div>
      )}

      <div className="grid-kpi" style={{ marginBottom: 14 }}>
        <div className="card card-pad">
          <div className="kpi-label">Fixkosten Verträge privat</div>
          <div className="kpi-value" data-testid="fristen-fixkosten">{eur(f.fixkosten.privat)}</div>
          <div className="small muted">je Monat</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Verträge Firma</div>
          <div className="kpi-value">{eur(f.fixkosten.firma)}</div>
          <div className="small muted">je Monat</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Einträge</div>
          <div className="kpi-value">{f.eintraege.length}</div>
          <div className="small muted">{f.jetzt.length} jetzt fällig</div>
        </div>
      </div>

      <div className="card table-wrap" style={{ marginBottom: 14 }}>
        <table className="table" data-testid="fristen-liste">
          <thead>
            <tr>
              <th>Nächste Frist</th>
              <th>Was</th>
              <th>Art</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {f.eintraege.length === 0 && (
              <tr>
                <td colSpan={4} className="muted small">Noch nichts eingetragen.</td>
              </tr>
            )}
            {f.eintraege.map((e) => (
              <tr key={e.id} style={e.frist?.ueberfaellig ? { background: "var(--danger-soft)" } : e.frist?.erinnern ? { background: "var(--warn-soft)" } : undefined}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {e.frist ? dmy(e.frist.datum) : "–"}
                  <div className="small muted">{e.frist?.text}</div>
                </td>
                <td>
                  <strong>{e.frist?.titel ?? (e.data.typ === "fahrzeug" ? e.data.fahrzeug : "was" in e.data ? e.data.was : "")}</strong>
                  {e.data.firma && <span className="tag tag-info" style={{ marginLeft: 6 }}>Firma</span>}
                  <div className="small muted">{beschreibung(e.data)}</div>
                </td>
                <td className="small">{FRIST_TYP_TEXT[e.data.typ]}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {(e.data.typ === "vorsorge" || e.data.typ === "vertrag") && (
                      <form action={fristDatumAction} style={{ display: "flex", gap: 4 }}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="date" name="datum" aria-label={e.data.typ === "vorsorge" ? "Termin gebucht am" : "gekündigt zum"} />
                        <button className="btn btn-small" type="submit">{e.data.typ === "vorsorge" ? "gebucht" : "gekündigt"}</button>
                      </form>
                    )}
                    <form action={fristErledigtAction} style={{ display: "flex", gap: 4 }}>
                      <input type="hidden" name="id" value={e.id} />
                      {e.data.typ !== "garantie" && !(e.data.typ === "fahrzeug" && e.data.was === "reifen") && <input type="date" name="neu" aria-label={e.data.typ === "vorsorge" ? "Termin war am" : "neues Datum"} title={e.data.typ === "vorsorge" ? "Termin war am (leer = heute)" : "neues Ablauf-/Fälligkeitsdatum"} />}
                      <button className="btn btn-small" type="submit">{e.data.typ === "vertrag" ? "behalten" : "erledigt"}</button>
                    </form>
                    <form action={fristLoeschenAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn-link small" type="submit" aria-label="löschen" style={{ color: "var(--danger)" }}>×</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }} id="neu">
        <h3 style={{ marginTop: 0 }}>Neu eintragen</h3>
        <nav className="priv-tabs" aria-label="Art">
          {(["vorsorge", "dokument", "fahrzeug", "garantie", "vertrag"] as const).map((t) => (
            <a key={t} href={`/privat/fristen?neu=${t}#neu`} className={`chip${t === neu ? " active" : ""}`}>{FRIST_TYP_TEXT[t]}</a>
          ))}
        </nav>
        <form action={fristAnlegenAction} className="small" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 10 }} data-testid="frist-form">
          <input type="hidden" name="typ" value={neu} />
          {neu === "vorsorge" && (
            <>
              <label>Was<input name="was" placeholder="Zahnarzt" required /></label>
              <label>Für wen<input name="person" list="personen" required /></label>
              <label>Alle … Monate<input name="intervall" inputMode="numeric" style={{ width: 70 }} placeholder="6" /></label>
              <label>Zuletzt<input type="date" name="zuletzt" /></label>
              <label>oder fällig am<input type="date" name="faellig" /></label>
            </>
          )}
          {neu === "dokument" && (
            <>
              <label>Dokument<input name="was" placeholder="Personalausweis" list="dokumente" required /></label>
              <label>Für wen<input name="person" list="personen" required /></label>
              <label>Gültig bis<input type="date" name="ablauf" required /></label>
            </>
          )}
          {neu === "fahrzeug" && (
            <>
              <label>Fahrzeug<input name="fahrzeug" placeholder="Model Y" required /></label>
              <label>
                Was
                <select name="was">
                  {(Object.keys(FAHRZEUG_TEXT) as (keyof typeof FAHRZEUG_TEXT)[]).map((k) => <option key={k} value={k}>{FAHRZEUG_TEXT[k]}</option>)}
                </select>
              </label>
              <label>Bezeichnung<input name="bezeichnung" placeholder="nur bei Sonstiges" /></label>
              <label>Fällig am<input type="date" name="faellig" title="Reifenwechsel ohne Datum: Oktober/April" /></label>
            </>
          )}
          {neu === "garantie" && (
            <>
              <label>Gerät<input name="was" placeholder="Waschmaschine" required /></label>
              <label>Garantie bis<input type="date" name="bis" required /></label>
              <label>Händler<input name="haendler" /></label>
            </>
          )}
          {neu === "vertrag" && (
            <>
              <label>Anbieter<input name="anbieter" required /></label>
              <label>Vertrag<input name="was" placeholder="Handy, Strom, Streaming …" required /></label>
              <label>€/Monat<input name="kosten" inputMode="decimal" style={{ width: 80 }} /></label>
              <label>Laufzeit bis<input type="date" name="laufzeit_bis" /></label>
              <label>Verlängert um Monate<input name="verlaengerung" inputMode="numeric" style={{ width: 70 }} placeholder="1" /></label>
              <label>Kündigungsfrist Wochen<input name="kuendigungsfrist" inputMode="numeric" style={{ width: 70 }} placeholder="4" /></label>
              <label>Erinnern Wochen vorher<input name="erinnerung" inputMode="numeric" style={{ width: 70 }} placeholder="4" /></label>
              <label>Ansprechpartner<input name="ansprechpartner" /></label>
            </>
          )}
          {neu !== "vertrag" && <label>Vorlauf Wochen<input name="vorlauf" inputMode="numeric" style={{ width: 70 }} placeholder="Std." /></label>}
          <label>Notiz<input name="notiz" /></label>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" name="firma" value="1" /> Firma</label>
          <button className="btn btn-primary" type="submit" data-testid="frist-speichern">Speichern</button>
          <datalist id="personen">{f.personen.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="dokumente">{["Personalausweis", "Reisepass", "Führerschein", "Kinderreisepass", "Krankenkassenkarte"].map((d) => <option key={d} value={d} />)}</datalist>
        </form>
      </div>

      <details className="card card-pad">
        <summary><strong>Vorsorge-Vorschläge für eine Person</strong></summary>
        <form action={vorsorgeVorschlaegeAction} className="small" style={{ marginTop: 8 }}>
          <label>Für wen<input name="person" list="personen" required /></label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0" }}>
            {VORSORGE_VORSCHLAEGE.map((v) => (
              <label key={v.was} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" name="was" value={v.was} defaultChecked={v.intervallMonate <= 12 && !v.was.startsWith("Tierarzt")} /> {v.was} ({v.intervallMonate} Mon.)
              </label>
            ))}
          </div>
          <button className="btn" type="submit">Anlegen</button>
        </form>
      </details>
    </>
  );
}
