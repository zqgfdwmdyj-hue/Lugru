import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { kidsHours, kidsOverview, nextSleeper, shiftMonth, type SleepEntry } from "@/lib/private/logic";
import { loadEntries, myPartner, privateSettings, requirePrivate, type Entry } from "@/lib/private/service";
import { addSleepAction, deleteEntryAction } from "../actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead, dm, hoursLabel, monthLabel, weekday } from "../ui";

/** Gleiche Farben wie bei der Kinderzeit (auf Farbsehschwäche geprüft); Name steht immer dabei. */
const COLOR = { a: "#0d9488", b: "#c2410c" } as const;

function Cell({ list }: { list: Entry<SleepEntry>[] }) {
  if (!list.length) return <span className="muted">–</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {list.map((e) => (
        <div key={e.id}>
          <strong>{e.data.from && e.data.to ? `${e.data.from}–${e.data.to}` : ""}</strong>
          {e.data.from && e.data.to ? " · " : ""}
          {hoursLabel(kidsHours(e.data))}
          {e.data.note ? <span className="muted"> · {e.data.note}</span> : null}
          <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}>
            <input type="hidden" name="kind" value="ausschlafen" />
            <input type="hidden" name="id" value={e.id} />
            <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} aria-label="Eintrag löschen">×</button>
          </form>
        </div>
      ))}
    </div>
  );
}

export default async function AusschlafenPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : today.slice(0, 7);
  const s = await privateSettings(session.tenantId);
  const all = await loadEntries<SleepEntry>(session, ["ausschlafen"]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const ov = kidsOverview(all.map((e) => ({ ...e.data, id: e.id })), month);
  const name = s.partners;
  const next = nextSleeper(all.map((e) => ({ ...e.data, at: e.createdAt.getTime() })), today.slice(0, 7));
  const last = [...all].sort((x, y) => y.data.day.localeCompare(x.data.day) || y.createdAt.getTime() - x.createdAt.getTime())[0]?.data;
  const me = myPartner(s, session);
  const last3 = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, ...kidsOverview(all.map((e) => e.data), m).totals }));

  return (
    <>
      <PrivatHead active="ausschlafen" title="Ausschlafen" pin={session.privatePin} sub={
        <div style={{ display: "flex", gap: 6 }}>
          <Link className="btn btn-small" href={`/privat/ausschlafen?monat=${shiftMonth(month, -1)}`} aria-label="Voriger Monat">‹</Link>
          <span className="btn btn-small" style={{ pointerEvents: "none" }}>{monthLabel(month)}</span>
          <Link className="btn btn-small" href={`/privat/ausschlafen?monat=${shiftMonth(month, 1)}`} aria-label="Nächster Monat">›</Link>
        </div>
      } />

      {next && (
        <div className="notice notice-info" data-testid="sleep-next">
          😴 Als Nächstes darf <strong>{name[next]}</strong> ausschlafen
          {last ? <span className="small muted"> – zuletzt {name[last.person]} am {weekday(last.day)} {dm(last.day)}</span> : null}
        </div>
      )}

      <section className="card card-pad stack">
        <h2>Wer hat wie lange ausgeschlafen – {monthLabel(month)}</h2>
        <div className="priv-grid">
          {(["a", "b"] as const).map((k) => (
            <div key={k} data-testid={`sleep-total-${k}`}>
              <div className="kpi-label"><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COLOR[k], marginRight: 6 }} />{name[k]}</div>
              <div className="kpi-value">{ov.totals[k].count}×</div>
              <div className="small muted">{hoursLabel(ov.totals[k].hours)} länger geschlafen</div>
            </div>
          ))}
        </div>
        {ov.shareA !== null && (
          <>
            <div className="priv-share" role="img" aria-label={`${name.a} ${ov.shareA} %, ${name.b} ${100 - ov.shareA} %`} style={{ gap: ov.shareA > 0 && ov.shareA < 100 ? 2 : 0 }}>
              <span style={{ width: `${ov.shareA}%`, background: COLOR.a }} />
              <span style={{ width: `${100 - ov.shareA}%`, background: COLOR.b }} />
            </div>
            <div className="small muted">{name.a} {ov.shareA} % · {name.b} {100 - ov.shareA} % der Ausschlaf-Stunden</div>
          </>
        )}
        <div className="small muted">Vormonate: {last3.map((x) => `${monthLabel(x.m).split(" ")[0].slice(0, 3)} ${name.a} ${x.a.count}× / ${name.b} ${x.b.count}×`).join(" · ")}</div>
      </section>

      <section className="card card-pad stack">
        <h2>Eintragen</h2>
        <StateForm action={addSleepAction} submit="Eintragen" testid="sleep-form">
          <div className="field"><span className="label">Wer hat ausgeschlafen?</span><Choice name="person" value={next ?? me} options={[{ value: "a", label: name.a }, { value: "b", label: name.b }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="s-day">Tag</label><input className="input" id="s-day" name="day" type="date" defaultValue={today} max={today} /></div>
            <div className="field"><label className="label" htmlFor="s-from">sonst auf um</label><input className="input" id="s-from" name="from" type="time" defaultValue={s.wakeTime} /></div>
            <div className="field"><label className="label" htmlFor="s-to">aufgestanden um</label><input className="input" id="s-to" name="to" type="time" /></div>
            <div className="field"><label className="label" htmlFor="s-hours">oder Stunden</label><input className="input" id="s-hours" name="hours" inputMode="decimal" placeholder="z. B. 2,5" /></div>
          </div>
          <div className="field"><label className="label" htmlFor="s-note">Notiz (optional)</label><input className="input" id="s-note" name="note" autoComplete="off" placeholder="z. B. nach schlechter Nacht" /></div>
          <div className="small muted">„Sonst auf um“ ist eure übliche Aufstehzeit (in den Einstellungen änderbar) – gezählt wird die Zeit bis „aufgestanden um“.</div>
        </StateForm>
      </section>

      <section className="card" data-testid="sleep-table">
        <div className="priv-cols">
          <div className="head">Tag</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.a, marginRight: 5 }} />{name.a}</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.b, marginRight: 5 }} />{name.b}</div>
          {ov.days.length === 0 && <div style={{ gridColumn: "1 / -1" }} className="muted">In diesem Monat noch nichts eingetragen.</div>}
          {ov.days.map((d) => [
            <div key={`${d.day}-d`} className="num">{weekday(d.day)} {dm(d.day)}</div>,
            <div key={`${d.day}-a`}><Cell list={d.a.map((e) => byId.get((e as SleepEntry & { id: string }).id)!)} /></div>,
            <div key={`${d.day}-b`}><Cell list={d.b.map((e) => byId.get((e as SleepEntry & { id: string }).id)!)} /></div>,
          ])}
          <div className="head">Summe</div>
          <div className="head">{ov.totals.a.count}× · {hoursLabel(ov.totals.a.hours)}</div>
          <div className="head">{ov.totals.b.count}× · {hoursLabel(ov.totals.b.hours)}</div>
        </div>
      </section>
    </>
  );
}
