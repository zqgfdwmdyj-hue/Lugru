import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { intimStats, isDay, monthGrid, shiftMonth, type DateEntry, type IntimEntry } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { addIntimAction, deleteEntryAction } from "../actions";
import { AddPanel } from "../add-panel";
import { StateForm } from "../state-form";
import { Choice, Counted, PrivatHead, Rating, dmy, monthLabel, monthParam, weekday } from "../ui";
import { HashRedirect } from "./hash-redirect";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Partnerschaft → Nähe: Kalender, Tag mit Einträgen, ein klarer Knopf zum Eintragen. */
export default async function PaarPage({ searchParams }: { searchParams: Promise<{ monat?: string; tag?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const today = todayIso();
  const month = monthParam(sp.monat);
  const selected = isDay(sp.tag) ? sp.tag! : today;
  const s = await privateSettings(session.tenantId);
  const [intim, dates] = await Promise.all([loadEntries<IntimEntry>(session, ["intim"]), loadEntries<DateEntry>(session, ["paarzeit"])]);
  const stats = intimStats(intim.map((e) => e.data), month, today);
  const byDay = new Map<string, typeof intim>();
  for (const e of intim) byDay.set(e.data.day, [...(byDay.get(e.data.day) ?? []), e]);
  const datesByDay = new Map<string, number>();
  for (const e of dates) datesByDay.set(e.data.day, (datesByDay.get(e.data.day) ?? 0) + 1);
  const dayList = (byDay.get(selected) ?? []).sort((a, b) => (a.data.time ?? "").localeCompare(b.data.time ?? ""));
  const href = (m: string, d?: string) => `/privat/paar?monat=${m}${d ? `&tag=${d}` : ""}#kalender`;
  const who = (k?: string) => (k === "a" ? s.partners.a : k === "b" ? s.partners.b : k === "beide" ? "beide" : null);
  const prevMonths = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, n: intim.filter((e) => e.data.day.startsWith(m)).length }));

  return (
    <>
      <HashRedirect />
      <PrivatHead active="paar" title="Nähe" pin={session.privatePin} month={month} />

      <div className="grid-kpi">
        <div className="card card-pad">
          <div className="kpi-label">{monthLabel(month)}</div>
          <div className="kpi-value" data-testid="intim-month"><Counted count={stats.inMonth}>{stats.inMonth}×</Counted></div>
          <div className="small muted">{prevMonths.map((p) => `${monthLabel(p.m).split(" ")[0].slice(0, 3)} ${p.n ? `${p.n}×` : "–"}`).join(" · ")}</div>
        </div>
        <div className="card card-pad"><div className="kpi-label">Zuletzt eingetragen</div><div className="kpi-value">{stats.daysSinceLast === null ? "–" : stats.daysSinceLast === 0 ? "heute" : `vor ${stats.daysSinceLast} T.`}</div><div className="small muted">{stats.last ? dmy(stats.last) : "noch nichts eingetragen"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Ø Abstand (90 Tage)</div><div className="kpi-value">{stats.avgGapDays === null ? "–" : `${String(stats.avgGapDays).replace(".", ",")} T.`}</div><div className="small muted">{stats.last90 ? `${stats.last90}× in 90 Tagen eingetragen` : "nicht erfasst"}</div></div>
      </div>
      <div className="small muted">Gezählt wird, was eingetragen ist – nicht Eingetragenes ist „nicht erfasst“, nicht „null“.</div>

      <div className="row" style={{ alignItems: "flex-start" }} id="kalender">
        <section className="card cal-card priv-cal" style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="cal-title">
            <h2>{monthLabel(month)}</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <Link className="btn btn-small" href={href(shiftMonth(month, -1))} aria-label="Voriger Monat">‹</Link>
              <Link className="btn btn-small" href={href(today.slice(0, 7), today)}>Heute</Link>
              <Link className="btn btn-small" href={href(shiftMonth(month, 1))} aria-label="Nächster Monat">›</Link>
            </div>
          </div>
          <div className="cal-grid" data-testid="intim-cal">
            {WEEKDAYS.map((w) => <div key={w} className="cal-wd">{w}</div>)}
            {monthGrid(month).map((d) => {
              const n = byDay.get(d)?.length ?? 0;
              const dn = datesByDay.get(d) ?? 0;
              const cls = ["cal-day", d.startsWith(month) ? "" : "cal-out", d === today ? "cal-today" : "", d === selected ? "cal-sel" : ""].filter(Boolean).join(" ");
              return (
                <Link key={d} href={href(month, d)} className={cls} scroll={false} aria-label={`${dmy(d)}${n ? `, ${n}× Nähe` : ""}${dn ? `, ${dn}× Paarzeit` : ""}`}>
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  {(n > 0 || dn > 0) && (
                    <span className="priv-heart" aria-hidden="true">
                      {n > 0 && <>❤️{n > 1 ? <small>{n}</small> : null}</>}
                      {dn > 0 && <span data-testid="date-mark">🥂</span>}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="col-side stack">
          <section className="card card-pad stack">
            <h2>{weekday(selected)}, {dmy(selected)}</h2>
            {(datesByDay.get(selected) ?? 0) > 0 && <Link className="small" href={`/privat/paar/paarzeit?monat=${selected.slice(0, 7)}`}>🥂 Paarzeit an diesem Tag →</Link>}
            {dayList.length === 0 ? <div className="small muted">Nichts eingetragen.</div> : (
              <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="intim-day">
                {dayList.map((e) => (
                  <li key={e.id} className="small">
                    {e.data.time ? `${e.data.time} · ` : ""}
                    {who(e.data.initiative) ? `Initiative: ${who(e.data.initiative)} · ` : ""}
                    {e.data.closeness ? `Nähe ${e.data.closeness}/5` : ""}
                    {e.data.note && <div className="muted">{e.data.note}</div>}
                    <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 8 }}>
                      <input type="hidden" name="kind" value="intim" />
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn-link small danger" type="submit">löschen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AddPanel label="Nähe eintragen" testid="intim-add">
              <StateForm action={addIntimAction} submit="Eintragen" testid="intim-form">
                <div className="priv-grid">
                  <div className="field"><label className="label" htmlFor="i-day">Tag</label><input className="input" id="i-day" name="day" type="date" defaultValue={selected <= today ? selected : today} max={today} /></div>
                  <div className="field"><label className="label" htmlFor="i-time">Uhrzeit (optional)</label><input className="input" id="i-time" name="time" type="time" /></div>
                </div>
                <details>
                  <summary className="small" style={{ cursor: "pointer" }}>Mehr Angaben (optional)</summary>
                  <div className="stack" style={{ gap: 10, marginTop: 8 }}>
                    <div className="field"><span className="label">Initiative</span><Choice name="initiative" options={[{ value: "a", label: s.partners.a }, { value: "b", label: s.partners.b }, { value: "beide", label: "beide" }]} /></div>
                    <Rating name="closeness" label="Wie nah habt ihr euch gefühlt?" low="wenig" high="sehr" />
                    <div className="field"><label className="label" htmlFor="i-note">Notiz</label><input className="input" id="i-note" name="note" autoComplete="off" /></div>
                  </div>
                </details>
              </StateForm>
            </AddPanel>
          </section>
        </aside>
      </div>
    </>
  );
}
