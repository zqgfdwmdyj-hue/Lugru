import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { clockShiftHours, dateReminder, dateStats, kidsHours, overnight, shiftMonth, type DateEntry, type DateIdea } from "@/lib/private/logic";
import { paarzeitVorschlag } from "@/lib/private/familie-termine";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { addDateAction, addIdeaAction, deleteEntryAction, toggleIdeaAction } from "../../actions";
import { AddPanel } from "../../add-panel";
import { StateForm } from "../../state-form";
import { Counted, MonthNav, PrivatHead, Rating, clockShiftLabel, dm, hoursLabel, monthLabel, monthParam, weekday, StatusTag } from "../../ui";

const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const n = (v: number | undefined) => (v === undefined ? "" : String(v).replace(".", ","));

/** Partnerschaft → Paarzeit: zu zweit unterwegs, Kinder bei Babysitterin & Co.; Date-Ideen. */
export default async function PaarzeitPage({ searchParams }: { searchParams: Promise<{ monat?: string; bearbeiten?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const today = todayIso();
  const month = monthParam(sp.monat);
  const s = await privateSettings(session.tenantId);
  const dates = (await loadEntries<DateEntry>(session, ["paarzeit"])).sort((a, b) => b.data.day.localeCompare(a.data.day) || (b.data.from ?? "").localeCompare(a.data.from ?? ""));
  const ds = dateStats(dates.map((e) => e.data), month, today);
  const inMonth = dates.filter((e) => e.data.day.startsWith(month));
  const prevDates = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, n: dates.filter((e) => e.data.day.startsWith(m)).length }));
  const sitters = [...new Set(["Babysitterin", "Oma", "Opa", ...dates.map((e) => e.data.sitter).filter((x): x is string => Boolean(x))])];
  const ideas = (await loadEntries<DateIdea>(session, ["dateidee"])).sort((a, b) => Number(a.data.done ?? false) - Number(b.data.done ?? false) || b.createdAt.getTime() - a.createdAt.getTime());
  const remind = dateReminder(ds.last, today, s.dateReminderDays);
  // Modul 9: Vorschlag aus den Date-Ideen + freie Abende (ohne andere Privat-Termine) + Betreuung.
  const belegt = new Set((await loadEntries<{ day: string; status?: string }>(session, ["termin", "paarzeit", "auszeit"])).filter((e) => e.data.status !== "ausgefallen").map((e) => e.data.day));
  const vorschlag = paarzeitVorschlag({ letztes: ds.last, geplant: dates.filter((e) => e.data.status === "geplant").map((e) => e.data.day), heute: today, zielTage: s.dateReminderDays, ideen: ideas.map((i) => ({ text: i.data.text, done: i.data.done, angelegt: i.createdAt.getTime() })), belegt, kinder: s.kids.length > 0 });
  const edit = sp.bearbeiten ? dates.find((e) => e.id === sp.bearbeiten) : undefined;
  const v = edit?.data;
  const line = (d: DateEntry) =>
    [d.from && d.to ? `${d.from}–${d.to}${overnight(d) ? " (bis nächster Tag)" : ""}${clockShiftHours(d) ? ` (${clockShiftLabel(clockShiftHours(d))}, ${hoursLabel(kidsHours(d))})` : ""}` : kidsHours(d) ? hoursLabel(kidsHours(d)) : "", d.what, d.sitter ? `Kinder bei ${d.sitter}` : "", d.costEur ? euro(d.costEur) : "", d.rating ? `${d.rating}/5` : ""].filter(Boolean).join(" · ");

  return (
    <>
      <PrivatHead active="paarzeit" title="🥂 Paarzeit" pin={session.privatePin} month={month} sub={<MonthNav path="/privat/paar/paarzeit" month={month} />} />
      <div className="small muted">Dates und Zeit nur für euch beide, während die Kinder bei der Babysitterin, Oma &amp; Co. sind. Babysitter-Kosten aus dem Kalender mit Stundensatz: <Link href={`/privat/haushaltshilfe?monat=${month}`}>Babysitter &amp; Putzhilfe →</Link></div>
      {remind !== null && (
        <div className="notice notice-info small" data-testid="date-remind">
          Euer letztes Date ist {remind} Tage her – Zeit, das nächste zu planen?
          {vorschlag ? (
            <span data-testid="date-vorschlag">
              {vorschlag.idee ? <> Idee: <strong>{vorschlag.idee}</strong>.</> : " Ideen stehen unten."}
              {vorschlag.abende.length > 0 && <> Freie Abende: {vorschlag.abende.map((d) => `${weekday(d).slice(0, 2)} ${dm(d)}`).join(", ")}.</>}
              {vorschlag.hinweis && <> {vorschlag.hinweis}.</>}
            </span>
          ) : " Ideen stehen unten."}
        </div>
      )}

      <section className="card card-pad stack">
        <div className="priv-grid" data-testid="date-stats">
          <div><div className="kpi-label">{monthLabel(month)}</div><strong data-testid="date-month"><Counted count={ds.inMonth}>{ds.inMonth}×</Counted></strong>{ds.hoursInMonth ? ` · ${hoursLabel(ds.hoursInMonth)}` : ""}</div>
          <div><div className="kpi-label">Vormonate</div>{prevDates.map((p) => `${monthLabel(p.m).split(" ")[0].slice(0, 3)} ${p.n ? `${p.n}×` : "–"}`).join(" · ")}</div>
          <div><div className="kpi-label">Ø Abstand (90 Tage)</div><strong>{ds.avgGapDays === null ? "–" : `${String(ds.avgGapDays).replace(".", ",")} Tage`}</strong>{ds.last90 ? ` · ${ds.last90}× in 90 Tagen` : ""}</div>
          {ds.costInMonth > 0 && <div><div className="kpi-label">Babysitter {monthLabel(month).split(" ")[0]}</div><strong>{euro(ds.costInMonth)}</strong></div>}
          {ds.costInYear > 0 && <div><div className="kpi-label">Babysitter {month.slice(0, 4)}</div><strong data-testid="date-cost-year">{euro(ds.costInYear)}</strong></div>}
        </div>
        <AddPanel label={edit ? "Paarzeit ändern" : "Paarzeit eintragen"} defaultOpen={Boolean(edit)} testid="date-add">
          <StateForm key={edit?.id ?? "neu"} action={addDateAction} submit={edit ? "Änderung speichern" : "Paarzeit eintragen"} testid="date-form" keep={Boolean(edit)}>
            {edit && <input type="hidden" name="id" value={edit.id} />}
            <div className="priv-grid">
              <div className="field"><label className="label" htmlFor="pz-day">Tag (Beginn)</label><input className="input" id="pz-day" name="day" type="date" defaultValue={v?.day ?? today} max={today} /></div>
              <div className="field"><label className="label" htmlFor="pz-from">von</label><input className="input" id="pz-from" name="from" type="time" defaultValue={v?.from ?? ""} /></div>
              <div className="field"><label className="label" htmlFor="pz-to">bis</label><input className="input" id="pz-to" name="to" type="time" defaultValue={v?.to ?? ""} /></div>
              <div className="field"><label className="label" htmlFor="pz-hours">oder Stunden</label><input className="input" id="pz-hours" name="hours" inputMode="decimal" placeholder="z. B. 3" defaultValue={v?.from ? "" : n(v?.hours)} /></div>
            </div>
            <div className="small muted">Über Mitternacht? Einfach z. B. 20:00–01:00 – zählt am Tag des Beginns.</div>
            <details open={Boolean(edit)}>
              <summary className="small" style={{ cursor: "pointer" }}>Mehr Angaben (optional)</summary>
              <div className="stack" style={{ gap: 10, marginTop: 8 }}>
                <div className="priv-grid">
                  <div className="field"><label className="label" htmlFor="pz-what">Was habt ihr gemacht?</label><input className="input" id="pz-what" name="what" autoComplete="off" placeholder="z. B. Essen gehen, Kino" defaultValue={v?.what ?? ""} /></div>
                  <div className="field">
                    <label className="label" htmlFor="pz-sitter">Wer hat auf die Kinder aufgepasst?</label>
                    <input className="input" id="pz-sitter" name="sitter" list="pz-sitters" autoComplete="off" defaultValue={v?.sitter ?? ""} />
                    <datalist id="pz-sitters">{sitters.map((x) => <option key={x} value={x} />)}</datalist>
                  </div>
                  <div className="field"><label className="label" htmlFor="pz-cost">Kosten Babysitter (€)</label><input className="input" id="pz-cost" name="costEur" inputMode="decimal" defaultValue={n(v?.costEur)} /></div>
                </div>
                <Rating name="rating" label="Wie war’s?" low="naja" high="wunderbar" value={v?.rating} />
                <div className="field"><label className="label" htmlFor="pz-note">Notiz</label><input className="input" id="pz-note" name="note" autoComplete="off" defaultValue={v?.note ?? ""} /></div>
              </div>
            </details>
            {edit && <Link className="small" href={`/privat/paar/paarzeit?monat=${month}`}>fertig / abbrechen</Link>}
          </StateForm>
        </AddPanel>
      </section>

      <section className="card stack" style={{ padding: 0 }}>
        <h2 style={{ padding: "14px 16px 0" }}>{monthLabel(month)}</h2>
        {inMonth.length === 0 ? <div className="small muted" style={{ padding: "0 16px 14px" }}>In diesem Monat nichts erfasst.</div> : (
          <table className="table" data-testid="date-list">
            <tbody>
              {inMonth.map((e) => (
                <tr key={e.id}>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>{weekday(e.data.day)} {dm(e.data.day)}</td>
                  <td className="small">{line(e.data) || "–"}{e.data.note ? <div className="muted">{e.data.note}</div> : null}{e.data.editedAt ? <span className="muted"> · geändert</span> : null}<StatusTag status={e.data.status} /></td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    <Link className="btn-link small" href={`/privat/eintrag/${e.id}`}>ändern</Link>{" "}
                    <form action={deleteEntryAction} style={{ display: "inline" }}><input type="hidden" name="kind" value="paarzeit" /><input type="hidden" name="id" value={e.id} /><button className="btn-link small danger" type="submit">löschen</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card-pad stack" id="ideen">
        <h2>💡 Date-Ideen</h2>
        {ideas.length > 0 && (
          <div className="stack" style={{ gap: 4 }} data-testid="ideas">
            {ideas.map((i) => (
              <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <form action={toggleIdeaAction}><input type="hidden" name="id" value={i.id} /><button className={`btn btn-small${i.data.done ? " btn-primary" : ""}`} type="submit" aria-pressed={Boolean(i.data.done)} title="gemacht / noch offen">{i.data.done ? "✓" : "○"}</button></form>
                <span className="small" style={{ textDecoration: i.data.done ? "line-through" : undefined, flex: 1 }}>{i.data.text}</span>
                <form action={deleteEntryAction}><input type="hidden" name="kind" value="dateidee" /><input type="hidden" name="id" value={i.id} /><button className="btn-link x-danger" type="submit" aria-label="Idee löschen">×</button></form>
              </div>
            ))}
          </div>
        )}
        <StateForm action={addIdeaAction} submit="Idee speichern" testid="idea-form" className="">
          <input className="input" name="text" required placeholder="z. B. Thermalbad, Kochkurs, Konzert, Picknick" autoComplete="off" />
        </StateForm>
        <div className="small muted">Hinweis „Zeit für ein Date?“ nach {s.dateReminderDays || "–"} Tagen – in den Einstellungen änderbar.</div>
      </section>
    </>
  );
}
