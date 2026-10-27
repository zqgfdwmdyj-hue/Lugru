import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { clockShiftHours, kidsHours, kidsOverview, overnight, shiftMonth, type KidsEntry, type PartnerKey } from "@/lib/private/logic";
import { loadEntries, myPartner, privateSettings, requirePrivate, type Entry } from "@/lib/private/service";
import { addKidsAction, deleteEntryAction } from "../actions";
import { StateForm } from "../state-form";
import { Chips, Choice, MonthNav, PrivatHead, clockShiftLabel, dm, hoursLabel, monthLabel, monthParam, weekday, StatusTag } from "../ui";

/** Farben je Person (geprüft auf Farbsehschwäche); Name steht immer dabei. */
const COLOR = { a: "#0d9488", b: "#c2410c" } as const;
const nn = (x: number | undefined) => (x === undefined ? "" : String(x).replace(".", ","));

function Cell({ list, month, names }: { list: Entry<KidsEntry>[]; month: string; names: Record<PartnerKey, string> }) {
  if (!list.length) return <span className="muted">–</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {list.map((e) => (
        <div key={e.id}>
          <strong>{e.data.from && e.data.to ? `${e.data.from}–${e.data.to}` : hoursLabel(kidsHours(e.data))}</strong>
          {overnight(e.data) ? <span className="muted"> (über Mitternacht)</span> : null}
          {clockShiftHours(e.data) ? <span className="muted" data-testid="clock-shift"> ({clockShiftLabel(clockShiftHours(e.data))}, {hoursLabel(kidsHours(e.data))})</span> : null}
          {e.data.what ? ` · ${e.data.what}` : ""}
          {e.data.kids?.length ? <span className="muted"> · {e.data.kids.join(", ")}</span> : null}
          {e.data.linkId ? <span className="muted" data-testid="linked"> · 🔗 zugleich Auszeit {names[e.data.person === "a" ? "b" : "a"]}</span> : null}
          {e.data.editedAt ? <span className="muted"> · geändert</span> : null}<StatusTag status={e.data.status} />
          <Link className="btn-link small" href={`/privat/eintrag/${e.id}`} style={{ marginLeft: 6 }}>ändern</Link>
          <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}>
            <input type="hidden" name="kind" value="kinder" />
            <input type="hidden" name="id" value={e.id} />
            <button className="btn-link x-danger" type="submit" aria-label="Eintrag löschen" title={e.data.linkId ? "löscht auch die verknüpfte Auszeit" : undefined}>×</button>
          </form>
        </div>
      ))}
    </div>
  );
}

