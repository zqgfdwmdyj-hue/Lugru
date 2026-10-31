import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays, clockChangeOn, clockShiftHours, kidsHours, kidsOverview, lastTaken, nextSleeper, overnight, shiftMonth, upcomingClockChange, type PartnerKey, type SleepEntry } from "@/lib/private/logic";
import type { Session } from "@/lib/auth/session";
import { loadEntries, myPartner, privateSettings, type Entry } from "@/lib/private/service";
import { deleteEntryAction, type FormState } from "./actions";
import { StateForm } from "./state-form";
import { Choice, MonthNav, PrivatHead, clockShiftLabel, dm, hoursLabel, monthLabel, weekday, type PrivatTab, StatusTag } from "./ui";

/** Gleiche Farben wie bei der Kinderzeit (auf Farbsehschwäche geprüft); Name steht immer dabei. */
const COLOR = { a: "#0d9488", b: "#c2410c" } as const;

function Cell({ list, kind, path, month, names }: { list: Entry<SleepEntry>[]; kind: string; path: string; month: string; names: Record<PartnerKey, string> }) {
  if (!list.length) return <span className="muted">–</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {list.map((e) => (
        <div key={e.id}>
          <strong>{e.data.from && e.data.to ? `${e.data.from}–${e.data.to}` : ""}</strong>
          {e.data.from && e.data.to ? " · " : ""}
          {hoursLabel(kidsHours(e.data))}
          {overnight(e.data) ? <span className="muted"> (über Mitternacht)</span> : null}
          {clockShiftHours(e.data) ? <span className="muted" data-testid="clock-shift"> ({clockShiftLabel(clockShiftHours(e.data))})</span> : null}
          {e.data.note ? <span className="muted"> · {e.data.note}</span> : null}
          {e.data.linkId ? <span className="muted" data-testid="linked"> · 🔗 zugleich Kinderzeit {names[e.data.person === "a" ? "b" : "a"]}</span> : null}
          {e.data.editedAt ? <span className="muted"> · geändert</span> : null}<StatusTag status={e.data.status} />
          <Link className="btn-link small" href={`/privat/eintrag/${e.id}`} style={{ marginLeft: 6 }}>ändern</Link>
          <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={e.id} />
            <button className="btn-link x-danger" type="submit" aria-label="Eintrag löschen" title={e.data.linkId ? "löscht auch die verknüpfte Kinderzeit" : undefined}>×</button>
          </form>
        </div>
      ))}
    </div>
  );
}

/**
 * Hinweis rund um die Zeitumstellung (ab einer Woche vorher bis zum Tag danach): Die Nacht ist für alle eine Stunde
 * länger bzw. kürzer. Gezählt wird nach der Uhr ab der üblichen Aufstehzeit – die Stunde der Umstellung bekommt
 * oder verliert also niemand allein; wer nach „alter“ Zeit geweckt wurde, setzt „sonst auf um“ entsprechend.
 */
