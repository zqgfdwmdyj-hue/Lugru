import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import type { Deal } from "@/lib/b2b/service";
import type { bestellStand } from "@/lib/b2b/ablauf";
import { anPrepAction, bestellungEntwurfAction, bestellungFreigebenAction, bestellungSendenAction, erledigtAction, rechnungenAction, reklamationAction, verfallenAction, wareneingangAction, zahlungenAction } from "../actions";

type Stand = Awaited<ReturnType<typeof bestellStand>>;

const Id = ({ id }: { id: string }) => <input type="hidden" name="id" value={id} />;

/** Schritte nach dem Reservieren: Rechnungen → Zahlungen → Bestellung (Entwurf, Freigabe, Senden) → Wareneingang → Prep. */
export function Ablauf({ d, st, inhaber, lexoffice }: { d: Deal; st: Stand; inhaber: boolean; lexoffice: boolean }) {
  const b = st.bestellung;
  const ohneRechnung = st.aktiv.filter((x) => x.r.status === "reserviert" && !x.r.rechnungId).length;
  const offen = st.aktiv.filter((x) => x.r.status === "vorkasse_offen").length;
  const vorBestellung = ["aktiv", "geschlossen"].includes(d.status);
  const fehlt = Math.max(0, d.moqLieferant - st.bestellMenge);
  return (
    <section className="card card-pad stack" style={{ gap: 12 }} data-testid="ablauf">
      <h2>Ablauf</h2>
      {vorBestellung && (
        <div className="small" data-testid="bestell-stand">
          Reserviert {st.reserviert} · bestellbar {st.bestellMenge}{st.nurBezahlte ? " (nur bezahlte)" : ""} · MOQ {d.moqLieferant}
          {st.faellig.faellig ? <span className="tag tag-ok" style={{ marginLeft: 6 }}>{st.faellig.grund === "moq" ? "MOQ erreicht" : "Frist vorbei"}</span> : null}
        </div>
      )}

      {vorBestellung && st.aktiv.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">1. Vorkasse-Rechnungen (Lexoffice)</b>
          {!lexoffice && <div className="small muted">Lexoffice ist nicht verbunden – unter Anbindungen den API-Schlüssel eintragen.</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {ohneRechnung > 0 && lexoffice && (
              <form action={rechnungenAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Id id={d.id} />
                <label className="check small"><input type="checkbox" name="mailen" /> Geprüft – Rechnungen jetzt per Mail an die Kunden senden</label>
                <SubmitButton className="btn" label={`${ohneRechnung} Rechnung(en) erstellen`} pendingLabel="Erstelle …" testId="rechnungen-erstellen" />
              </form>
            )}
            {offen > 0 && lexoffice && (
              <form action={zahlungenAction}><Id id={d.id} /><SubmitButton className="btn" label={`Zahlungen prüfen (${offen} offen)`} pendingLabel="Prüfe …" testId="zahlungen-pruefen" /></form>
            )}
          </div>
        </div>
      )}

      {vorBestellung && (!b || b.status === "entwurf") && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">2. Sammelbestellung beim Großhändler</b>
          {fehlt > 0 && (
            <div className="small muted">
              Es fehlen {fehlt} Stück bis zur Mindestmenge. Bei Fristende: Restmenge selbst übernehmen oder Deal verfallen lassen (Rechnungen werden per Gutschrift aufgehoben).
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <form action={bestellungEntwurfAction} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <Id id={d.id} />
              {fehlt > 0 && (
                <div className="field"><label className="label" htmlFor="eigeneMenge">Restmenge selbst übernehmen</label><input className="input" id="eigeneMenge" name="eigeneMenge" inputMode="numeric" defaultValue={fehlt} style={{ width: 90 }} data-testid="eigene-menge" /></div>
              )}
              <SubmitButton className="btn" label={b ? "Entwurf neu erstellen" : "Bestell-Entwurf erstellen"} pendingLabel="Erstelle …" testId="bestellung-entwurf" />
            </form>
            {st.aktiv.length > 0 && fehlt > 0 && (
              <form action={verfallenAction}><Id id={d.id} /><ConfirmButton className="btn" confirm="Deal verfallen lassen? Reservierungen werden storniert, Rechnungen per Gutschrift aufgehoben." testid="verfallen">Verfallen lassen</ConfirmButton></form>
            )}
          </div>
        </div>
      )}

      {b && b.status === "entwurf" && (
        <form action={bestellungFreigebenAction} className="stack" style={{ gap: 8 }} data-testid="bestellung-freigabe">
          <Id id={d.id} />
          <div className="small">Entwurf: <b>{b.menge} Stück</b>{b.eigeneMenge ? ` (davon ${b.eigeneMenge} für uns)` : ""}</div>
          <div className="field"><label className="label" htmlFor="an">An (Bestell-E-Mail des Lieferanten)</label><input className="input" id="an" name="an" type="email" defaultValue={b.mailAn ?? ""} style={{ maxWidth: 360 }} /></div>
          <div className="field"><label className="label" htmlFor="betreff">Betreff</label><input className="input" id="betreff" name="betreff" defaultValue={b.mailBetreff ?? ""} style={{ maxWidth: 560 }} /></div>
          <div className="field"><label className="label" htmlFor="text">Text</label><textarea className="input" id="text" name="text" rows={12} defaultValue={b.mailText ?? ""} style={{ maxWidth: 560, fontFamily: "var(--mono)" }} /></div>
          {inhaber ? <div><SubmitButton label="Bestellung freigeben" pendingLabel="Gebe frei …" testId="bestellung-freigeben" /></div> : <div className="small muted">Freigabe nur durch den Inhaber.</div>}
        </form>
      )}

      {b && b.status === "freigegeben" && (
        <form action={bestellungSendenAction} className="stack" style={{ gap: 8 }}>
          <Id id={d.id} />
          <div className="small">Freigegeben: {b.menge} Stück an <b>{b.mailAn}</b>.{st.nichtBestellbar.length ? ` ${st.nichtBestellbar.length} nicht bezahlte Reservierung(en) werden beim Senden storniert.` : ""}</div>
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{b.mailText}</pre>
          <label className="check small"><input type="checkbox" name="geprueft" data-testid="bestellung-geprueft" /> Geprüft – jetzt senden</label>
          <div><SubmitButton label="Bestellung senden" pendingLabel="Sende …" testId="bestellung-senden" /></div>
        </form>
      )}

      {b && b.status === "bestellt" && (
        <form action={wareneingangAction} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <Id id={d.id} />
          <div className="small" style={{ flexBasis: "100%" }}>Bestellt {b.menge} Stück am {b.bestelltAm?.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}. 3. Wareneingang im Prep Center:</div>
          <div className="field"><label className="label" htmlFor="eingang">Geliefert (Stück)</label><input className="input" id="eingang" name="eingang" inputMode="numeric" defaultValue={b.menge} style={{ width: 100 }} data-testid="eingang" /></div>
          <SubmitButton className="btn" label="Wareneingang buchen" pendingLabel="Buche …" testId="eingang-buchen" />
        </form>
      )}

      {b && b.status === "angekommen" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="small" data-testid="eingang-stand">Geliefert {b.eingangMenge} von {b.menge} Stück{b.eigeneMenge ? ` · für uns ${b.eigeneMenge}` : ""}.</div>
          {b.reklamation && !b.reklamation.startsWith("GESENDET") && (
            <form action={reklamationAction} className="stack" style={{ gap: 6 }} data-testid="reklamation">
              <Id id={d.id} />
              <b className="small">Reklamation an den Großhändler ({b.mailAn})</b>
              <textarea className="input" name="text" rows={8} defaultValue={b.reklamation} style={{ maxWidth: 560 }} />
              <label className="check small"><input type="checkbox" name="geprueft" /> Geprüft – jetzt senden</label>
              <div><SubmitButton className="btn" label="Reklamation senden" pendingLabel="Sende …" testId="reklamation-senden" /></div>
            </form>
          )}
          {b.reklamation?.startsWith("GESENDET") && <div className="small muted">Reklamation gesendet am {b.reklamation.slice(9, 19)}.</div>}
          <div className="small"><b>4. Übergabe an das Prep Center</b> – Export je Kunde unten bei den Reservierungen oder alle:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["csv", "xlsx", "pdf"] as const).map((f) => <a key={f} className="btn btn-small" href={`/b2b/${d.id}/export?format=${f}`} data-testid={`export-${f}`}>Alle als {f.toUpperCase()}</a>)}
            {d.status === "angekommen" && <form action={anPrepAction}><Id id={d.id} /><ConfirmButton className="btn btn-small" confirm="Alle als an das Prep Center übergeben markieren?" testid="an-prep">Alle als übergeben markieren</ConfirmButton></form>}
          </div>
        </div>
      )}
      {d.status === "verteilt" && (
        <form action={erledigtAction}><Id id={d.id} /><button className="btn" type="submit" data-testid="erledigt">Deal erledigt</button></form>
      )}
    </section>
  );
}
