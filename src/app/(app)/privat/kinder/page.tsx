import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { kidsHours, kidsOverview, shiftMonth, type KidsEntry } from "@/lib/private/logic";
import { loadEntries, myPartner, privateSettings, requirePrivate, type Entry } from "@/lib/private/service";
import { addKidsAction, deleteEntryAction } from "../actions";
import { StateForm } from "../state-form";
import { Chips, Choice, PrivatHead, dm, hoursLabel, monthLabel, weekday } from "../ui";

/** Farben je Person (geprüft auf Farbsehschwäche); Name steht immer dabei. */
const COLOR = { a: "#0d9488", b: "#c2410c" } as const;

function Cell({ list }: { list: Entry<KidsEntry>[] }) {
  if (!list.length) return <span className="muted">–</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {list.map((e) => (
        <div key={e.id}>
          <strong>{e.data.from && e.data.to ? `${e.data.from}–${e.data.to}` : hoursLabel(kidsHours(e.data))}</strong>
          {e.data.what ? ` · ${e.data.what}` : ""}
          {e.data.kids?.length ? <span className="muted"> · {e.data.kids.join(", ")}</span> : null}
          <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}>
            <input type="hidden" name="kind" value="kinder" />
            <input type="hidden" name="id" value={e.id} />
            <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} aria-label="Eintrag löschen">×</button>
          </form>
        </div>
      ))}
    </div>
  );
}

export default async function KinderPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : today.slice(0, 7);
  const s = await privateSettings(session.tenantId);
  const all = await loadEntries<KidsEntry>(session, ["kinder"]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const ov = kidsOverview(all.map((e) => ({ ...e.data, id: e.id })), month);
  const name = s.partners;
  const me = myPartner(s, session);
  const last3 = [0, 1, 2].map((i) => shiftMonth(month, -i)).map((m) => ({ m, ...kidsOverview(all.map((e) => e.data), m).totals }));

  return (
    <>
      <PrivatHead active="kinder" title="Kinderzeit" pin={session.privatePin} sub={
        <div style={{ display: "flex", gap: 6 }}>
          <Link className="btn btn-small" href={`/privat/kinder?monat=${shiftMonth(month, -1)}`} aria-label="Voriger Monat">‹</Link>
          <span className="btn btn-small" style={{ pointerEvents: "none" }}>{monthLabel(month)}</span>
          <Link className="btn btn-small" href={`/privat/kinder?monat=${shiftMonth(month, 1)}`} aria-label="Nächster Monat">›</Link>
        </div>
      } />

      <section className="card card-pad stack">
        <h2>Wer war wie lange allein mit den Kindern unterwegs – {monthLabel(month)}</h2>
        <div className="priv-grid">
          {(["a", "b"] as const).map((k) => (
            <div key={k} data-testid={`kids-total-${k}`}>
              <div className="kpi-label"><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COLOR[k], marginRight: 6 }} />{name[k]}</div>
              <div className="kpi-value">{hoursLabel(ov.totals[k].hours)}</div>
              <div className="small muted">{ov.totals[k].count}× unterwegs</div>
            </div>
          ))}
        </div>
        {ov.shareA !== null && (
          <>
            <div className="priv-share" role="img" aria-label={`${name.a} ${ov.shareA} %, ${name.b} ${100 - ov.shareA} %`} style={{ gap: ov.shareA > 0 && ov.shareA < 100 ? 2 : 0 }}>
              <span style={{ width: `${ov.shareA}%`, background: COLOR.a }} />
              <span style={{ width: `${100 - ov.shareA}%`, background: COLOR.b }} />
            </div>
            <div className="small muted">{name.a} {ov.shareA} % · {name.b} {100 - ov.shareA} % der Stunden</div>
          </>
        )}
        <div className="small muted">Letzte Monate: {last3.map((x) => `${monthLabel(x.m).split(" ")[0].slice(0, 3)} ${name.a} ${String(x.a.hours).replace(".", ",")} h / ${name.b} ${String(x.b.hours).replace(".", ",")} h`).join(" · ")}</div>
      </section>

      <section className="card card-pad stack">
        <h2>Eintragen</h2>
        <StateForm action={addKidsAction} submit="Eintragen" testid="kids-form">
          <div className="field"><span className="label">Wer war mit den Kindern allein?</span><Choice name="person" value={me} options={[{ value: "a", label: name.a }, { value: "b", label: name.b }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="k-day">Tag</label><input className="input" id="k-day" name="day" type="date" defaultValue={today} /></div>
            <div className="field"><label className="label" htmlFor="k-from">von</label><input className="input" id="k-from" name="from" type="time" /></div>
            <div className="field"><label className="label" htmlFor="k-to">bis</label><input className="input" id="k-to" name="to" type="time" /></div>
            <div className="field"><label className="label" htmlFor="k-hours">oder Stunden</label><input className="input" id="k-hours" name="hours" inputMode="decimal" placeholder="z. B. 2,5" /></div>
          </div>
          <div className="field"><label className="label" htmlFor="k-what">Was habt ihr gemacht? (optional)</label><input className="input" id="k-what" name="what" placeholder="z. B. Spielplatz, Schwimmbad, Oma" autoComplete="off" /></div>
          {s.kids.length > 1 && <div className="field"><span className="label">Welche Kinder (optional)</span><Chips name="kids" options={s.kids} /></div>}
        </StateForm>
      </section>

      <section className="card" data-testid="kids-table">
        <div className="priv-cols">
          <div className="head">Tag</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.a, marginRight: 5 }} />{name.a}</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.b, marginRight: 5 }} />{name.b}</div>
          {ov.days.length === 0 && <div style={{ gridColumn: "1 / -1" }} className="muted">In diesem Monat noch nichts eingetragen.</div>}
          {ov.days.map((d) => [
            <div key={`${d.day}-d`} className="num">{weekday(d.day)} {dm(d.day)}</div>,
            <div key={`${d.day}-a`}><Cell list={d.a.map((e) => byId.get((e as KidsEntry & { id: string }).id)!)} /></div>,
            <div key={`${d.day}-b`}><Cell list={d.b.map((e) => byId.get((e as KidsEntry & { id: string }).id)!)} /></div>,
          ])}
          <div className="head">Summe</div>
          <div className="head">{hoursLabel(ov.totals.a.hours)} · {ov.totals.a.count}×</div>
          <div className="head">{hoursLabel(ov.totals.b.hours)} · {ov.totals.b.count}×</div>
        </div>
      </section>
    </>
  );
}
