import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { memberLabels, type ObservationEntry } from "@/lib/private/logic";
import { loadEntries, privateMembers, requirePrivate } from "@/lib/private/service";
import { beobachtungTeile } from "@/lib/private/rueckblick-logic";
import { addObservationAction, deleteEntryAction, updateObservationAction } from "../actions";
import { BeobachtungFelder } from "../beobachtung-felder";
import { StateForm } from "../state-form";
import { PrivatHead, dmy } from "../ui";

// B19.7/B16: eigener Bereich „Beobachtungen“ – anlegen, bearbeiten, löschen (Situation | Problematik | gewünschte
// Veränderung), wie im Therapie-Bogen. Nur mit vollem Privat-Zugang; eigene Beobachtungen ändert nur der Verfasser.

export default async function BeobachtungenPage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const members = await privateMembers(session.tenantId);
  const labels = memberLabels(members);
  const nameOf = (id: string) => labels.get(id) ?? "?";
  const alle = (await loadEntries<ObservationEntry>(session, ["beobachtung"])).sort((a, b) => b.data.day.localeCompare(a.data.day));
  const meine = alle.filter((o) => o.userId === session.userId);
  const ueberMich = alle.filter((o) => o.data.aboutUserId === session.userId && o.userId !== session.userId);
  const andere = members.filter((m) => m.userId !== session.userId);
  return (
    <>
      <PrivatHead active="beobachtungen" title="Beobachtungen" pin={session.privatePin} sub={<Link className="btn" href="/privat/therapie-bogen" data-testid="link-therapie-bogen">Therapie-Bogen (Drucken/PDF)</Link>} />

      <section className="card card-pad stack" data-testid="beob-neu">
        <h2>Neue Beobachtung</h2>
        {andere.length ? (
          <StateForm action={addObservationAction} submit="Beobachtung speichern" testid="observation-form">
            <div className="priv-grid">
              <div className="field">
                <label className="label" htmlFor="o-about">Über</label>
                <select className="select" id="o-about" name="about">
                  {andere.map((m) => <option key={m.userId} value={m.userId}>{nameOf(m.userId)}</option>)}
                </select>
              </div>
              <div className="field"><label className="label" htmlFor="o-day">Tag</label><input className="input" id="o-day" name="day" type="date" defaultValue={today} max={today} /></div>
            </div>
            <BeobachtungFelder />
          </StateForm>
        ) : (
          <div className="small muted">Beobachtungen gibt es über andere Personen mit Privat-Zugang – noch niemand eingetragen.</div>
        )}
      </section>

      <section className="card card-pad stack" data-testid="beob-meine">
        <h2>Meine Beobachtungen ({meine.length})</h2>
        {meine.length === 0 && <div className="small muted">Noch keine.</div>}
        {meine.length > 0 && (
          <table className="table small">
            <thead><tr><th>Datum</th><th>Über</th><th>Situation</th><th>Problematik</th><th>Gewünschte Veränderung</th><th></th></tr></thead>
            <tbody>
              {meine.map((o) => {
                const t = beobachtungTeile(o.data);
                return (
                  <tr key={o.id} data-testid="beob-zeile">
                    <td style={{ whiteSpace: "nowrap" }}>{dmy(o.data.day)}</td>
                    <td>{nameOf(o.data.aboutUserId)}</td>
                    <td>{t.situation}{t.unvollstaendig && <> <span className="tag tag-warn">[?] unvollständig</span></>}</td>
                    <td>{t.problematik ?? "–"}</td>
                    <td>{t.veraenderung ?? "–"}</td>
                    <td style={{ minWidth: 140 }}>
                      <details>
                        <summary className="btn-link small" style={{ cursor: "pointer" }} data-testid="observation-edit">bearbeiten</summary>
                        <StateForm action={updateObservationAction} submit="Änderung speichern" testid="observation-edit-form">
                          <input type="hidden" name="id" value={o.id} />
                          <div className="field"><label className="label" htmlFor={`oe-day-${o.id}`}>Tag</label><input className="input" id={`oe-day-${o.id}`} name="day" type="date" defaultValue={o.data.day} max={today} /></div>
                          <BeobachtungFelder id={o.id} werte={t} />
                        </StateForm>
                      </details>
                      <form action={deleteEntryAction}><input type="hidden" name="kind" value="beobachtung" /><input type="hidden" name="id" value={o.id} /><button className="btn-link small danger" type="submit" data-testid="observation-delete">löschen</button></form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {ueberMich.length > 0 && (
        <section className="card card-pad stack" data-testid="beob-ueber-mich">
          <h2>Über mich ({ueberMich.length})</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {ueberMich.map((o) => <li key={o.id} className="small"><strong>{dmy(o.data.day)}</strong> {nameOf(o.userId)}: {o.data.text}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