function ClockChangeHint({ today }: { today: string }) {
  const cc = upcomingClockChange(addDays(today, -1), 8);
  if (!cc) return null;
  const past = today >= cc.day;
  const back = cc.change > 0;
  return (
    <div className="notice notice-info small" data-testid="clock-change">
      <strong>🕑 Zeitumstellung in der Nacht zu {weekday(cc.day)} {dm(cc.day)}:</strong>{" "}
      Die Uhr {past ? "wurde" : "wird"} {back ? "von 3 auf 2 Uhr zurückgestellt – die Nacht ist für alle eine Stunde länger" : "von 2 auf 3 Uhr vorgestellt – die Nacht ist für alle eine Stunde kürzer"}.
      {" "}Uhrzeiten nach der neuen Uhr eintragen. Gezählt wird nur die Zeit nach der üblichen Aufstehzeit – die {back ? "geschenkte" : "fehlende"} Stunde
      {back ? " zählt bei niemandem als Ausschlafen" : " wird niemandem abgezogen"}.
      {back ? " Sind die Kinder nach alter Zeit wach geworden (z. B. 5:30 statt 6:30), „sonst auf um“ entsprechend früher setzen." : " Sind die Kinder nach alter Zeit wach geworden (z. B. 7:30 statt 6:30), „sonst auf um“ entsprechend später setzen."}
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

/** Seite „wer hatte wie viel …“ (Ausschlafen, Auszeit): erfasste Zeiten, neutral dargestellt. */
export async function FairPage({ session, month, cfg, editId }: { session: Session; month: string; cfg: FairConfig; editId?: string }) {
  const today = todayIso();
  const s = await privateSettings(session.tenantId);
  const all = await loadEntries<SleepEntry>(session, [cfg.kind]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const ov = kidsOverview(all.map((e) => ({ ...e.data, id: e.id })), month);
  const name = s.partners;
  // „zuletzt“ und Wechsel nur aus Stattgefundenem bis heute – nie aus geplanten oder künftigen Einträgen.
  const timeline = all.map((e) => ({ ...e.data, at: e.createdAt.getTime() }));
  const next = nextSleeper(timeline, today);
  const last = lastTaken(timeline, today);
  const me = myPartner(s, session);
  const last3 = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, ...kidsOverview(all.map((e) => e.data), m).totals }));
  const t = cfg.test;
  const edit = editId ? all.find((e) => e.id === editId) : undefined;
  const v = edit?.data;
  const nn = (x: number | undefined) => (x === undefined ? "" : String(x).replace(".", ","));
  const recorded = ov.totals.a.count + ov.totals.b.count;

  return (
    <>
      <PrivatHead active={cfg.tab} title={cfg.title} pin={session.privatePin} month={month} sub={<MonthNav path={cfg.path} month={month} />} />
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
              {ov.totals[k].count ? (
                <>
                  <div className="kpi-value">{ov.totals[k].count}×</div>
                  <div className="small muted">{hoursLabel(ov.totals[k].hours)} {cfg.unit}</div>
                </>
              ) : (
                <>
                  <div className="kpi-value muted" style={{ fontSize: 18 }} data-testid="not-recorded">nicht erfasst</div>
                  <div className="small muted">keine Einträge in diesem Monat</div>
                </>
              )}
            </div>
          ))}
        </div>
        {ov.shareA !== null && (ov.totals.a.count === 0 || ov.totals.b.count === 0) && (
          <div className="small muted" data-testid="share-incomplete">Kein Anteil berechnet – für {ov.totals.a.count ? name.b : name.a} ist in diesem Monat nichts erfasst. Ein Vergleich wäre aus fehlenden Einträgen geraten.</div>
        )}
        {ov.shareA !== null && ov.totals.a.count > 0 && ov.totals.b.count > 0 && (
          <>
            <div className="priv-share" role="img" aria-label={`${name.a} ${ov.shareA} %, ${name.b} ${100 - ov.shareA} %`} style={{ gap: ov.shareA > 0 && ov.shareA < 100 ? 2 : 0 }}>
              <span style={{ width: `${ov.shareA}%`, background: COLOR.a }} />
              <span style={{ width: `${100 - ov.shareA}%`, background: COLOR.b }} />
            </div>
            <div className="small muted">{name.a} {ov.shareA} % · {name.b} {100 - ov.shareA} % {cfg.shareText}</div>
          </>
        )}
        <div className="small muted">Vormonate: {last3.map((x) => `${monthLabel(x.m).split(" ")[0].slice(0, 3)} ${x.a.count + x.b.count ? `${name.a} ${x.a.count ? `${x.a.count}×` : "nicht erfasst"} / ${name.b} ${x.b.count ? `${x.b.count}×` : "nicht erfasst"}` : "nicht erfasst"}`).join(" · ")}</div>
        {recorded > 0 && <div className="small muted">Nur erfasste Zeiten – sie sagen nichts darüber, wer mehr leistet oder braucht.</div>}
      </section>

      <section className="card card-pad stack" id="eintragen">
        <h2>{edit ? "Eintrag ändern" : "Eintragen"}</h2>
        <StateForm key={edit?.id ?? "neu"} action={cfg.action} submit={edit ? "Änderung speichern" : "Eintragen"} testid={`${t}-form`} keep={Boolean(edit)}>
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div className="field"><span className="label">{cfg.who}</span><Choice name="person" value={v?.person ?? next ?? me ?? undefined} options={[{ value: "a", label: name.a }, { value: "b", label: name.b }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor={`${t}-day`}>Tag</label><input className="input" id={`${t}-day`} name="day" type="date" defaultValue={v?.day ?? today} max={today} /></div>
            <div className="field"><label className="label" htmlFor={`${t}-from`}>{cfg.fromLabel}</label><input className="input" id={`${t}-from`} name="from" type="time" defaultValue={v ? v.from ?? "" : cfg.fromDefault} /></div>
            <div className="field"><label className="label" htmlFor={`${t}-to`}>{cfg.toLabel}</label><input className="input" id={`${t}-to`} name="to" type="time" defaultValue={v?.to ?? ""} /></div>
            <div className="field"><label className="label" htmlFor={`${t}-hours`}>oder Stunden</label><input className="input" id={`${t}-hours`} name="hours" inputMode="decimal" placeholder="z. B. 2,5" defaultValue={v?.from ? "" : nn(v?.hours)} /></div>
          </div>
          <details open={Boolean(v?.note)}>
            <summary className="small" style={{ cursor: "pointer" }}>Mehr Angaben (optional)</summary>
            <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              <div className="field"><label className="label" htmlFor={`${t}-note`}>Notiz</label><input className="input" id={`${t}-note`} name="note" autoComplete="off" placeholder={cfg.notePlaceholder} defaultValue={v?.note ?? ""} /></div>
              {cfg.kind === "auszeit" && !edit && (
                <label className="check small" data-testid="link-kids">
                  <input type="checkbox" name="linkKinder" /> Währenddessen war der/die andere allein mit den Kindern – auch als Kinderzeit eintragen (ein Vorgang, zählt je Sicht einmal)
                </label>
              )}
            </div>
          </details>
          {cfg.hint && <div className="small muted">{cfg.hint}</div>}
          {cfg.kind === "ausschlafen" && <ClockChangeHint today={today} />}
          {edit && <Link className="small" href={`${cfg.path}?monat=${month}`}>fertig / abbrechen</Link>}
        </StateForm>
      </section>

      <section className="card" data-testid={`${t}-table`}>
        <div className="priv-cols">
          <div className="head">Tag</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.a, marginRight: 5 }} />{name.a}</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.b, marginRight: 5 }} />{name.b}</div>
          {ov.days.length === 0 && <div style={{ gridColumn: "1 / -1" }} className="muted">In diesem Monat nichts erfasst.</div>}
          {ov.days.map((d) => [
            <div key={`${d.day}-d`} className="num">{weekday(d.day)} {dm(d.day)}{clockChangeOn(d.day) ? <div className="small muted" data-testid="clock-night">Zeitumstellung ({clockChangeOn(d.day) > 0 ? "Nacht 1 Std. länger" : "Nacht 1 Std. kürzer"})</div> : null}</div>,
            <div key={`${d.day}-a`}><Cell kind={cfg.kind} path={cfg.path} month={month} names={name} list={d.a.map((e) => byId.get((e as SleepEntry & { id: string }).id)!)} /></div>,
            <div key={`${d.day}-b`}><Cell kind={cfg.kind} path={cfg.path} month={month} names={name} list={d.b.map((e) => byId.get((e as SleepEntry & { id: string }).id)!)} /></div>,
          ])}
          <div className="head">Summe</div>
          <div className="head">{ov.totals.a.count ? `${ov.totals.a.count}× · ${hoursLabel(ov.totals.a.hours)}` : "nicht erfasst"}</div>
          <div className="head">{ov.totals.b.count ? `${ov.totals.b.count}× · ${hoursLabel(ov.totals.b.hours)}` : "nicht erfasst"}</div>
        </div>
      </section>
    </>
  );
}
