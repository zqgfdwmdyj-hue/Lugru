import { myPartner, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { memberLabels, partnerHolders } from "@/lib/private/logic";
import { assignPartnerAction, deleteAllAction, saveExternSyncAction, savePinAction, saveSettingsAction, saveStartHintAction } from "../actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead } from "../ui";

export default async function PrivatEinstellungenPage() {
  const session = await requirePrivate();
  const s = await privateSettings(session.tenantId);
  const members = await privateMembers(session.tenantId);
  const labels = memberLabels(members);
  const taken = partnerHolders(s.userPartner, members, session.userId);
  const me = myPartner(s, session);
  return (
    <>
      <PrivatHead active="einstellungen" title="Einstellungen" pin={session.privatePin} />

      <section className="card card-pad stack" data-testid="start-hint">
        <h2>Auf der geschäftlichen Startseite</h2>
        <StateForm action={saveStartHintAction} submit="Speichern" testid="start-hint-form" keep>
          <Choice
            name="startHint"
            value={s.startHint[session.userId] ?? "link"}
            options={[
              { value: "aus", label: "nichts anzeigen" },
              { value: "link", label: "nur Link „Privat“" },
              ...(session.privateScope === "voll" ? [{ value: "hinweise", label: "Hinweise (Tagebuch, Termine, Rezept)" }] : []),
            ]}
          />
          <div className="small muted">Gilt nur für dich. Standard ist „nur Link“ – dann sieht auf der Startseite niemand Inhalte aus Privat, auch nicht, wer dir über die Schulter schaut.</div>
        </StateForm>
      </section>

      {session.privateScope === "voll" && (
      <section className="card card-pad stack">
        <h2>Namen</h2>
        <StateForm action={saveSettingsAction} submit="Speichern" testid="priv-settings" keep>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="pa">Partner 1</label><input className="input" id="pa" name="partnerA" defaultValue={s.partners.a} required /></div>
            <div className="field"><label className="label" htmlFor="pb">Partner 2</label><input className="input" id="pb" name="partnerB" defaultValue={s.partners.b} required /></div>
          </div>
          <div className="field"><span className="label">Das bin ich (Konto „{session.name ?? session.email}“)</span><Choice name="me" value={me ?? undefined} options={(["a", "b"] as const).map((k) => ({ value: k, label: taken[k] ? `${s.partners[k]} (vergeben an „${taken[k]}“)` : s.partners[k], disabled: Boolean(taken[k]) }))} />{(taken.a || taken.b) && <span className="small muted" data-testid="me-taken">Eine Person gehört genau zu einem Konto – Konten mit ähnlichem Namen werden nicht zusammengeführt.</span>}{!me && <span className="small" style={{ color: "var(--warn)" }} data-testid="me-unset">Noch nicht festgelegt – bitte auswählen.</span>}</div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="wake">Übliche Aufstehzeit (fürs Ausschlafen)</label><input className="input" id="wake" name="wakeTime" type="time" defaultValue={s.wakeTime} /></div>
            <div className="field"><label className="label" htmlFor="remind">„Zeit für ein Date?“ nach … Tagen (0 = aus)</label><input className="input" id="remind" name="dateReminderDays" type="number" min={0} max={365} defaultValue={s.dateReminderDays} /></div>
          </div>
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
      )}

      {session.privateScope === "voll" && (
        <section className="card card-pad stack" data-testid="extern-sync">
          <h2>Kalender-Export {s.externSync.enabled ? <span className="tag tag-warn">an</span> : <span className="tag">aus</span>}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Private Einträge gehen nie automatisch in einen Kalender – weder in den geschäftlichen noch in einen geteilten. Ist der Export an, landen <strong>nur einzeln angehakte</strong> Termine, Kinderzeiten, Auszeiten, Ausschlafen und Paarzeiten in einem <strong>eigenen</strong> Kalender – ganztägig, nur mit dem Titel „Privater Termin“, ohne Uhrzeit, Namen oder Inhalt. Periode, Nähe, Streicheln und Massage nie.
          </p>
          <StateForm action={saveExternSyncAction} submit="Speichern" testid="extern-sync-form" keep>
            <label className="check small"><input type="checkbox" name="enabled" defaultChecked={s.externSync.enabled} /> Export einzeln angehakter Einträge einschalten</label>
            <div className="field" style={{ maxWidth: 320 }}><label className="label small" htmlFor="ext-cal">Eigener Kalender (wird bei Bedarf angelegt)</label><input className="input" id="ext-cal" name="calendar" defaultValue={s.externSync.calendar} maxLength={60} /></div>
            <div className="small muted">Nicht erlaubt: der Kalender „Seller-System“ und Kalender, die für Mitarbeiter freigegeben sind.</div>
          </StateForm>
        </section>
      )}

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

      <section className="card card-pad stack" id="daten">
        <h2>Daten sichern oder löschen</h2>
        <div className="small">
          <a className="btn btn-small" href="/privat/export" data-testid="export">Alles herunterladen (Datei)</a>
          <span className="muted" style={{ marginLeft: 8 }}>enthält alles, was du hier sehen darfst – unverschlüsselt, also sicher aufbewahren.</span>
        </div>
        <details>
          <summary className="small" style={{ cursor: "pointer", color: "var(--danger)" }}>Einträge löschen …</summary>
          <div style={{ marginTop: 8 }}>
            <StateForm action={deleteAllAction} submit="Endgültig löschen" testid="delete-all">
              <div className="small">Löscht <strong>alle deine eigenen Einträge</strong> in Privat. Was die anderen eingetragen haben, bleibt – das kann nur jede Person selbst löschen.</div>
              <div className="field"><label className="label" htmlFor="confirm">Zum Bestätigen LÖSCHEN eintippen</label><input className="input" id="confirm" name="confirm" autoComplete="off" required /></div>
              <div className="small muted">Kann nicht rückgängig gemacht werden. Vorher am besten oben herunterladen.</div>
            </StateForm>
          </div>
        </details>
      </section>

      <section className="card card-pad stack" data-testid="members">
        <h2>Wer hat Zugang – und wer ist wer</h2>
        <ul className="pk-list">
          {members.map((m) => {
            const cur = s.userPartner[m.userId];
            const editable = session.privateScope === "voll" && (session.role === "owner" || m.userId === session.userId);
            return (
              <li key={m.userId} data-testid="private-member">
                <div className="between" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span>
                    <strong>{labels.get(m.userId)}</strong>{m.userId === session.userId ? " (du)" : ""}
                    <span className="small muted"> · {cur ? `ist ${s.partners[cur]}` : "keiner Person zugeordnet"}{m.scope === "familie" ? " · nur Familie" : ""}</span>
                  </span>
                  {editable && (
                    <StateForm action={assignPartnerAction} submit="Zuordnen" testid={`assign-${m.login}`} keep className="assign-form">
                      <input type="hidden" name="userId" value={m.userId} />
                      <select className="select" name="partner" defaultValue={cur ?? ""} aria-label={`Person für ${labels.get(m.userId)}`} style={{ width: "auto" }}>
                        <option value="">nicht zugeordnet</option>
                        <option value="a">{s.partners.a}</option>
                        <option value="b">{s.partners.b}</option>
                      </select>
                    </StateForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="small muted">
          Freigeben oder entziehen kann der Inhaber unter Einstellungen → Benutzer („Privat“: voll oder nur Familie). Der Zugang ist nie in „alle Bereiche“ enthalten – auch nicht für Inhaber –, und Nur-ansehen-Konten bekommen ihn nie.
          Alle Einträge liegen verschlüsselt in der Datenbank (auch in Sicherungen), werden mit nichts abgeglichen (keine Aufgabenliste, keine KI, kein Kalender – außer einzeln angehakten Einträgen bei eingeschaltetem Export, dann nur neutral) und nirgends sonst angezeigt.
        </div>
      </section>
    </>
  );
}
