import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays } from "@/lib/private/logic";
import { WEEKDAY_SHORT, defaultRitual, ritualOccurrences, touchRhythm, type RitualEntry, type TouchEntry } from "@/lib/private/kalender";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { saveRitualAction } from "../eintrag-actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead, dm, dmy, weekday } from "../ui";

/**
 * „Unser Abendritual“: Wochenvorlage für Streicheln und Massage. Im Kalender erscheinen die Abende als
 * geplant; erst bestätigte zählen (Rhythmus „zweimal Streicheln, dann Massage“).
 */
export default async function RitualPage({ searchParams }: { searchParams: Promise<{ neu?: string }> }) {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const [rituals, touches, s] = await Promise.all([loadEntries<RitualEntry>(session, ["ritual"]), loadEntries<TouchEntry>(session, ["zuwendung"]), privateSettings(session.tenantId)]);
  const sorted = [...rituals].sort((a, b) => b.data.from.localeCompare(a.data.from));
  const current = sorted.find((r) => r.data.active && (!r.data.until || r.data.until >= today)) ?? null;
  const ended = sorted.filter((r) => r !== current);
  const fresh = (await searchParams).neu === "1" || !current;
  const r = current?.data ?? defaultRitual(today);
  const n = s.partners;
  const rhythm = current ? touchRhythm(touches.map((t) => t.data), current.data) : null;
  const handled = new Set(touches.map((t) => t.data.occurrence).filter((o): o is string => Boolean(o)));
  const abfolge = r.mode === "abfolge";
  // Abfolge: die nächsten Abende über zwei Wochen, damit man die Reihenfolge sieht.
  const next = current ? ritualOccurrences(current.id, current.data, today, addDays(today, abfolge ? 13 : 6), handled).slice(0, 8) : [];
  const has = (wd: number, k: "streicheln" | "massage") => !abfolge && r.slots.some((x) => x.weekday === wd && x.kind === k);
  const evening = (wd: number) => abfolge && r.slots.some((x) => x.weekday === wd);
  const giver = (k: "streicheln" | "massage") => r.slots.find((x) => x.kind === k)?.giver ?? (k === "streicheln" ? "a" : "b");
  const timeOf = (k: "streicheln" | "massage") => r.slots.find((x) => x.kind === k)?.time;

  return (
    <>
      <PrivatHead active="ritual" title="Unser Abendritual" />
      {current && rhythm && (
        <section className="card card-pad stack" data-testid="ritual-rhythm">
          <h2>Rhythmus</h2>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{rhythm.count}/{rhythm.target} Streicheleinheiten seit der letzten Massage{rhythm.due ? " – Massage ist dran 💆" : ""}</div>
          <div className="small muted">{rhythm.lastMassage ? `Letzte bestätigte Massage: ${dmy(rhythm.lastMassage)}.` : "Noch keine Massage bestätigt."} Es zählt nur, was als „stattgefunden“ bestätigt ist – Geplantes nie.</div>
          {next.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="label small">Die nächsten Abende (geplant){abfolge ? ` – Abfolge ${r.strokesPerMassage}× Streicheln, dann Massage` : ""}</div>
              {next.map((o) => (
                <Link key={o.key} href={`/privat/eintrag/serie?vorkommen=${encodeURIComponent(o.key)}`} className="small" data-testid="ritual-next" data-kind={o.slot.kind}>
                  {weekday(o.day)} {dm(o.day)} · {o.slot.kind === "massage" ? `${n[o.slot.giver]} massiert ${n[o.slot.receiver]}` : `${n[o.slot.giver]} streichelt ${n[o.slot.receiver]}`}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="card card-pad stack">
        <h2>{current && !fresh ? "Vorlage ändern" : current ? "Neue Vorlage" : "Vorlage anlegen"}</h2>
        <p className="small muted">
          {current ? "Änderungen gelten für die noch offenen Abende. Bestätigte, verschobene oder ausgelassene Abende bleiben, wie sie sind. Ändert sich der Ablauf ab einem späteren Tag, bleiben frühere Wochen unverändert." : "Vorschlag nach eurem Ablauf: Mo–Do Streicheln, Di und Do zusätzlich Massage, Fr–So frei. Alles anpassbar."}
        </p>
        <StateForm action={saveRitualAction} submit={current ? "Vorlage speichern" : "Vorlage anlegen"} testid="ritual-form" keep className="stack ritual-form">
          {current && <input type="hidden" name="id" value={current.id} />}
          <div className="field"><label className="label small" htmlFor="r-title">Name</label><input className="input" id="r-title" name="title" defaultValue={r.title} maxLength={60} /></div>
          <div className="field">
            <span className="label small">Ablauf</span>
            <Choice name="modus" value={abfolge ? "abfolge" : "woche"} options={[{ value: "woche", label: "Feste Wochentage" }, { value: "abfolge", label: "Abfolge: n× Streicheln, dann Massage" }]} />
          </div>
          <fieldset className="field nur-abfolge" style={{ border: 0, padding: 0, margin: 0 }} data-testid="ritual-evenings">
            <legend className="label small">An welchen Abenden? Der Reihe nach: Streicheln, Streicheln …, dann Massage – egal an welchem Wochentag.</legend>
            <div className="pick-chips">
              {WEEKDAY_SHORT.map((w, i) => (
                <label key={w}><input type="checkbox" name={`a-${i + 1}`} defaultChecked={abfolge ? evening(i + 1) : i < 4} /><span>{w}</span></label>
              ))}
            </div>
          </fieldset>
          <div className="table-wrap nur-woche">
            <table className="table" style={{ maxWidth: 520 }} data-testid="ritual-grid">
              <thead>
                <tr><th>Tag</th><th>Streicheln</th><th>Massage</th></tr>
              </thead>
              <tbody>
                {WEEKDAY_SHORT.map((w, i) => (
                  <tr key={w}>
                    <td>{w}</td>
                    <td><label className="check"><input type="checkbox" name={`s-${i + 1}-streicheln`} defaultChecked={has(i + 1, "streicheln")} aria-label={`${w} Streicheln`} /></label></td>
                    <td><label className="check"><input type="checkbox" name={`s-${i + 1}-massage`} defaultChecked={has(i + 1, "massage")} aria-label={`${w} Massage`} /></label></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="field"><span className="label small">Streicheln: wer gibt?</span><Choice name="streicheln-giver" value={giver("streicheln")} options={[{ value: "a", label: `${n.a} streichelt ${n.b}` }, { value: "b", label: `${n.b} streichelt ${n.a}` }]} /></div>
          <div className="field"><span className="label small">Massage: wer gibt?</span><Choice name="massage-giver" value={giver("massage")} options={[{ value: "a", label: `${n.a} massiert ${n.b}` }, { value: "b", label: `${n.b} massiert ${n.a}` }]} /></div>
          <div className="pk-form-grid">
            <div className="field"><label className="label small" htmlFor="r-st">Uhrzeit Streicheln (optional)</label><input className="input" id="r-st" type="time" name="streicheln-time" defaultValue={timeOf("streicheln")} /></div>
            <div className="field"><label className="label small" htmlFor="r-mt">Uhrzeit Massage (optional)</label><input className="input" id="r-mt" type="time" name="massage-time" defaultValue={timeOf("massage")} /></div>
            <div className="field"><label className="label small" htmlFor="r-n">Massage nach … Streicheleinheiten</label><input className="input" id="r-n" name="strokesPerMassage" inputMode="numeric" defaultValue={r.strokesPerMassage} /></div>
          </div>
          <div className="pk-form-grid">
            <div className="field"><label className="label small" htmlFor="r-from">{current ? "Änderung gilt ab" : "Beginnt am"}</label><input className="input" id="r-from" type="date" name="from" defaultValue={today} required /></div>
            <div className="field"><label className="label small" htmlFor="r-until">Endet am (optional)</label><input className="input" id="r-until" type="date" name="until" defaultValue={current?.data.until} /></div>
          </div>
        </StateForm>
      </section>

      {ended.length > 0 && (
        <details className="card card-pad">
          <summary className="small" style={{ cursor: "pointer" }}>Frühere Fassungen ({ended.length})</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {ended.map((e) => <li key={e.id}>{e.data.title}: {dmy(e.data.from)}{e.data.until ? ` – ${dmy(e.data.until)}` : ""} · {e.data.slots.length} Abende je Woche</li>)}
          </ul>
        </details>
      )}
    </>
  );
}
