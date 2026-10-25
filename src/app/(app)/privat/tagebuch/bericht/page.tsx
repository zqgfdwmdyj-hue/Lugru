import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays, diaryReport, intakeStatus, isDay, memberLabels, planFor, type AppointmentEntry, type DiaryEntry, type ObservationEntry } from "@/lib/private/logic";
import { loadEntries, myMedPlan, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { PrintButton } from "@/components/print-button";
import { PrivatHead, dm, dmy } from "../../ui";

const n = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "–" : `${String(v).replace(".", ",")}${unit}`);

/** Teile des Berichts. Freitexte, Messwerte und Beobachtungen anderer nur, wenn bewusst gewählt. */
const PARTS = [
  { key: "phasen", label: "Dosis-Phasen", on: true },
  { key: "schnitt", label: "Durchschnittswerte", on: true },
  { key: "neben", label: "Nebenwirkungen", on: true },
  { key: "tage", label: "Tage im Einzelnen (mit Einnahmen)", on: true },
  { key: "mess", label: "Messwerte (Puls, Blutdruck, Gewicht)", on: false },
  { key: "notizen", label: "Eigene Notizen und „Was war schwer“", on: false },
  { key: "beob", label: "Beobachtungen von außen", on: false },
] as const;
type Part = (typeof PARTS)[number]["key"];

