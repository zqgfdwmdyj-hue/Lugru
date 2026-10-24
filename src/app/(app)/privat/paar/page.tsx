import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { intimStats, isDay, monthGrid, shiftMonth, type IntimEntry, type TalkEntry } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { addIntimAction, addTalkAction, deleteEntryAction } from "../actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead, Rating, dmy, monthLabel, weekday } from "../ui";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default async function PaarPage({ searchParams }: { searchParams: Promise<{ monat?: string; tag?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const month = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : today.slice(0, 7);
  const selected = isDay(sp.tag) ? sp.tag! : today;
  const s = await privateSettings(session.tenantId);
  const intim = await loadEntries<IntimEntry>(session, ["intim"]);
  const talks = (await loadEntries<TalkEntry>(session, ["gespraech"])).sort((a, b) => b.data.day.localeCompare(a.data.day));
  const stats = intimStats(intim.map((e) => e.data), month, today);
  const byDay = new Map<string, typeof intim>();
  for (const e of intim) byDay.set(e.data.day, [...(byDay.get(e.data.day) ?? []), e]);
  const dayList = (byDay.get(selected) ?? []).sort((a, b) => (a.data.time ?? "").localeCompare(b.data.time ?? ""));
  const href = (m: string, d?: string) => `/privat/paar?monat=${m}${d ? `&tag=${d}` : ""}#kalender`;
  const who = (k?: string) => (k === "a" ? s.partners.a : k === "b" ? s.partners.b : k === "beide" ? "beide" : null);
  const prevMonths = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, n: intim.filter((e) => e.data.day.startsWith(m)).length }));

  return (
    <>
      <PrivatHead active="paar" title="Paar" pin={session.privatePin} />

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">{monthLabel(month)}</div><div className="kpi-value" data-testid="intim-month">{stats.inMonth}×</div><div className="small muted">{prevMonths.map((p) => `${monthLabel(p.m).split(" ")[0].slice(0, 3)} ${p.n}×`).join(" · ")}</div></div>
        <div className="card card-pad"><div className="kpi-label">Zuletzt</div><div className="kpi-value">{stats.daysSinceLast === null ? "–" : stats.daysSinceLast === 0 ? "heute" : `vor ${stats.daysSinceLast} T.`}</div><div className="small muted">{stats.last ? dmy(stats.last) : "noch nichts eingetragen"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Ø Abstand (90 Tage)</div><div className="kpi-value">{stats.avgGapDays === null ? "–" : `${String(stats.avgGapDays).replace(".", ",")} T.`}</div><div className="small muted">{stats.last90}× in 90 Tagen</div></div>
      </div>

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
              const cls = ["cal-day", d.startsWith(month) ? "" : "cal-out", d === today ? "cal-today" : "", d === selected ? "cal-sel" : ""].filter(Boolean).join(" ");
              return (
                <Link key={d} href={href(month, d)} className={cls} scroll={false} aria-label={`${dmy(d)}${n ? `, ${n}× eingetragen` : ""}`}>
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  {n > 0 && <span className="priv-heart" aria-hidden="true">❤️{n > 1 ? <small> {n}</small> : null}</span>}
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="col-side stack">
          <section className="card card-pad stack">
            <h2>{weekday(selected)}, {dmy(selected)}</h2>
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
                      <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>löschen</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <StateForm action={addIntimAction} submit="Eintragen" testid="intim-form">
              <div className="priv-grid">
                <div className="field"><label className="label" htmlFor="i-day">Tag</label><input className="input" id="i-day" name="day" type="date" defaultValue={selected <= today ? selected : today} max={today} /></div>
                <div className="field"><label className="label" htmlFor="i-time">Uhrzeit (optional)</label><input className="input" id="i-time" name="time" type="time" /></div>
              </div>
              <div className="field"><span className="label">Initiative (optional)</span><Choice name="initiative" options={[{ value: "a", label: s.partners.a }, { value: "b", label: s.partners.b }, { value: "beide", label: "beide" }]} /></div>
              <Rating name="closeness" label="Wie nah habt ihr euch gefühlt? (optional)" low="wenig" high="sehr" />
              <div className="field"><label className="label" htmlFor="i-note">Notiz (optional)</label><input className="input" id="i-note" name="note" autoComplete="off" /></div>
            </StateForm>
          </section>
        </aside>
      </div>

      <section className="card card-pad stack" id="gespraech">
        <h2>Paar-Gespräch der Woche</h2>
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>So geht’s (nach Gottman: „State of the Union“)</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>Einmal pro Woche etwa eine Stunde, ruhiger Ort, Handys weg, jeder mit Zettel und Stift.</li>
            <li>Start: Jeder nennt fünf Dinge, die er in der Woche am anderen geschätzt hat – der andere sagt einfach „danke“.</li>
            <li>Dann ein Thema. Abwechselnd: einer erzählt (Ich-Botschaften), der andere hört nur zu und fasst zusammen.</li>
            <li>Erst wenn beide sagen „Ja, genau so fühle ich mich“, gemeinsam nach Lösungen schauen.</li>
          </ul>
        </details>
        <StateForm action={addTalkAction} submit="Gespräch speichern" testid="talk-form">
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="t-day">Tag</label><input className="input" id="t-day" name="day" type="date" defaultValue={today} max={today} /></div>
          </div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="t-a">{s.partners.a} schätzt an {s.partners.b}</label><textarea className="input" id="t-a" name="appreciationsA" rows={3} /></div>
            <div className="field"><label className="label" htmlFor="t-b">{s.partners.b} schätzt an {s.partners.a}</label><textarea className="input" id="t-b" name="appreciationsB" rows={3} /></div>
          </div>
          <div className="field"><label className="label" htmlFor="t-topic">Thema</label><input className="input" id="t-topic" name="topic" /></div>
          <div className="field"><label className="label" htmlFor="t-agreed">Was wir mitnehmen / vereinbaren</label><textarea className="input" id="t-agreed" name="agreed" rows={2} /></div>
        </StateForm>
        {talks.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {talks.slice(0, 12).map((t) => (
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
