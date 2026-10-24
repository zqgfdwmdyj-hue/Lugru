import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays, diaryReport, isDay, type DiaryEntry, type ObservationEntry } from "@/lib/private/logic";
import { loadEntries, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { PrintButton } from "@/components/print-button";
import { PrivatHead, dm, dmy } from "../../ui";

const n = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "–" : `${String(v).replace(".", ",")}${unit}`);

export default async function TagebuchBerichtPage({ searchParams }: { searchParams: Promise<{ von?: string; ab?: string; bis?: string }> }) {
  const session = await requirePrivate();
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
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? members.find((m) => m.userId === id)?.login ?? "";
  const notes = r.entries.filter((e) => e.note || e.hard);

  return (
    <>
      <div className="no-print">
        <PrivatHead active="tagebuch" title="Bericht für den Arzttermin" pin={session.privatePin} sub={<PrintButton label="Drucken / als PDF speichern" />} />
        <form method="get" className="card card-pad" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          {sp.von && <input type="hidden" name="von" value={sp.von} />}
          <div className="field"><label className="label" htmlFor="ab">von</label><input className="input" id="ab" name="ab" type="date" defaultValue={from} max={today} /></div>
          <div className="field"><label className="label" htmlFor="bis">bis</label><input className="input" id="bis" name="bis" type="date" defaultValue={to} max={today} /></div>
          <button className="btn" type="submit">Anzeigen</button>
          <Link className="btn-link small" href="/privat/tagebuch">zurück zum Tagebuch</Link>
        </form>
      </div>

      <section className="card card-pad stack" data-testid="diary-report">
        <h2>ADHS-Tagebuch {owner?.name ?? owner?.login ?? ""} – {dmy(from)} bis {dmy(to)}</h2>
        <div className="small muted">{r.days} Tage eingetragen · Bewertungen 1 = schlecht bis 5 = sehr gut · selbst geführt, ersetzt keine ärztliche Untersuchung</div>

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
          <div>Gewicht <strong>{r.weightChange === null ? "–" : `${r.weightChange > 0 ? "+" : ""}${n(r.weightChange, " kg")}`}</strong></div>
        </div>

        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Nebenwirkungen (an wie vielen Tagen)</h3>
        {r.sideEffects.length === 0 ? <div className="small muted">Keine eingetragen.</div> : <div className="small">{r.sideEffects.map((x) => `${x.name} ${x.count}×`).join(" · ")}</div>}

        {r.vitals.length > 0 && (
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

        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Tage im Einzelnen</h3>
        <table className="table">
          <thead><tr><th>Tag</th><th>Einnahme</th><th>Wirkung</th><th className="right">Konz.</th><th className="right">Stimm.</th><th className="right">Ruhe</th><th className="right">Schlaf</th><th className="right">Appetit</th></tr></thead>
          <tbody>
            {r.entries.map((e) => (
              <tr key={e.day}>
                <td className="num">{dm(e.day)}</td>
                <td className="num">{n(e.doseMg, " mg")}{e.takenAt ? ` ${e.takenAt}` : ""}</td>
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

        {(notes.length > 0 || obs.length > 0) && (
          <>
            <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Notizen, Schwieriges und Beobachtungen von außen</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {notes.map((e) => <li key={`n-${e.day}`}><strong>{dm(e.day)}</strong> {[e.hard && `Schwer: ${e.hard}`, e.note].filter(Boolean).join(" · ")}</li>)}
              {obs.map((o) => <li key={o.id}><strong>{dm(o.data.day)}</strong> {nameOf(o.userId)} beobachtet: {o.data.text}</li>)}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
