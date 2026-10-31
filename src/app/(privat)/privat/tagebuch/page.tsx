import Link from "next/link";
import { SideEffectsPicker } from "./side-effects";
import { todayIso } from "@/lib/dates";
import { RATING_FIELDS, SIDE_EFFECTS, addDays, diarySeries, intakeStatus, isDay, memberLabels, planFor, sideEffectState, type DiaryEntry, type ObservationEntry } from "@/lib/private/logic";
import { Disclosure } from "@/components/disclosure";
import { loadEntries, myMedPlan, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { beobachtungTeile } from "@/lib/private/rueckblick-logic";
import { addObservationAction, deleteEntryAction, saveDiaryAction, updateObservationAction } from "../actions";
import { StateForm } from "../state-form";
import { IntakeCard } from "../intake";
import { PrivatHead, Rating, dm, dmy, weekday } from "../ui";

const n = (v: number | undefined) => (v === undefined ? "" : String(v).replace(".", ","));

/** Kleines Säulendiagramm (eine Reihe, 1–5) über 30 Tage; Dosiswechsel oben markiert. */
function Spark({ title, series }: { title: string; series: { day: string; value: number | null; doseMg: number | null }[] }) {
  const values = series.filter((p) => p.value !== null).map((p) => p.value!);
  const avg = values.length ? (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1).replace(".", ",") : "–";
  let lastDose: number | null = null;
  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <figcaption className="small" style={{ display: "flex", justifyContent: "space-between" }}><span>{title}</span><span className="muted">Ø {avg}</span></figcaption>
      <div className="spark" role="img" aria-label={`${title}, letzte 30 Tage, Durchschnitt ${avg} von 5`}>
        {series.map((p) => {
          const changed = p.doseMg !== null && lastDose !== null && p.doseMg !== lastDose;
          if (p.doseMg !== null) lastDose = p.doseMg;
          return <i key={p.day} className={`${p.value === null ? "empty" : ""}${changed ? " dose" : ""}`} style={{ height: p.value === null ? "100%" : `${(p.value / 5) * 100}%` }} title={`${dm(p.day)}: ${p.value ?? "–"}${p.doseMg !== null ? ` · ${n(p.doseMg)} mg` : ""}`} />;
        })}
      </div>
      <div className="small muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{dm(series[0].day)}</span><span>heute</span></div>
    </figure>
  );
}

