import Link from "next/link";
import type { AbholOrt } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { ConfirmButton } from "@/components/confirm-button";
import { abholOrtLoeschen, abholOrtSpeichern, abholVorschlagSpeichern } from "./actions";

// Einstellungen → Abholung (Bauauftrag Abholung DHL/UPS): Abholorte je Absender einmal hinterlegen – keine Eingabe
// dieser Daten je Abholung. Nur der Inhaber; Zugangsdaten stehen unter Anbindungen (nie im Chat).

function Feld({ label, name, wert, breite = 180, hilfe, pflicht }: { label: string; name: string; wert?: string; breite?: number; hilfe?: string; pflicht?: boolean }) {
  return (
    <div className="field">
      <label className="label">
        {label}
        {pflicht ? " *" : ""}
        <input className="input" name={name} defaultValue={wert ?? ""} style={{ width: breite, display: "block" }} required={pflicht} />
      </label>
      {hilfe && <span className="small muted">{hilfe}</span>}
    </div>
  );
}

function OrtFormular({ o, testid }: { o?: AbholOrt; testid: string }) {
  return (
    <form action={abholOrtSpeichern} className="stack" style={{ gap: 10 }} data-testid={testid}>
      {o && <input type="hidden" name="key" value={o.key} />}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Feld label="Firma / Name" name="name" wert={o?.name} breite={220} pflicht />
        <Feld label="Zusatz" name="name2" wert={o?.name2} breite={180} />
        <Feld label="Straße" name="strasse" wert={o?.strasse} breite={200} pflicht />
        <Feld label="Nr." name="hausnr" wert={o?.hausnr} breite={70} pflicht />
        <Feld label="PLZ" name="plz" wert={o?.plz} breite={80} pflicht />
        <Feld label="Ort" name="ort" wert={o?.ort} breite={160} pflicht />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Feld label="Ansprechpartner" name="kontakt" wert={o?.kontakt} breite={180} pflicht />
        <Feld label="Telefon" name="telefon" wert={o?.telefon} breite={160} pflicht />
        <Feld label="E-Mail (Bestätigung)" name="email" wert={o?.email} breite={220} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Feld label="DHL-Kundennummer (EKP)" name="dhlKundennummer" wert={o?.dhlKundennummer} breite={140} hilfe="10 Ziffern, je Absender" />
        <Feld label="DHL-Abrechnungsnr. (optional)" name="dhlAbrechnungsnummer" wert={o?.dhlAbrechnungsnummer} breite={170} hilfe="14 Zeichen – nur für Einzelabholung" />
        <Feld label="UPS-Konto (optional)" name="upsKonto" wert={o?.upsKonto} breite={100} hilfe="sonst aus Anbindungen → UPS" />
        <Feld label="Fenster von" name="von" wert={o?.von} breite={80} hilfe="HH:MM" />
        <Feld label="bis" name="bis" wert={o?.bis} breite={80} />
      </div>
      <Feld label="Hinweis für den Fahrer" name="hinweis" wert={o?.hinweis} breite={420} hilfe="höchstens 100 Zeichen (DHL)" />
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" name="standard" defaultChecked={o?.standard} /> Standardort für neue Abholungen
      </label>
      <div><button type="submit" className="btn btn-primary">{o ? "Speichern" : "Abholort anlegen"}</button></div>
    </form>
  );
}

export default async function AbholEinstellungenPage({ searchParams }: { searchParams: Promise<{ meldung?: string; fehler?: string }> }) {
  const s = await requireOwner();
  const sp = await searchParams;
  const a = (await getSettings(s.tenantId)).abholung;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/einstellungen">Einstellungen</Link></div>
          <h1>Abholung DHL/UPS</h1>
          <div className="small muted">Abholorte einmal hinterlegen – beim Buchen (Seite <Link href="/versand/abholung">Versand → Abholung</Link> oder per Claude) kommen nur noch Datum, Zeitfenster und Paketzahl dazu. Zugangsdaten unter <Link href="/anbindungen">Anbindungen</Link>.</div>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="abholort-meldung">{sp.meldung}</div>}
      {sp.fehler && <div className="notice notice-error small" role="alert" style={{ marginBottom: 12 }} data-testid="abholort-fehler">{sp.fehler}</div>}
      <div className="stack" style={{ gap: 16 }}>
        {a.orte.map((o) => (
          <section key={o.key} className="card card-pad stack" style={{ gap: 10 }} data-testid="abholort">
            <h2 style={{ margin: 0 }}>{o.name}{o.standard ? <span className="tag tag-info" style={{ marginLeft: 8 }}>Standard</span> : null}</h2>
            <OrtFormular o={o} testid="abholort-form" />
            <form action={abholOrtLoeschen}>
              <input type="hidden" name="key" value={o.key} />
              <ConfirmButton confirm={`Abholort „${o.name}“ entfernen? Gebuchte Abholungen bleiben im Protokoll.`}>Entfernen</ConfirmButton>
            </form>
          </section>
        ))}
        <section className="card card-pad stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>Neuer Abholort</h2>
          <OrtFormular testid="abholort-neu" />
        </section>
        <form action={abholVorschlagSpeichern} className="card card-pad stack" style={{ gap: 10 }} data-testid="abholung-vorschlag-regel">
          <h2 style={{ margin: 0 }}>Vorschlag „Abholung buchen?“</h2>
          <span className="small muted">Abends (17–22 Uhr): Liegen mehr als n fertige Labels vor und ist für den nächsten Abholtag nichts gebucht, kommt eine Aufgabe mit Ein-Klick-Knopf und ein Push. Es wird nie automatisch gebucht.</span>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="vorschlagAn" defaultChecked={a.vorschlagAn} /> Vorschlag an</label>
          <div className="field"><label className="label">Mehr als … Labels<input className="input" name="vorschlagAb" type="number" min={0} max={500} defaultValue={a.vorschlagAb} style={{ width: 90, display: "block" }} /></label></div>
          <div><button type="submit" className="btn">Speichern</button></div>
        </form>
      </div>
    </>
  );
}
