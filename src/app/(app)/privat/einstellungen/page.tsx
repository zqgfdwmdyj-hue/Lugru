import { myPartner, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { savePinAction, saveSettingsAction } from "../actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead } from "../ui";

export default async function PrivatEinstellungenPage() {
  const session = await requirePrivate();
  const s = await privateSettings(session.tenantId);
  const members = await privateMembers(session.tenantId);
  const me = myPartner(s, session);
  return (
    <>
      <PrivatHead active="einstellungen" title="Einstellungen" pin={session.privatePin} />

      <section className="card card-pad stack">
        <h2>Namen</h2>
        <StateForm action={saveSettingsAction} submit="Speichern" testid="priv-settings" keep>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="pa">Partner 1</label><input className="input" id="pa" name="partnerA" defaultValue={s.partners.a} required /></div>
            <div className="field"><label className="label" htmlFor="pb">Partner 2</label><input className="input" id="pb" name="partnerB" defaultValue={s.partners.b} required /></div>
          </div>
          <div className="field"><span className="label">Das bin ich</span><Choice name="me" value={me} options={[{ value: "a", label: s.partners.a }, { value: "b", label: s.partners.b }]} /></div>
          <div className="field"><label className="label" htmlFor="kids">Kinder (Vornamen, mit Komma – optional)</label><input className="input" id="kids" name="kids" defaultValue={s.kids.join(", ")} placeholder="z. B. Mia, Paul" /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="ads">ADHS-Behandlung bei</label><input className="input" id="ads" name="ads" defaultValue={s.therapists.ads} /></div>
            <div className="field"><label className="label" htmlFor="paar">Paartherapie bei</label><input className="input" id="paar" name="paar" defaultValue={s.therapists.paar} /></div>
          </div>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <input type="checkbox" name="shareDiary" defaultChecked={s.diaryShared.includes(session.userId)} style={{ marginTop: 3 }} />
            <span>Mein ADHS-Tagebuch dürfen die anderen mit Privat-Zugang lesen (nur lesen). Ohne Haken sieht es nur, wer es schreibt.</span>
          </label>
        </StateForm>
      </section>

      <section className="card card-pad stack">
        <h2>PIN-Sperre {session.privatePin ? <span className="tag tag-ok">an</span> : <span className="tag">aus</span>}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Zusätzlich zur Anmeldung: „Privat“ fragt nach deiner PIN und sperrt sich nach 30 Minuten ohne Benutzung wieder – praktisch, wenn das Handy mal in anderen Händen ist. Die PIN gilt nur für dich.
        </p>
        <StateForm action={savePinAction} submit={session.privatePin ? "PIN ändern / entfernen" : "PIN setzen"} testid="priv-pin">
          <div className="priv-grid">
            {session.privatePin && <div className="field"><label className="label" htmlFor="cur">Bisherige PIN</label><input className="input" id="cur" name="current" type="password" inputMode="numeric" autoComplete="off" /></div>}
            <div className="field"><label className="label" htmlFor="pin">Neue PIN (4–8 Ziffern{session.privatePin ? ", leer = entfernen" : ""})</label><input className="input" id="pin" name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,8}" required={!session.privatePin} /></div>
            <div className="field"><label className="label" htmlFor="pin2">PIN wiederholen</label><input className="input" id="pin2" name="pin2" type="password" inputMode="numeric" autoComplete="new-password" /></div>
          </div>
        </StateForm>
      </section>

      <section className="card card-pad stack">
        <h2>Wer hat Zugang</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {members.map((m) => <li key={m.userId}>{m.name ?? m.login}{m.userId === session.userId ? " (du)" : ""}</li>)}
        </ul>
        <div className="small muted">
          Freigeben oder entziehen kann der Inhaber unter Einstellungen → Benutzer („Privat freigeben“). Der Zugang ist nie in „alle Bereiche“ enthalten – auch nicht für Inhaber.
          Alle Einträge liegen verschlüsselt in der Datenbank (auch in Sicherungen), werden mit nichts abgeglichen (kein Kalender, keine Aufgabenliste, keine KI) und nirgends sonst angezeigt.
        </div>
      </section>
    </>
  );
}
