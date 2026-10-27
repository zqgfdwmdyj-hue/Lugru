import { todayIso } from "@/lib/dates";
import { thanksSince, type TalkEntry, type ThanksEntry } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { addTalkAction, deleteEntryAction } from "../../actions";
import { AddPanel } from "../../add-panel";
import { StateForm } from "../../state-form";
import { PrivatHead, dmy } from "../../ui";

/** Partnerschaft → Paar-Gespräch der Woche (Wertschätzungen seit dem letzten Gespräch stehen schon drin). */
export default async function GespraechPage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const s = await privateSettings(session.tenantId);
  const talks = (await loadEntries<TalkEntry>(session, ["gespraech"])).sort((a, b) => b.data.day.localeCompare(a.data.day));
  const thanks = await loadEntries<ThanksEntry>(session, ["danke"]);
  const pending = thanksSince(thanks.map((e) => e.data), talks[0]?.data.day ?? null);

  return (
    <>
      <PrivatHead active="gespraech" title="Paar-Gespräch" pin={session.privatePin} />
      <section className="card card-pad stack" id="gespraech">
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>So geht’s (nach Gottman: „State of the Union“)</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>Einmal pro Woche etwa eine Stunde, ruhiger Ort, Handys weg, jeder mit Zettel und Stift.</li>
            <li>Start: Jeder nennt fünf Dinge, die er in der Woche am anderen geschätzt hat – der andere sagt einfach „danke“.</li>
            <li>Dann ein Thema. Abwechselnd: einer erzählt (Ich-Botschaften), der andere hört nur zu und fasst zusammen.</li>
            <li>Erst wenn beide sagen „Ja, genau so fühle ich mich“, gemeinsam nach Lösungen schauen.</li>
          </ul>
        </details>
        <AddPanel label="Gespräch festhalten" testid="talk-add">
          <StateForm action={addTalkAction} submit="Gespräch speichern" testid="talk-form">
            <div className="priv-grid">
              <div className="field"><label className="label" htmlFor="t-day">Tag</label><input className="input" id="t-day" name="day" type="date" defaultValue={today} max={today} /></div>
            </div>
            <div className="priv-grid">
              <div className="field"><label className="label" htmlFor="t-a">{s.partners.a} schätzt an {s.partners.b}</label><textarea className="input" id="t-a" name="appreciationsA" rows={3} defaultValue={pending.a.join("\n")} /></div>
              <div className="field"><label className="label" htmlFor="t-b">{s.partners.b} schätzt an {s.partners.a}</label><textarea className="input" id="t-b" name="appreciationsB" rows={3} defaultValue={pending.b.join("\n")} /></div>
            </div>
            <div className="field"><label className="label" htmlFor="t-topic">Thema</label><input className="input" id="t-topic" name="topic" /></div>
            <div className="field"><label className="label" htmlFor="t-agreed">Was wir mitnehmen / vereinbaren</label><textarea className="input" id="t-agreed" name="agreed" rows={2} /></div>
          </StateForm>
        </AddPanel>
        {talks.length === 0 ? <div className="small muted">Noch kein Gespräch festgehalten.</div> : (
          <div className="stack" style={{ gap: 8 }}>
            {talks.slice(0, 20).map((t) => (
              <details key={t.id} className="card card-pad" style={{ padding: 10 }}>
                <summary style={{ cursor: "pointer" }}><strong>{dmy(t.data.day)}</strong>{t.data.topic ? ` · ${t.data.topic}` : ""}</summary>
                <div className="small stack" style={{ gap: 6, marginTop: 8, whiteSpace: "pre-wrap" }}>
                  {t.data.appreciationsA && <div><strong>{s.partners.a}:</strong> {t.data.appreciationsA}</div>}
                  {t.data.appreciationsB && <div><strong>{s.partners.b}:</strong> {t.data.appreciationsB}</div>}
                  {t.data.agreed && <div><strong>Vereinbart:</strong> {t.data.agreed}</div>}
                  <form action={deleteEntryAction}><input type="hidden" name="kind" value="gespraech" /><input type="hidden" name="id" value={t.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>löschen</button></form>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