export default async function KinderPage({ searchParams }: { searchParams: Promise<{ monat?: string; bearbeiten?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const month = monthParam(sp.monat);
  const s = await privateSettings(session.tenantId);
  const all = await loadEntries<KidsEntry>(session, ["kinder"]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const ov = kidsOverview(all.map((e) => ({ ...e.data, id: e.id })), month);
  const name = s.partners;
  const me = myPartner(s, session);
  const last3 = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, ...kidsOverview(all.map((e) => e.data), m).totals }));
  const edit = sp.bearbeiten ? all.find((e) => e.id === sp.bearbeiten) : undefined;
  const v = edit?.data;
  const h = (x: number) => `${String(x).replace(".", ",")} h`;

  return (
    <>
      <PrivatHead active="kinder" title="Kinderzeit" pin={session.privatePin} month={month} sub={<MonthNav path="/privat/kinder" month={month} />} />

      <section className="card card-pad stack">
        <h2>Allein mit den Kindern – erfasste Zeiten {monthLabel(month)}</h2>
        <div className="priv-grid">
          {(["a", "b"] as const).map((k) => (
            <div key={k} data-testid={`kids-total-${k}`}>
              <div className="kpi-label"><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COLOR[k], marginRight: 6 }} />{name[k]}</div>
              {ov.totals[k].count ? (
                <>
                  <div className="kpi-value">{hoursLabel(ov.totals[k].hours)}</div>
                  <div className="small muted">{ov.totals[k].count}× erfasst</div>
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
          <div className="small muted" data-testid="share-incomplete">Kein Anteil berechnet – für {ov.totals.a.count ? name.b : name.a} ist in diesem Monat nichts erfasst.</div>
        )}
        {ov.shareA !== null && ov.totals.a.count > 0 && ov.totals.b.count > 0 && (
          <>
            <div className="priv-share" role="img" aria-label={`Anteil an den erfassten Stunden: ${name.a} ${ov.shareA} %, ${name.b} ${100 - ov.shareA} %`} style={{ gap: ov.shareA > 0 && ov.shareA < 100 ? 2 : 0 }}>
              <span style={{ width: `${ov.shareA}%`, background: COLOR.a }} />
              <span style={{ width: `${100 - ov.shareA}%`, background: COLOR.b }} />
            </div>
            <div className="small muted">Anteil an den erfassten Stunden: {name.a} {ov.shareA} % · {name.b} {100 - ov.shareA} % – nur was eingetragen ist, keine Bewertung.</div>
          </>
        )}
        <div className="small muted">Vormonate: {last3.map((x) => `${monthLabel(x.m).split(" ")[0].slice(0, 3)} ${x.a.count + x.b.count ? `${name.a} ${x.a.count ? h(x.a.hours) : "nicht erfasst"} / ${name.b} ${x.b.count ? h(x.b.hours) : "nicht erfasst"}` : "nicht erfasst"}`).join(" · ")}</div>
      </section>

      <section className="card card-pad stack" id="eintragen">
        <h2>{edit ? "Eintrag ändern" : "Eintragen"}</h2>
        <StateForm key={edit?.id ?? "neu"} action={addKidsAction} submit={edit ? "Änderung speichern" : "Eintragen"} testid="kids-form" keep={Boolean(edit)}>
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div className="field"><span className="label">Wer war mit den Kindern allein?</span><Choice name="person" value={v?.person ?? me ?? undefined} options={[{ value: "a", label: name.a }, { value: "b", label: name.b }]} /></div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="k-day">Tag (Beginn)</label><input className="input" id="k-day" name="day" type="date" defaultValue={v?.day ?? today} max={today} /></div>
            <div className="field"><label className="label" htmlFor="k-from">von</label><input className="input" id="k-from" name="from" type="time" defaultValue={v?.from ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="k-to">bis</label><input className="input" id="k-to" name="to" type="time" defaultValue={v?.to ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="k-hours">oder Stunden</label><input className="input" id="k-hours" name="hours" inputMode="decimal" placeholder="z. B. 2,5" defaultValue={v?.from ? "" : nn(v?.hours)} /></div>
          </div>
          <details open={Boolean(v?.what || v?.kids?.length)}>
            <summary className="small" style={{ cursor: "pointer" }}>Mehr Angaben (optional)</summary>
            <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              <div className="field"><label className="label" htmlFor="k-what">Was habt ihr gemacht?</label><input className="input" id="k-what" name="what" placeholder="z. B. Spielplatz, Schwimmbad, Oma" autoComplete="off" defaultValue={v?.what ?? ""} /></div>
              {s.kids.length > 1 && <div className="field"><span className="label">Welche Kinder</span><Chips name="kids" options={s.kids} values={v?.kids} /></div>}
              {!edit && (
                <label className="check small" data-testid="link-timeout">
                  <input type="checkbox" name="linkAuszeit" /> Währenddessen hatte der/die andere Auszeit – auch als Auszeit eintragen (ein Vorgang, zählt je Sicht einmal)
                </label>
              )}
            </div>
          </details>
          <div className="small muted">Über Mitternacht? Einfach z. B. 22:00–02:00 – zählt am Tag des Beginns. von–bis und abweichende Stunden zugleich werden nicht still übernommen, sondern nachgefragt.</div>
          {edit && <Link className="small" href={`/privat/kinder?monat=${month}`}>fertig / abbrechen</Link>}
        </StateForm>
      </section>

      <section className="card" data-testid="kids-table">
        <div className="priv-cols">
          <div className="head">Tag</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.a, marginRight: 5 }} />{name.a}</div>
          <div className="head"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: COLOR.b, marginRight: 5 }} />{name.b}</div>
          {ov.days.length === 0 && <div style={{ gridColumn: "1 / -1" }} className="muted">In diesem Monat nichts erfasst.</div>}
          {ov.days.map((d) => [
            <div key={`${d.day}-d`} className="num">{weekday(d.day)} {dm(d.day)}</div>,
            <div key={`${d.day}-a`}><Cell month={month} names={name} list={d.a.map((e) => byId.get((e as KidsEntry & { id: string }).id)!)} /></div>,
            <div key={`${d.day}-b`}><Cell month={month} names={name} list={d.b.map((e) => byId.get((e as KidsEntry & { id: string }).id)!)} /></div>,
          ])}
          <div className="head">Summe</div>
          <div className="head">{ov.totals.a.count ? `${hoursLabel(ov.totals.a.hours)} · ${ov.totals.a.count}×` : "nicht erfasst"}</div>
          <div className="head">{ov.totals.b.count ? `${hoursLabel(ov.totals.b.hours)} · ${ov.totals.b.count}×` : "nicht erfasst"}</div>
        </div>
      </section>
    </>
  );
}