export default async function TagebuchPage({ searchParams }: { searchParams: Promise<{ tag?: string; von?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const today = todayIso();
  const day = isDay(sp.tag) && sp.tag! <= today ? sp.tag! : today;
  const s = await privateSettings(session.tenantId);
  const members = await privateMembers(session.tenantId);
  const all = await loadEntries<DiaryEntry>(session, ["tagebuch"]);
  const others = members.filter((m) => m.userId !== session.userId && s.diaryShared.includes(m.userId));
  const viewing = others.find((m) => m.userId === sp.von) ?? null;
  const owner = viewing?.userId ?? session.userId;
  const mine = all.filter((e) => e.userId === owner).sort((a, b) => b.data.day.localeCompare(a.data.day));
  const entry = mine.find((e) => e.data.day === day)?.data;
  const last = mine.find((e) => e.data.day < day)?.data;
  const { plan } = await myMedPlan(session);
  // Vorbelegung aus dem Plan, der an diesem Tag galt (nicht aus dem heutigen) – sonst vom Vortag.
  const dayPlan = planFor(plan, day);
  const pre: Partial<DiaryEntry> = entry ?? { med: dayPlan.med || last?.med, doseMg: dayPlan.med ? dayPlan.doseMg : last?.doseMg };
  // Fremdes Tagebuch: den eigenen Plan nicht unterstellen (nur zeigen, was dort steht).
  // Ohne eingerichteten Einnahmeplan ist nichts „geplant“ (früher stand hier still 1).
  const perDay = viewing ? 0 : dayPlan.med ? dayPlan.intakesPerDay : 0;
  const status = intakeStatus(entry, perDay);
  const observations = (await loadEntries<ObservationEntry>(session, ["beobachtung"])).sort((a, b) => b.data.day.localeCompare(a.data.day));
  const aboutMe = observations.filter((o) => o.data.aboutUserId === session.userId);
  const byMe = observations.filter((o) => o.userId === session.userId);
  const labels = memberLabels(members);
  const nameOf = (id: string) => labels.get(id) ?? "?";
  const data = mine.map((e) => e.data);
  const streakDays = (() => {
    const days = new Set(data.map((d) => d.day));
    let k = 0;
    for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) k++;
    return k;
  })();

  return (
    <>
      <PrivatHead active="tagebuch" title={viewing ? `ADHS-Tagebuch von ${nameOf(viewing.userId)}` : "ADHS-Tagebuch"} pin={session.privatePin} sub={
        <Link className="btn btn-small" href={`/privat/tagebuch/bericht${viewing ? `?von=${viewing.userId}` : ""}`}>Bericht für den Arzttermin</Link>
      } />

      {others.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link className={`chip${!viewing ? " active" : ""}`} aria-current={!viewing ? "true" : undefined} href="/privat/tagebuch">Mein Tagebuch</Link>
          {others.map((m) => <Link key={m.userId} className={`chip${viewing?.userId === m.userId ? " active" : ""}`} aria-current={viewing?.userId === m.userId ? "true" : undefined} href={`/privat/tagebuch?von=${m.userId}`}>{nameOf(m.userId)}</Link>)}
        </div>
      )}

      {!viewing && <IntakeCard session={session} full />}

      <section className="card card-pad stack">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <h2>{weekday(day)}, {dmy(day)} {entry ? <span className="tag tag-ok">eingetragen</span> : <span className="tag tag-warn">noch offen</span>}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <Link className="btn btn-small" href={`/privat/tagebuch?tag=${addDays(day, -1)}${viewing ? `&von=${viewing.userId}` : ""}`} aria-label="Vortag">‹</Link>
            {day !== today && <Link className="btn btn-small" href={`/privat/tagebuch${viewing ? `?von=${viewing.userId}` : ""}`}>Heute</Link>}
            {day < today && <Link className="btn btn-small" href={`/privat/tagebuch?tag=${addDays(day, 1)}${viewing ? `&von=${viewing.userId}` : ""}`} aria-label="Folgetag">›</Link>}
          </div>
        </div>
        {streakDays > 1 && !viewing && <div className="small muted">{streakDays} Tage am Stück eingetragen – stark.</div>}

        {viewing ? (
          entry ? (
            <div className="small stack" style={{ gap: 4 }}>
              <div>{[entry.med, entry.doseMg !== undefined ? `${n(entry.doseMg)} mg` : ""].filter(Boolean).join(" · ") || "kein Medikament eingetragen"} · Einnahme: {status.label}</div>
              <div>{RATING_FIELDS.map((f) => `${f.label}: ${entry[f.key] ?? "nicht erfasst"}`).join(" · ")}</div>
              <div>Nebenwirkungen: {entry.sideEffects?.length ? entry.sideEffects.join(", ") : sideEffectState(entry) === "keine" ? "keine" : "nicht dokumentiert"}</div>
              {entry.good && <div>Gut: {entry.good}</div>}
              {entry.hard && <div>Schwer: {entry.hard}</div>}
            </div>
          ) : <div className="small muted">Für diesen Tag nichts eingetragen.</div>
        ) : (
          <div key={day}>
            <StateForm action={saveDiaryAction} submit={entry ? "Änderungen speichern" : "Tag speichern"} testid="diary-form" keep>
              <input type="hidden" name="day" value={day} />
              <div className="small muted">Kurz: Einnahme, drei Werte, Nebenwirkungen – dauert eine Minute. Alles Weitere unten aufklappen.</div>
              <h3 className="label" style={{ margin: 0 }}>Einnahme {pre.med ? `· ${pre.med}${pre.doseMg !== undefined ? ` ${n(pre.doseMg)} mg` : ""}` : ""}</h3>
              <div className="priv-grid">
                <div className="field">
                  <label className="label" htmlFor="d-intakes">eingenommen um</label>
                  <input className="input" id="d-intakes" name="intakes" defaultValue={status.times.join(", ")} placeholder={perDay > 1 ? "z. B. 08:00, 13:00" : "z. B. 08:00"} inputMode="numeric" autoComplete="off" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-nottaken">bewusst nicht genommen</label>
                  <select className="select" id="d-nottaken" name="notTaken" defaultValue={String(entry?.notTaken ?? 0)}>
                    {Array.from({ length: Math.max(perDay, entry?.notTaken ?? 0) + 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? "–" : `${i}× (ausgelassen)`}</option>)}
                  </select>
                </div>
              </div>
              <div className="small muted" data-testid="diary-intake-status">
                {perDay > 0
                  ? <>{perDay} Einnahme{perDay === 1 ? "" : "n"} geplant: {status.label}. Leer gelassen heißt „nicht dokumentiert“ – nicht „nicht genommen“.</>
                  : <>Noch kein Einnahmeplan eingerichtet – nichts gilt als geplant. Einnahmen kannst du trotzdem eintragen; den Plan richtest du oben bei „💊 Medikament“ ein.</>}
              </div>
              <h3 className="label" style={{ margin: "6px 0 0" }}>Wie war der Tag? (1 = schlecht, 5 = sehr gut)</h3>
              <div className="priv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                {RATING_FIELDS.filter((f) => f.key === "focus" || f.key === "mood" || f.key === "sleepQuality").map((f) => <Rating key={f.key} name={f.key} label={f.label} low={f.low} high={f.high} value={entry?.[f.key]} />)}
              </div>
              <div className="field">
                <span className="label">Nebenwirkungen heute</span>
                <SideEffectsPicker key={entry ? `${entry.day}|${(entry.sideEffects ?? []).join(",")}|${entry.noSideEffects ? 1 : 0}` : "neu"} options={SIDE_EFFECTS} values={entry?.sideEffects} none={Boolean(entry?.noSideEffects)} other={(entry?.sideEffects ?? []).find((x) => !(SIDE_EFFECTS as readonly string[]).includes(x)) ?? ""} />
                <div className="small muted">Das Tagebuch wertet nichts medizinisch aus. Fragen zu Nebenwirkungen bitte mit deiner Ärztin/deinem Arzt besprechen – Bereitschaftsdienst 116 117, im Notfall 112.</div>
              </div>
              <Disclosure summary="Weitere Angaben: Medikament, Wirkung, weitere Werte, Messwerte, Notizen" defaultOpen={Boolean(entry && (entry.onset || entry.wearOff || entry.calm || entry.energy || entry.appetite || entry.pulse || entry.weightKg || entry.good || entry.hard || entry.note))}>
                <div className="stack" style={{ gap: 12, marginTop: 10 }} data-testid="diary-more">
                  <div className="priv-grid">
                    <div className="field"><label className="label" htmlFor="d-med">Medikament</label><input className="input" id="d-med" name="med" defaultValue={pre.med ?? ""} placeholder="z. B. Methylphenidat retard" autoComplete="off" /></div>
                    <div className="field"><label className="label" htmlFor="d-dose">Dosis (mg)</label><input className="input" id="d-dose" name="doseMg" inputMode="decimal" defaultValue={n(pre.doseMg)} /></div>
                    <div className="field"><label className="label" htmlFor="d-onset">Wirkung spürbar ab</label><input className="input" id="d-onset" name="onset" type="time" defaultValue={entry?.onset ?? ""} /></div>
                    <div className="field"><label className="label" htmlFor="d-wear">lässt nach um</label><input className="input" id="d-wear" name="wearOff" type="time" defaultValue={entry?.wearOff ?? ""} /></div>
                  </div>
                  <div className="small muted">Medikament und Dosis gelten nur für diesen Tag – den Plan änderst du oben bei „Medikament & Vorrat“.</div>
                  <div className="priv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                    {RATING_FIELDS.filter((f) => f.key !== "focus" && f.key !== "mood" && f.key !== "sleepQuality").map((f) => <Rating key={f.key} name={f.key} label={f.label} low={f.low} high={f.high} value={entry?.[f.key]} />)}
                  </div>
                  <h3 className="label" style={{ margin: "6px 0 0" }}>Messwerte (wenn gemessen – am besten in Ruhe, immer zur ähnlichen Uhrzeit)</h3>
                  <div className="priv-grid">
                    <div className="field"><label className="label" htmlFor="d-sleep">Schlaf (Std.)</label><input className="input" id="d-sleep" name="sleepHours" inputMode="decimal" defaultValue={n(entry?.sleepHours)} /></div>
                    <div className="field"><label className="label" htmlFor="d-pulse">Puls (Ruhe)</label><input className="input" id="d-pulse" name="pulse" inputMode="numeric" defaultValue={n(entry?.pulse)} /></div>
                    <div className="field"><label className="label" htmlFor="d-sys">Blutdruck oben</label><input className="input" id="d-sys" name="bpSys" inputMode="numeric" defaultValue={n(entry?.bpSys)} /></div>
                    <div className="field"><label className="label" htmlFor="d-dia">Blutdruck unten</label><input className="input" id="d-dia" name="bpDia" inputMode="numeric" defaultValue={n(entry?.bpDia)} /></div>
                    <div className="field"><label className="label" htmlFor="d-weight">Gewicht (kg)</label><input className="input" id="d-weight" name="weightKg" inputMode="decimal" defaultValue={n(entry?.weightKg)} /></div>
                    <div className="field"><label className="label" htmlFor="d-coffee">Kaffee/Energy (Tassen)</label><input className="input" id="d-coffee" name="caffeine" inputMode="numeric" defaultValue={n(entry?.caffeine)} /></div>
                  </div>
                  <div className="priv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                    <div className="field"><label className="label" htmlFor="d-good">Was lief gut?</label><textarea className="input" id="d-good" name="good" rows={2} defaultValue={entry?.good ?? ""} /></div>
                    <div className="field"><label className="label" htmlFor="d-hard">Was war schwer?</label><textarea className="input" id="d-hard" name="hard" rows={2} defaultValue={entry?.hard ?? ""} /></div>
                  </div>
                  <div className="field"><label className="label" htmlFor="d-note">Notiz / Fragen an die Ärztin</label><textarea className="input" id="d-note" name="note" rows={2} defaultValue={entry?.note ?? ""} /></div>
                </div>
              </Disclosure>
            </StateForm>
          </div>
        )}
      </section>

      <section className="card card-pad stack">
        <h2>Verlauf – letzte 30 Tage</h2>
        {data.length === 0 ? <div className="small muted">Noch keine Einträge – nach ein paar Tagen siehst du hier, wie sich Konzentration, Stimmung und Schlaf entwickeln.</div> : (
          <>
            <div className="priv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }} data-testid="diary-charts">
              {(["focus", "mood", "calm", "sleepQuality"] as const).map((k) => <Spark key={k} title={RATING_FIELDS.find((f) => f.key === k)!.label} series={diarySeries(data, k, today, 30)} />)}
            </div>
            <div className="small muted">Je höher die Säule, desto besser (1–5); graue Tage = nicht erfasst. Ein oranger Strich oben markiert einen Tag mit neuer Dosis. In der Tabelle heißt „–“: nicht erfasst.</div>
            <table className="table" style={{ marginTop: 6 }}>
              <thead><tr><th>Tag</th><th>Einnahme</th><th className="right">Konz.</th><th className="right">Stimm.</th><th className="right">Schlaf</th><th>Nebenwirkungen</th><th></th></tr></thead>
              <tbody>
                {mine.slice(0, 14).map((e) => (
                  <tr key={e.id}>
                    <td className="num"><Link href={`/privat/tagebuch?tag=${e.data.day}${viewing ? `&von=${viewing.userId}` : ""}`}>{weekday(e.data.day)} {dm(e.data.day)}</Link></td>
                    <td className="small">{e.data.doseMg !== undefined ? `${n(e.data.doseMg)} mg · ` : ""}{intakeStatus(e.data, viewing ? 0 : planFor(plan, e.data.day).med ? planFor(plan, e.data.day).intakesPerDay : 0).label}</td>
                    <td className="num right">{e.data.focus ?? "–"}</td>
                    <td className="num right">{e.data.mood ?? "–"}</td>
                    <td className="num right">{e.data.sleepHours !== undefined ? `${n(e.data.sleepHours)} h` : e.data.sleepQuality ?? "–"}</td>
                    <td className="small">{e.data.sideEffects?.join(", ") || <span className="muted">–</span>}</td>
                    <td className="right">{!viewing && <form action={deleteEntryAction}><input type="hidden" name="kind" value="tagebuch" /><input type="hidden" name="id" value={e.id} /><button className="btn-link small danger" type="submit">löschen</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card card-pad stack" id="beobachtungen">
        <h2>Beobachtungen</h2>
        <div className="small muted">Wie wirkt es von außen? Gerade in der Einstellungsphase sehen Partner oft Dinge, die man selbst nicht merkt (z. B. gereizt am Abend, ruhiger beim Essen).</div>
        {aboutMe.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="observations-about-me">
            {aboutMe.slice(0, 20).map((o) => <li key={o.id} className="small"><strong>{dm(o.data.day)}</strong> {nameOf(o.userId)}: {o.data.text}</li>)}
          </ul>
        )}
        {members.filter((m) => m.userId !== session.userId).length > 0 && (
          <StateForm action={addObservationAction} submit="Beobachtung speichern" testid="observation-form">
            <div className="priv-grid">
              <div className="field">
                <label className="label" htmlFor="o-about">Über</label>
                <select className="select" id="o-about" name="about">
                  {members.filter((m) => m.userId !== session.userId).map((m) => <option key={m.userId} value={m.userId}>{nameOf(m.userId)}</option>)}
                </select>
              </div>
              <div className="field"><label className="label" htmlFor="o-day">Tag</label><input className="input" id="o-day" name="day" type="date" defaultValue={today} max={today} /></div>
            </div>
            <BeobachtungFelder />
          </StateForm>
        )}
        <div className="small"><Link href="/privat/therapie-bogen" data-testid="link-therapie-bogen">Therapie-Bogen seit letzter Sitzung (Drucken/PDF) →</Link></div>
        {byMe.length > 0 && (
          <details>
            <summary className="small" style={{ cursor: "pointer" }}>Meine Beobachtungen ({byMe.length})</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {byMe.slice(0, 30).map((o) => {
                const t = beobachtungTeile(o.data);
                return (
                  <li key={o.id} className="small" data-testid="observation-mine">
                    <strong>{dm(o.data.day)}</strong> über {nameOf(o.data.aboutUserId)}: {o.data.text}
                    {t.unvollstaendig && <> <span className="tag tag-warn">enthält [?] – unvollständig</span></>}
                    <form action={deleteEntryAction} style={{ display: "inline", marginLeft: 6 }}><input type="hidden" name="kind" value="beobachtung" /><input type="hidden" name="id" value={o.id} /><button className="btn-link small danger" type="submit" data-testid="observation-delete">löschen</button></form>
                    <details style={{ marginTop: 4 }}>
                      <summary className="btn-link small" style={{ cursor: "pointer" }} data-testid="observation-edit">bearbeiten</summary>
                      <StateForm action={updateObservationAction} submit="Änderung speichern" testid="observation-edit-form">
                        <input type="hidden" name="id" value={o.id} />
                        <div className="field"><label className="label" htmlFor={`oe-day-${o.id}`}>Tag</label><input className="input" id={`oe-day-${o.id}`} name="day" type="date" defaultValue={o.data.day} max={today} /></div>
                        <BeobachtungFelder id={o.id} werte={t} />
                      </StateForm>
                    </details>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}

/** Die drei Spalten des Therapie-Bogens. „[?]“ im Text markiert eine Stelle als noch unvollständig. */
function BeobachtungFelder({ id = "neu", werte }: { id?: string; werte?: { situation: string; problematik: string | null; veraenderung: string | null } }) {
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={`o-sit-${id}`}>Situation</label>
        <textarea className="input" id={`o-sit-${id}`} name="situation" rows={2} maxLength={1000} placeholder="z. B. Abendessen, Kinder müde, ab 17 Uhr gereizt" defaultValue={werte?.situation ?? ""} required />
      </div>
      <div className="field">
        <label className="label" htmlFor={`o-pro-${id}`}>Problematik <span className="muted">(optional)</span></label>
        <textarea className="input" id={`o-pro-${id}`} name="problematik" rows={2} maxLength={1000} placeholder="Was war schwierig?" defaultValue={werte?.problematik ?? ""} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`o-ver-${id}`}>Gewünschte Veränderung <span className="muted">(optional)</span></label>
        <textarea className="input" id={`o-ver-${id}`} name="veraenderung" rows={2} maxLength={1000} placeholder="Was wünschst du dir stattdessen?" defaultValue={werte?.veraenderung ?? ""} />
      </div>
      <div className="small muted">Noch unsicher? „[?]“ an die Stelle schreiben – im Therapie-Bogen steht dann „unvollständig“.</div>
    </>
  );
}