export default async function TagebuchBerichtPage({ searchParams }: { searchParams: Promise<{ von?: string; ab?: string; bis?: string; teil?: string | string[]; auswahl?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const today = todayIso();
  const to = isDay(sp.bis) ? sp.bis! : today;
  const from = isDay(sp.ab) ? sp.ab! : addDays(to, -27);
  const s = await privateSettings(session.tenantId);
  const members = await privateMembers(session.tenantId);
  const ownerId = sp.von && s.diaryShared.includes(sp.von) ? sp.von : session.userId;
  const owner = members.find((m) => m.userId === ownerId);
  const entries = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).filter((e) => e.userId === ownerId).map((e) => e.data);
  const r = diaryReport(entries, from, to);
  const obs = (await loadEntries<ObservationEntry>(session, ["beobachtung"])).filter((o) => o.data.aboutUserId === ownerId && o.data.day >= from && o.data.day <= to).sort((a, b) => a.data.day.localeCompare(b.data.day));
  const labels = memberLabels(members);
  const nameOf = (id: string) => labels.get(id) ?? "";
  const notes = r.entries.filter((e) => e.note || e.hard);
  const chosen = new Set<Part>(sp.auswahl ? ([] as string[]).concat(sp.teil ?? []).filter((x): x is Part => PARTS.some((p) => p.key === x)) : PARTS.filter((p) => p.on).map((p) => p.key));
  const own = ownerId === session.userId;
  const { plan } = await myMedPlan(session);
  const perDayOf = (day: string) => (own && planFor(plan, day).med ? planFor(plan, day).intakesPerDay : 0);
  // Zeitraum-Vorschläge: 4 Wochen, Vormonat, seit dem letzten Arzttermin
  const lastVisit = (await loadEntries<AppointmentEntry>(session, ["termin"])).filter((a) => (a.data.with === "ads" || a.data.with === "arzt") && a.data.day < today).map((a) => a.data.day).sort().pop();
  const pm = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const pmEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  const keep = `${sp.von ? `&von=${sp.von}` : ""}${sp.auswahl ? `&auswahl=1${[...chosen].map((c) => `&teil=${c}`).join("")}` : ""}`;
  const presets = [
    { label: "letzte 4 Wochen", ab: addDays(today, -27), bis: today },
    { label: "Vormonat", ab: pm, bis: pmEnd },
    ...(lastVisit ? [{ label: `seit Termin ${dm(lastVisit)}`, ab: lastVisit, bis: today }] : []),
  ];

  return (
    <>
      <div className="no-print">
        <PrivatHead active="bericht" title="Bericht für den Arzttermin" pin={session.privatePin} sub={<PrintButton label="Drucken / als PDF speichern" />} />
        <form method="get" className="card card-pad stack" style={{ gap: 12 }} data-testid="report-form">
          {sp.von && <input type="hidden" name="von" value={sp.von} />}
          <input type="hidden" name="auswahl" value="1" />
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field"><label className="label" htmlFor="ab">Zeitraum von</label><input className="input" id="ab" name="ab" type="date" defaultValue={from} max={today} /></div>
            <div className="field"><label className="label" htmlFor="bis">bis</label><input className="input" id="bis" name="bis" type="date" defaultValue={to} max={today} /></div>
            <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {presets.map((p) => <Link key={p.label} href={`/privat/tagebuch/bericht?ab=${p.ab}&bis=${p.bis}${keep}`}>{p.label}</Link>)}
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Was soll in den Bericht?</legend>
            <div className="pick-chips" data-testid="report-parts">
              {PARTS.map((p) => (
                <label key={p.key}>
                  <input type="checkbox" name="teil" value={p.key} defaultChecked={chosen.has(p.key)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>Notizen, Messwerte und Beobachtungen anderer sind nur dabei, wenn du sie hier auswählst. Unten steht die Vorschau – gedruckt wird genau das.</div>
          </fieldset>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit">Vorschau aktualisieren</button>
            <Link className="btn-link small" href="/privat/tagebuch">zurück zum Tagebuch</Link>
          </div>
        </form>
        <div className="small muted" style={{ margin: "4px 0" }}>Vorschau:</div>
      </div>

      <section className="card card-pad stack" data-testid="diary-report">
        <h2>ADHS-Tagebuch {owner ? nameOf(owner.userId) : ""} – {dmy(from)} bis {dmy(to)}</h2>
        <div className="small muted">{r.days} Tage eingetragen · Bewertungen 1 = schlecht bis 5 = sehr gut · „–“ = nicht erfasst · selbst geführt, ohne Auswertung oder Empfehlung, ersetzt keine ärztliche Untersuchung</div>

        {chosen.has("phasen") && <>
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Dosis-Phasen</h3>
        <table className="table">
          <thead><tr><th>Zeitraum</th><th>Medikament</th><th className="right">Dosis</th><th className="right">Tage</th><th className="right">Ø Konz.</th><th className="right">Ø Stimmung</th><th className="right">Nebenw.</th></tr></thead>
          <tbody>
            {r.phases.length === 0 && <tr><td colSpan={7} className="muted">Keine Einträge im Zeitraum.</td></tr>}
            {r.phases.map((p) => (
              <tr key={`${p.from}-${p.doseMg}`}>
                <td className="num">{dm(p.from)}–{dm(p.to)}</td>
                <td>{p.med}</td>
                <td className="num right">{n(p.doseMg, " mg")}</td>
                <td className="num right">{p.days}</td>
                <td className="num right">{n(p.focus)}</td>
                <td className="num right">{n(p.mood)}</td>
                <td className="num right">{p.sideEffects}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>}

        {chosen.has("schnitt") && <>
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Durchschnitt im Zeitraum</h3>
        <div className="priv-grid small">
          <div>Konzentration <strong>{n(r.averages.focus)}</strong></div>
          <div>Stimmung <strong>{n(r.averages.mood)}</strong></div>
          <div>Innere Ruhe <strong>{n(r.averages.calm)}</strong></div>
          <div>Energie <strong>{n(r.averages.energy)}</strong></div>
          <div>Schlafqualität <strong>{n(r.averages.sleepQuality)}</strong></div>
          <div>Schlaf <strong>{n(r.averages.sleepHours, " h")}</strong></div>
          <div>Appetit <strong>{n(r.averages.appetite)}</strong></div>
          <div>Puls <strong>{n(r.averages.pulse)}</strong></div>
          {chosen.has("mess") && <div>Gewicht <strong>{r.weightChange === null ? "–" : `${r.weightChange > 0 ? "+" : ""}${n(r.weightChange, " kg")}`}</strong></div>}
        </div>
        </>}

        {chosen.has("neben") && <>
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Nebenwirkungen (an wie vielen Tagen eingetragen)</h3>
        <div className="small" data-testid="report-side-days">Tage mit Nebenwirkungen: {r.sideEffectDays.erfasst} · ausdrücklich keine: {r.sideEffectDays.keine} · nicht dokumentiert: {r.sideEffectDays.offen}</div>
        {r.sideEffects.length === 0 ? <div className="small muted">Keine Nebenwirkung eingetragen{r.sideEffectDays.offen ? ` (an ${r.sideEffectDays.offen} Tag${r.sideEffectDays.offen === 1 ? "" : "en"} nicht dokumentiert)` : ""}.</div> : <div className="small">{r.sideEffects.map((x) => `${x.name} ${x.count}×`).join(" · ")}</div>}
        </>}

        {chosen.has("mess") && r.vitals.length > 0 && (
          <>
            <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Messwerte</h3>
            <table className="table">
              <thead><tr><th>Tag</th><th className="right">Dosis</th><th className="right">Puls</th><th className="right">Blutdruck</th><th className="right">Gewicht</th></tr></thead>
              <tbody>
                {r.vitals.map((v) => (
                  <tr key={v.day}><td className="num">{dm(v.day)}</td><td className="num right">{n(v.doseMg, " mg")}</td><td className="num right">{n(v.pulse)}</td><td className="num right">{v.bp ?? "–"}</td><td className="num right">{n(v.weightKg, " kg")}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {chosen.has("tage") && <>
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Tage im Einzelnen</h3>
        <table className="table" data-testid="report-days">
          <thead><tr><th>Tag</th><th>Einnahme</th><th>Wirkung</th><th className="right">Konz.</th><th className="right">Stimm.</th><th className="right">Ruhe</th><th className="right">Schlaf</th><th className="right">Appetit</th></tr></thead>
          <tbody>
            {r.entries.map((e) => (
              <tr key={e.day}>
                <td className="num">{dm(e.day)}</td>
                <td className="small">{n(e.doseMg, " mg")} · {intakeStatus(e, perDayOf(e.day)).label}</td>
                <td className="num">{e.onset || e.wearOff ? `${e.onset ?? "?"}–${e.wearOff ?? "?"}` : "–"}</td>
                <td className="num right">{e.focus ?? "–"}</td>
                <td className="num right">{e.mood ?? "–"}</td>
                <td className="num right">{e.calm ?? "–"}</td>
                <td className="num right">{e.sleepHours !== undefined ? n(e.sleepHours, " h") : e.sleepQuality ?? "–"}</td>
                <td className="num right">{e.appetite ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>}

        {((chosen.has("notizen") && notes.length > 0) || (chosen.has("beob") && obs.length > 0)) && (
          <>
            <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>{chosen.has("notizen") && chosen.has("beob") ? "Notizen, Schwieriges und Beobachtungen von außen" : chosen.has("notizen") ? "Notizen und Schwieriges" : "Beobachtungen von außen"}</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="report-notes">
              {chosen.has("notizen") && notes.map((e) => <li key={`n-${e.day}`}><strong>{dm(e.day)}</strong> {[e.hard && `Schwer: ${e.hard}`, e.note].filter(Boolean).join(" · ")}</li>)}
              {chosen.has("beob") && obs.map((o) => <li key={o.id}><strong>{dm(o.data.day)}</strong> {nameOf(o.userId)} beobachtet: {o.data.text}</li>)}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
