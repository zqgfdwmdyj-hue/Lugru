import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { avgOf, dateReminder, dateStats, intimStats, isDay, kidsHours, monthGrid, moodSeries, shiftMonth, thanksSince, type DateEntry, type DateIdea, type IntimEntry, type MoodEntry, type TalkEntry, type ThanksEntry } from "@/lib/private/logic";
import { loadEntries, myPartner, privateSettings, requirePrivate } from "@/lib/private/service";
import { addDateAction, addIdeaAction, addIntimAction, addTalkAction, addThanksAction, deleteEntryAction, saveMoodAction, toggleIdeaAction } from "../actions";
import { StateForm } from "../state-form";
import { Choice, PrivatHead, Rating, dm, dmy, hoursLabel, monthLabel, weekday } from "../ui";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default async function PaarPage({ searchParams }: { searchParams: Promise<{ monat?: string; tag?: string }> }) {
  const session = await requirePrivate({ full: true });
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
  const dates = (await loadEntries<DateEntry>(session, ["paarzeit"])).sort((a, b) => b.data.day.localeCompare(a.data.day) || (b.data.from ?? "").localeCompare(a.data.from ?? ""));
  const ds = dateStats(dates.map((e) => e.data), month, today);
  const datesByDay = new Map<string, typeof dates>();
  for (const e of dates) datesByDay.set(e.data.day, [...(datesByDay.get(e.data.day) ?? []), e]);
  const dayDates = datesByDay.get(selected) ?? [];
  const sitters = [...new Set(["Babysitterin", "Oma", "Opa", ...dates.map((e) => e.data.sitter).filter((x): x is string => Boolean(x))])];
  const prevDates = [1, 2, 3].map((i) => shiftMonth(month, -i)).map((m) => ({ m, n: dates.filter((e) => e.data.day.startsWith(m)).length }));
  const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
  const me = myPartner(s, session);
  const thanks = (await loadEntries<ThanksEntry>(session, ["danke"])).sort((a, b) => b.data.day.localeCompare(a.data.day) || b.createdAt.getTime() - a.createdAt.getTime());
  const lastTalk = talks[0]?.data.day ?? null;
  const pending = thanksSince(thanks.map((e) => e.data), lastTalk);
  const moods = await loadEntries<MoodEntry>(session, ["stimmung"]);
  const myMood = moods.find((e) => e.userId === session.userId && e.data.day === today)?.data;
  const moodToday = { a: moods.find((e) => e.data.person === "a" && e.data.day === today)?.data.value, b: moods.find((e) => e.data.person === "b" && e.data.day === today)?.data.value };
  const ideas = (await loadEntries<DateIdea>(session, ["dateidee"])).sort((a, b) => Number(a.data.done ?? false) - Number(b.data.done ?? false) || b.createdAt.getTime() - a.createdAt.getTime());
  const remind = dateReminder(ds.last, today, s.dateReminderDays);
  const dateLine = (d: DateEntry) =>
    [d.from && d.to ? `${d.from}–${d.to}` : kidsHours(d) ? hoursLabel(kidsHours(d)) : "", d.what, d.sitter ? `Kinder bei ${d.sitter}` : "", d.costEur ? euro(d.costEur) : "", d.rating ? `${d.rating}/5` : ""].filter(Boolean).join(" · ");

  return (
    <>
      <PrivatHead active="paar" title="Paar" pin={session.privatePin} />
      <nav className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap" }} aria-label="Abschnitte">
        <a href="#kalender">Kalender</a><a href="#paarzeit">🥂 Paarzeit</a><a href="#danke">💛 Wertschätzung</a><a href="#stimmung">Wie geht’s uns?</a><a href="#gespraech">Paar-Gespräch</a>
      </nav>

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">{monthLabel(month)}</div><div className="kpi-value" data-testid="intim-month">{stats.inMonth}×</div><div className="small muted">{prevMonths.map((p) => `${monthLabel(p.m).split(" ")[0].slice(0, 3)} ${p.n}×`).join(" · ")}</div></div>
        <div className="card card-pad"><div className="kpi-label">Zuletzt</div><div className="kpi-value">{stats.daysSinceLast === null ? "–" : stats.daysSinceLast === 0 ? "heute" : `vor ${stats.daysSinceLast} T.`}</div><div className="small muted">{stats.last ? dmy(stats.last) : "noch nichts eingetragen"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Ø Abstand (90 Tage)</div><div className="kpi-value">{stats.avgGapDays === null ? "–" : `${String(stats.avgGapDays).replace(".", ",")} T.`}</div><div className="small muted">{stats.last90}× in 90 Tagen</div></div>
        <a href="#paarzeit" className="card card-pad" style={{ color: "inherit", textDecoration: "none" }}><div className="kpi-label">🥂 Paarzeit {monthLabel(month).split(" ")[0]}</div><div className="kpi-value" data-testid="date-month">{ds.inMonth}×</div><div className="small muted">{ds.daysSinceLast === null ? "noch kein Date eingetragen" : ds.daysSinceLast === 0 ? "zuletzt heute" : `zuletzt vor ${ds.daysSinceLast} Tagen`}</div></a>
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
              const dn = datesByDay.get(d)?.length ?? 0;
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
            {dayDates.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {dayDates.map((e) => <li key={e.id} className="small">🥂 Paarzeit {dateLine(e.data)}</li>)}
              </ul>
            )}
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

      <section className="card card-pad stack" id="paarzeit">
        <h2>🥂 Paarzeit – zu zweit unterwegs</h2>
        <div className="small muted">Dates und Zeit nur für euch beide, während die Kinder bei der Babysitterin, Oma &amp; Co. sind.</div>
        {remind !== null && <div className="notice notice-info small" data-testid="date-remind">Euer letztes Date ist {remind} Tage her – Zeit, das nächste zu planen? Ideen stehen unten.</div>}
        <div className="priv-grid" data-testid="date-stats">
          <div><div className="kpi-label">{monthLabel(month)}</div><strong>{ds.inMonth}×</strong>{ds.hoursInMonth ? ` · ${hoursLabel(ds.hoursInMonth)}` : ""}</div>
          <div><div className="kpi-label">Vormonate</div>{prevDates.map((p) => `${monthLabel(p.m).split(" ")[0].slice(0, 3)} ${p.n}×`).join(" · ")}</div>
          <div><div className="kpi-label">Ø Abstand (90 Tage)</div><strong>{ds.avgGapDays === null ? "–" : `${String(ds.avgGapDays).replace(".", ",")} Tage`}</strong> · {ds.last90}× in 90 Tagen</div>
          {ds.costInMonth > 0 && <div><div className="kpi-label">Babysitter {monthLabel(month).split(" ")[0]}</div><strong>{euro(ds.costInMonth)}</strong></div>}
          {ds.costInYear > 0 && <div><div className="kpi-label">Babysitter {month.slice(0, 4)}</div><strong data-testid="date-cost-year">{euro(ds.costInYear)}</strong></div>}
        </div>
        <StateForm action={addDateAction} submit="Paarzeit eintragen" testid="date-form">
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="pz-day">Tag</label><input className="input" id="pz-day" name="day" type="date" defaultValue={selected <= today ? selected : today} max={today} /></div>
            <div className="field"><label className="label" htmlFor="pz-from">von</label><input className="input" id="pz-from" name="from" type="time" /></div>
            <div className="field"><label className="label" htmlFor="pz-to">bis</label><input className="input" id="pz-to" name="to" type="time" /></div>
            <div className="field"><label className="label" htmlFor="pz-hours">oder Stunden</label><input className="input" id="pz-hours" name="hours" inputMode="decimal" placeholder="z. B. 3" /></div>
          </div>
          <div className="priv-grid">
            <div className="field"><label className="label" htmlFor="pz-what">Was habt ihr gemacht?</label><input className="input" id="pz-what" name="what" autoComplete="off" placeholder="z. B. Essen gehen, Kino, Spaziergang" /></div>
            <div className="field">
              <label className="label" htmlFor="pz-sitter">Wer hat auf die Kinder aufgepasst?</label>
              <input className="input" id="pz-sitter" name="sitter" list="pz-sitters" autoComplete="off" />
              <datalist id="pz-sitters">{sitters.map((x) => <option key={x} value={x} />)}</datalist>
            </div>
            <div className="field"><label className="label" htmlFor="pz-cost">Kosten Babysitter (€, optional)</label><input className="input" id="pz-cost" name="costEur" inputMode="decimal" /></div>
          </div>
          <Rating name="rating" label="Wie war’s? (optional)" low="naja" high="wunderbar" />
          <div className="field"><label className="label" htmlFor="pz-note">Notiz (optional)</label><input className="input" id="pz-note" name="note" autoComplete="off" /></div>
        </StateForm>
        {dates.length > 0 && (
          <table className="table" data-testid="date-list">
            <tbody>
              {dates.slice(0, 15).map((e) => (
                <tr key={e.id}>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>{weekday(e.data.day)} {dm(e.data.day)}</td>
                  <td className="small">{dateLine(e.data) || "–"}{e.data.note ? <div className="muted">{e.data.note}</div> : null}</td>
                  <td className="right"><form action={deleteEntryAction}><input type="hidden" name="kind" value="paarzeit" /><input type="hidden" name="id" value={e.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>löschen</button></form></td>
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
                <form action={deleteEntryAction}><input type="hidden" name="kind" value="dateidee" /><input type="hidden" name="id" value={i.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} aria-label="Idee löschen">×</button></form>
              </div>
            ))}
          </div>
        )}
        <StateForm action={addIdeaAction} submit="Idee speichern" testid="idea-form" className="">
          <input className="input" name="text" required placeholder="z. B. Thermalbad, Kochkurs, Konzert, Picknick" autoComplete="off" />
        </StateForm>
        <div className="small muted">Hinweis „Zeit für ein Date?“ nach {s.dateReminderDays || "–"} Tagen – in den Einstellungen änderbar.</div>
      </section>

      <section className="card card-pad stack" id="danke">
        <h2>💛 Wertschätzung</h2>
        <div className="small muted">Kleine Dinge, die du am anderen geschätzt hast – gleich notieren, sonst vergisst man sie. Beim Paar-Gespräch stehen sie schon drin.</div>
        <StateForm action={addThanksAction} submit={`Notieren (${me === "a" ? `${s.partners.a} über ${s.partners.b}` : `${s.partners.b} über ${s.partners.a}`})`} testid="thanks-form" className="">
          <input className="input" name="text" required placeholder="z. B. hat mir heute Abend den Rücken freigehalten" autoComplete="off" />
        </StateForm>
        {thanks.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="thanks-list">
            {thanks.slice(0, 12).map((t) => (
              <li key={t.id} className="small">
                <strong>{dm(t.data.day)}</strong> {t.data.from === "a" ? s.partners.a : s.partners.b}: {t.data.text}
                <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}><input type="hidden" name="kind" value="danke" /><input type="hidden" name="id" value={t.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }} aria-label="löschen">×</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad stack" id="stimmung">
        <h2>Wie geht’s uns als Paar?</h2>
        <StateForm action={saveMoodAction} submit={myMood ? "Ändern" : "Speichern"} testid="mood-form" keep>
          <Rating name="value" label={`Heute (${me === "a" ? s.partners.a : s.partners.b})`} low="schwierig" high="sehr gut" value={myMood?.value} />
          <input className="input" name="note" placeholder="Warum? (optional)" defaultValue={myMood?.note ?? ""} autoComplete="off" />
        </StateForm>
        <div className="small muted" data-testid="mood-today">
          Heute: {s.partners.a} {moodToday.a ? `${moodToday.a}/5` : "–"} · {s.partners.b} {moodToday.b ? `${moodToday.b}/5` : "–"}
        </div>
        <div className="priv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
          {(["a", "b"] as const).map((k) => {
            const series = moodSeries(moods.map((e) => e.data), k, today, 30);
            const avg = avgOf(series.map((p) => p.value));
            return (
              <figure key={k} style={{ margin: 0, minWidth: 0 }}>
                <figcaption className="small" style={{ display: "flex", justifyContent: "space-between" }}><span>{k === "a" ? s.partners.a : s.partners.b}</span><span className="muted">Ø {avg === null ? "–" : String(avg).replace(".", ",")}</span></figcaption>
                <div className="spark" role="img" aria-label={`Stimmung ${k === "a" ? s.partners.a : s.partners.b}, letzte 30 Tage, Durchschnitt ${avg ?? "–"}`}>
                  {series.map((p) => <i key={p.day} className={p.value === null ? "empty" : ""} style={{ height: p.value === null ? "100%" : `${(p.value / 5) * 100}%` }} title={`${dm(p.day)}: ${p.value ?? "–"}`} />)}
                </div>
                <div className="small muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{dm(series[0].day)}</span><span>heute</span></div>
              </figure>
            );
          })}
        </div>
      </section>

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
            <div className="field"><label className="label" htmlFor="t-a">{s.partners.a} schätzt an {s.partners.b}</label><textarea className="input" id="t-a" name="appreciationsA" rows={3} defaultValue={pending.a.join("\n")} /></div>
            <div className="field"><label className="label" htmlFor="t-b">{s.partners.b} schätzt an {s.partners.a}</label><textarea className="input" id="t-b" name="appreciationsB" rows={3} defaultValue={pending.b.join("\n")} /></div>
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
