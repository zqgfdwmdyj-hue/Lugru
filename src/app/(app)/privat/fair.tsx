import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { kidsHours, kidsOverview, nextSleeper, shiftMonth, type SleepEntry } from "@/lib/private/logic";
import type { Session } from "@/lib/auth/session";
import { loadEntries, myPartner, privateSettings, type Entry } from "@/lib/private/service";
import { deleteEntryAction, type FormState } from "./actions";
import { StateForm } from "./state-form";
import { Choice, PrivatHead, dm, hoursLabel, monthLabel, weekday, type PrivatTab } from "./ui";

/** Gleiche Farben wie bei der Kinderzeit (auf Farbsehschwäche geprüft); Name steht immer dabei. */
const COLOR = { a: "#0d9488", b: "#c2410c" } as const;

function Cell({ list, kind }: { list: Entry<SleepEntry>[]; kind: string }) {
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
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={e.id} />
            <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} aria-label="Eintrag löschen">×</button>
          </form>
        </div>
      ))}
    </div>
  );
}

export type FairConfig = {
  kind: "ausschlafen" | "auszeit";
  tab: PrivatTab;
  path: string;
  title: string;
  heading: string;
  intro?: string;
  who: string;
  nextText: (name: string) => string;
  unit: string;
  shareText: string;
  fromLabel: string;
  fromDefault?: string;
  toLabel: string;
  notePlaceholder: string;
  hint?: string;
  test: string;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
};

/** Seite „wer hatte wie viel …“ mit Ausgleich (Ausschlafen, Auszeit). */
export async function FairPage({ session, month, cfg }: { session: Session; month: string; cfg: FairConfig }) {
  const today = todayIso();
  const s = await privateSettings(session.tenantId);
  const all = await loadEntries<SleepEntry>(session, [cfg.kind]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const ov = kidsOverview(all.map((e) => ({ ...e.data, id: e.id })), month);
  const name = s.partners;
  const next = nextSleeper(all.map((e) => ({ ...e.data, at: e.createdAt.getTime() })), today.slice(0, 7));
  const last = [...all].sort((x, y) => y.data.day.localeCompare(x.data.day) || y.createdAt.getTime() - x.createdAt.getTime())[0]?.data;
  const me = myPartner(s, session);
  const last3 = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, ...kidsOverview(all.map((e) => e.data), m).totals }));
  const t = cfg.test;

  return (
    <>
      <PrivatHead active={cfg.tab} title={cfg.title} pin={session.privatePin} sub={
        <div style={{ display: "flex", gap: 6 }}>
          <Link className="btn btn-small" href={`${cfg.path}?monat=${shiftMonth(month, -1)}`} aria-label="Voriger Monat">‹</Link>
          <span className="btn btn-small" style={{ pointerEvents: "none" }}>{monthLabel(month)}</span>
          <Link className="btn btn-small" href={`${cfg.path}?monat=${shiftMonth(month, 1)}`} aria-label="Nächster Monat">›</Link>
        </div>
      } />
      {cfg.intro && <div className="small muted">{cfg.intro}</div>}

      {next && (
        <div className="notice notice-info" data-testid={`${t}-next`}>
          {cfg.nextText(name[next])}
          {last ? <span className="small muted"> – zuletzt {name[last.person]} am {weekday(last.day)} {dm(last.day)}</span> : null}
        </div>
      )}

      <section className="card card-pad stack">
        <h2>{cfg.heading} – {monthLabel(month)}</h2>
        <div className="priv-grid">
          {(["a", "b"] as const).map((k) => (
            <div key={k} data-testid={`${t}-total-${k}`}>
              <div className="kpi-label"><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COLOR[k], marginRight: 6 }} />{name[k]}</div>
              <div className="kpi-value">{ov.totals[k].count}×</div>
              <div className="small muted">{hoursLabel(ov.totals[k].hours)} {cfg.unit}</div>
            </div>
          ))}
        </div>
        {ov.shareA !== null && (
          <>
            <div className="priv-share" role="img" aria-label={`${name.a} ${ov.shareA} %, ${name.b} ${100 - ov.shareA} %`} style={{ gap: ov.shareA > 0 && ov.shareA < 100 ? 2 : 0 }}>
              <span style={{ width: `${ov.shareA}%`, background: COLOR.a }} />
              <span style={{ width: `${100 - ov.shareA}%`, background: COLOR.b }} />
            </div>
            <div className="small muted">{name.a} {ov.shareA} % · {name.b} {100 - ov.shareA} % {cfg.shareText}</div>
          </>
        )}
        <div className="small muted">Vormonate: {last3.map((x) => `${monthLabel(x.m).split(" ")[0].slice(0, 3)} ${name.a} ${x.a.count}× / ${name.b} ${x.b.count}×`).join(" · ")}</div>
      </section>

      <section className="card card-pad stack">
        <h2>Eintragen</h2>
        <StateForm action={cfg.action} submit="Eintragen" testid={`${t}-form`}>
          <div className="field"><span className="label">{cfg.who}</span><Choice name="person" value={next ?? me} options={[{ value: "a", label: name.a }, { value: "b", label: name.b }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor={`${t}-day`}>Tag</label><input className="input" id={`${t}-day`} name="day" type="date" defaultValue={today} max={today} /></div>
            <div className="field"><label className="label" htmlFor={`${t}-from`}>{cfg.fromLabel}</label><input className="input" id={`${t}-from`} name="from" type="time" defaultValue={cfg.fromDefault} /></div>
            <div className="field"><label className="label" htmlFor={`${t}-to`}>{cfg.toLabel}</label><input className="input" id={`${t}-to`} name="to" type="time" /></div>
            <div className="field"><label className="label" htmlFor={`${t}-hours`}>oder Stunden</label><input className="input" id={`${t}-hours`} name="hours" inputMode="decimal" placeholder="z. B. 2,5" /></div>
          </div>
          <div className="field"><label className="label" htmlFor={`${t}-note`}>Notiz (optional)</label><input className="input" id={`${t}-note`} name="note" autoComplete="off" placeholder={cfg.notePlaceholder} /></div>
          {cfg.hint && <div className="small muted">{cfg.hint}</div>}
        </StateForm>
      </section>

      <section className="card" data-testid={`${t}-table`}>
        <div className="priv-cols">
          <div className="head">Tag</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.a, marginRight: 5 }} />{name.a}</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.b, marginRight: 5 }} />{name.b}</div>
          {ov.days.length === 0 && <div style={{ gridColumn: "1 / -1" }} className="muted">In diesem Monat noch nichts eingetragen.</div>}
          {ov.days.map((d) => [
            <div key={`${d.day}-d`} className="num">{weekday(d.day)} {dm(d.day)}</div>,
            <div key={`${d.day}-a`}><Cell kind={cfg.kind} list={d.a.map((e) => byId.get((e as SleepEntry & { id: string }).id)!)} /></div>,
            <div key={`${d.day}-b`}><Cell kind={cfg.kind} list={d.b.map((e) => byId.get((e as SleepEntry & { id: string }).id)!)} /></div>,
          ])}
          <div className="head">Summe</div>
          <div className="head">{ov.totals.a.count}× · {hoursLabel(ov.totals.a.hours)}</div>
          <div className="head">{ov.totals.b.count}× · {hoursLabel(ov.totals.b.hours)}</div>
        </div>
      </section>
    </>
  );
}
