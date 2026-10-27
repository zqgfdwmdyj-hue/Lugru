import { todayIso } from "@/lib/dates";
import { CARE_SUGGESTIONS, careOverview, type CareOwner, type CareTask } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate, type Entry } from "@/lib/private/service";
import { addCareAction, addCareSuggestionsAction, careDoneAction, deleteEntryAction, setCareOwnerAction } from "../actions";
import { StateForm } from "../state-form";
import { Chips, Choice, PrivatHead, dm, dmy } from "../ui";

const COLOR = { a: "#0d9488", b: "#c2410c" } as const;
const REPEAT: Record<CareTask["repeat"], string> = { einmal: "einmal", woechentlich: "wöchentlich", monatlich: "monatlich", jaehrlich: "jährlich", laufend: "laufend" };

export default async function FamiliePage() {
  const session = await requirePrivate();
  const today = todayIso();
  const s = await privateSettings(session.tenantId);
  const name = s.partners;
  const tasks = (await loadEntries<CareTask>(session, ["zustaendig"])).sort((a, b) => a.data.title.localeCompare(b.data.title, "de"));
  const ov = careOverview(tasks.map((t) => t.data), today);
  const ownerLabel = (o: CareOwner) => (o === "a" ? name.a : o === "b" ? name.b : o === "beide" ? "beide" : "noch offen");
  const groups: CareOwner[] = ["offen", "a", "b", "beide"];
  const missing = CARE_SUGGESTIONS.filter((x) => !tasks.some((t) => t.data.title === x));

  const Item = ({ t }: { t: Entry<CareTask> }) => {
    const last = t.data.done?.[t.data.done.length - 1];
    return (
      <div className="card card-pad stack" style={{ gap: 6, padding: 12 }} data-testid="care-item">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <strong>{t.data.title}</strong>
            <div className="small muted">
              {REPEAT[t.data.repeat]}
              {t.data.next ? ` · nächstes Mal ${dmy(t.data.next)}` : ""}
              {last ? ` · zuletzt ${dm(last.day)} (${name[last.by]})` : ""}
            </div>
            {t.data.notes && <div className="small">{t.data.notes}</div>}
          </div>
          <form action={careDoneAction}>
            <input type="hidden" name="id" value={t.id} />
            <button className="btn btn-small" type="submit" title="Heute erledigt – wird dem zugerechnet, der angemeldet ist">✓ erledigt</button>
          </form>
        </div>
        <form action={setCareOwnerAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={t.id} />
          <label className="small muted" htmlFor={`o-${t.id}`}>Zuständig:</label>
          <select className="select" id={`o-${t.id}`} name="owner" defaultValue={t.data.owner} style={{ padding: "4px 8px", fontSize: 13 }}>
            <option value="offen">noch offen</option>
            <option value="a">{name.a}</option>
            <option value="b">{name.b}</option>
            <option value="beide">beide</option>
          </select>
          <button className="btn btn-small" type="submit">ändern</button>
          <button className="btn-link small danger" type="submit" formAction={deleteEntryAction} name="kind" value="zustaendig" style={{ marginLeft: "auto" }}>löschen</button>
        </form>
      </div>
    );
  };

  return (
    <>
      <PrivatHead active="familie" title="Wer kümmert sich?" pin={session.privatePin} />
      <div className="small muted">Der „Mental Load“: an was alles gedacht werden muss. Klar verteilt ist es leichter. Die Zahlen zeigen nur, was eingetragen ist – keine Bewertung, wer mehr leistet.</div>

      <section className="card card-pad stack">
        <h2>Verteilung</h2>
        <div className="priv-grid" data-testid="care-owned">
          <div><div className="kpi-label"><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COLOR.a, marginRight: 6 }} />{name.a}</div><div className="kpi-value">{ov.owned.a}</div><div className="small muted">zuständig</div></div>
          <div><div className="kpi-label"><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COLOR.b, marginRight: 6 }} />{name.b}</div><div className="kpi-value">{ov.owned.b}</div><div className="small muted">zuständig</div></div>
          <div><div className="kpi-label">beide</div><div className="kpi-value">{ov.owned.beide}</div></div>
          <div><div className="kpi-label">noch offen</div><div className="kpi-value">{ov.owned.offen}</div></div>
        </div>
        {ov.shareA !== null && (ov.doneBy.a === 0 || ov.doneBy.b === 0) && (
          <div className="small muted" data-testid="care-done">Als erledigt eingetragen (30 Tage): {name.a} {ov.doneBy.a ? `${ov.doneBy.a}×` : "nichts eingetragen"} · {name.b} {ov.doneBy.b ? `${ov.doneBy.b}×` : "nichts eingetragen"} – kein Anteil, solange eine Seite nichts eingetragen hat.</div>
        )}
        {ov.shareA !== null && ov.doneBy.a > 0 && ov.doneBy.b > 0 && (
          <>
            <div className="priv-share" role="img" aria-label={`Erledigt in 30 Tagen: ${name.a} ${ov.doneBy.a}, ${name.b} ${ov.doneBy.b}`} style={{ gap: ov.shareA > 0 && ov.shareA < 100 ? 2 : 0 }}>
              <span style={{ width: `${ov.shareA}%`, background: COLOR.a }} />
              <span style={{ width: `${100 - ov.shareA}%`, background: COLOR.b }} />
            </div>
            <div className="small muted" data-testid="care-done">Als erledigt eingetragen (30 Tage): {name.a} {ov.doneBy.a}× · {name.b} {ov.doneBy.b}×</div>
          </>
        )}
        {ov.due.length > 0 && (
          <div className="notice notice-warn small" data-testid="care-due">
            Demnächst: {ov.due.map((t) => `${t.title} (${dm(t.next!)}${t.next! < today ? ", überfällig" : ""}, ${ownerLabel(t.owner)})`).join(" · ")}
          </div>
        )}
      </section>

      {groups.map((g) => {
        const list = tasks.filter((t) => t.data.owner === g);
        if (!list.length) return null;
        return (
          <section key={g} className="stack" style={{ gap: 8 }}>
            <h2>{g === "offen" ? "Noch niemand zuständig" : g === "beide" ? "Beide" : name[g]} ({list.length})</h2>
            {list.map((t) => <Item key={t.id} t={t} />)}
          </section>
        );
      })}

      <section className="card card-pad stack">
        <h2>Neu</h2>
        <StateForm action={addCareAction} submit="Anlegen" testid="care-form">
          <div className="field"><label className="label" htmlFor="c-title">Worum geht es?</label><input className="input" id="c-title" name="title" required placeholder="z. B. Zahnarzt-Termine der Kinder" /></div>
          <div className="field"><span className="label">Zuständig</span><Choice name="owner" value="offen" options={[{ value: "a", label: name.a }, { value: "b", label: name.b }, { value: "beide", label: "beide" }, { value: "offen", label: "noch offen" }]} /></div>
          <div className="field"><span className="label">Wie oft</span><Choice name="repeat" value="laufend" options={[{ value: "laufend", label: "laufend" }, { value: "woechentlich", label: "wöchentlich" }, { value: "monatlich", label: "monatlich" }, { value: "jaehrlich", label: "jährlich" }, { value: "einmal", label: "einmal" }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="c-next">nächstes Mal (optional)</label><input className="input" id="c-next" name="next" type="date" /></div>
          </div>
          <div className="field"><label className="label" htmlFor="c-notes">Notiz (optional)</label><input className="input" id="c-notes" name="notes" autoComplete="off" /></div>
        </StateForm>
        {missing.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Vorschläge übernehmen ({missing.length})</summary>
            <div style={{ marginTop: 8 }}>
              <StateForm action={addCareSuggestionsAction} submit="Ausgewählte übernehmen" testid="care-suggest">
                <Chips name="pick" options={missing} />
              </StateForm>
            </div>
          </details>
        )}
      </section>
    </>
  );
}
