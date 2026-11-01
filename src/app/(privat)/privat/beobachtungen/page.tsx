import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { claudeKonten } from "@/lib/assistant/oauth-service";
import { memberLabels, type ObservationEntry, type ReflexionEntry } from "@/lib/private/logic";
import { loadEntries, privateMembers, requirePrivate } from "@/lib/private/service";
import { beobachtungTeile, fuerNaechsteSitzung, nachTag } from "@/lib/private/rueckblick-logic";
import { paarSitzungen } from "@/lib/private/sitzungen";
import { addObservationAction, addReflexionAction, deleteEntryAction, updateObservationAction, updateReflexionAction } from "../actions";
import { BeobachtungFelder } from "../beobachtung-felder";
import { StateForm } from "../state-form";
import { PrivatHead, dmy } from "../ui";

// B19.7/B16/B22.1: eigener Bereich „Beobachtungen“ – anlegen, bearbeiten, löschen (Situation | Problematik | gewünschte
// Veränderung), wie im Therapie-Bogen. „Meine“ = Verfasser bin ich (egal über wen – meist über die Partnerin), nach
// Tag sortiert. Dazu „Reflexion“: freie Zettel für die nächste Paar-Sitzung (nur für mich sichtbar). Nur mit vollem
// Privat-Zugang; eigene Einträge ändert nur der Verfasser.

export default async function BeobachtungenPage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const members = await privateMembers(session.tenantId);
  const labels = memberLabels(members);
  const nameOf = (id: string) => labels.get(id) ?? "?";
  const [alleRoh, zettelRoh, sitzungen, claude] = await Promise.all([
    loadEntries<ObservationEntry>(session, ["beobachtung"]),
    loadEntries<ReflexionEntry>(session, ["reflexion"]),
    paarSitzungen(session, today),
    claudeKonten(session.tenantId, session.userId),
  ]);
  const alle = nachTag(alleRoh);
  const meine = alle.filter((o) => o.userId === session.userId);
  const ueberMich = alle.filter((o) => o.data.aboutUserId === session.userId && o.userId !== session.userId);
  const andere = members.filter((m) => m.userId !== session.userId);
  const zettel = nachTag(zettelRoh.filter((z) => z.userId === session.userId));
  const offen = new Set(fuerNaechsteSitzung(zettel, { bis: today, letzte: sitzungen.letzte }).map((z) => z.id));
  return (
    <>
      <PrivatHead active="beobachtungen" title="Beobachtungen & Reflexion" pin={session.privatePin} sub={<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Link className="btn" href="/privat/therapie-bogen" data-testid="link-therapie-bogen">Therapie-Bogen (Drucken/PDF)</Link><Link className="btn" href="/privat/rueckblick/woche">Wochenrückblick</Link><a className="btn" href="#reflexion">Reflexion</a></div>} />

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
        <div className="small muted" data-testid="beob-claude-hinweis">
          Alle Beobachtungen, die du verfasst hast – auch über Claude diktierte, egal über wen –, nach Tag sortiert.{" "}
          {claude.eigene > 0 ? "Claude ist mit deinem Konto verbunden: was du dort diktierst, steht hier." : claude.andere.length ? <strong className="danger">Claude ist mit dem Konto „{claude.andere.join("“, „")}“ verbunden, nicht mit deinem – über Claude diktierte Einträge stehen dort. Einstellungen → Claude: mit deinem Konto neu verbinden.</strong> : "Claude ist noch nicht verbunden."}
        </div>
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

      <section className="card card-pad stack" id="reflexion" data-testid="reflexion">
        <h2>Reflexion – für die nächste Sitzung</h2>
        <div className="small muted">
          Freie Zettel für die Paar-Sitzung (auch diktiert über Claude). Nur für dich sichtbar.{" "}
          {sitzungen.naechste ? <>Nächste Paartherapie-Sitzung laut Kalender: <strong>{dmy(sitzungen.naechste)}</strong>.</> : <>Keine kommende Paartherapie-Sitzung im Kalender – Datum unten von Hand eintragen.</>}
        </div>
        <StateForm action={addReflexionAction} submit="Zettel speichern" testid="reflexion-form">
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="r-day">Tag</label><input className="input" id="r-day" name="day" type="date" defaultValue={today} max={today} /></div>
            <div className="field"><label className="label" htmlFor="r-sitzung">Für die Sitzung am</label><input className="input" id="r-sitzung" name="sitzung" type="date" defaultValue={sitzungen.naechste ?? ""} /></div>
          </div>
          <div className="field"><label className="label" htmlFor="r-text">Was ich ansprechen möchte</label><textarea className="input" id="r-text" name="text" rows={4} maxLength={2000} /></div>
        </StateForm>
        {zettel.length === 0 ? <div className="small muted">Noch keine Zettel.</div> : (
          <table className="table small">
            <thead><tr><th>Tag</th><th>Für Sitzung</th><th>Zettel</th><th></th></tr></thead>
            <tbody>
              {zettel.map((z) => (
                <tr key={z.id} data-testid="reflexion-zeile">
                  <td style={{ whiteSpace: "nowrap" }}>{dmy(z.data.day)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{z.data.sitzung ? dmy(z.data.sitzung) : "–"}{offen.has(z.id) && <> <span className="tag tag-ok">offen</span></>}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{z.data.text}</td>
                  <td style={{ minWidth: 140 }}>
                    <details>
                      <summary className="btn-link small" style={{ cursor: "pointer" }}>bearbeiten</summary>
                      <StateForm action={updateReflexionAction} submit="Änderung speichern" testid="reflexion-edit-form">
                        <input type="hidden" name="id" value={z.id} />
                        <div className="field"><label className="label" htmlFor={`re-day-${z.id}`}>Tag</label><input className="input" id={`re-day-${z.id}`} name="day" type="date" defaultValue={z.data.day} max={today} /></div>
                        <div className="field"><label className="label" htmlFor={`re-s-${z.id}`}>Für die Sitzung am</label><input className="input" id={`re-s-${z.id}`} name="sitzung" type="date" defaultValue={z.data.sitzung ?? ""} /></div>
                        <div className="field"><label className="label" htmlFor={`re-t-${z.id}`}>Zettel</label><textarea className="input" id={`re-t-${z.id}`} name="text" rows={4} maxLength={2000} defaultValue={z.data.text} /></div>
                      </StateForm>
                    </details>
                    <form action={deleteEntryAction}><input type="hidden" name="kind" value="reflexion" /><input type="hidden" name="id" value={z.id} /><button className="btn-link small danger" type="submit" data-testid="reflexion-delete">löschen</button></form>
                  </td>
                </tr>
              ))}
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
