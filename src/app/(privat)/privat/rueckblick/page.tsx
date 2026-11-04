import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { avgOf, careOverview, happened, dateStats, diaryReport, intimStats, kidsOverview, taskState, type CareTask, type DateEntry, type DiaryEntry, type IntimEntry, type KidsEntry, type MoodEntry, type ObservationEntry, type ReflexionEntry, type SleepEntry, type TaskEntry, type ThanksEntry } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import type { CalKind, TouchEntry } from "@/lib/private/kalender";
import { KindDot } from "../kalender/items";
import { PrintButton } from "@/components/print-button";
import { rueckblickZeitraum, wochentageJeWoche, zeitraumVorschlaege } from "@/lib/private/rueckblick-logic";
import { MonthNav, PrivatHead, dmy, hoursLabel, monthLabel } from "../ui";

const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const num = (v: number | null) => (v === null ? "nicht erfasst" : String(v).replace(".", ","));
/** Anzahl · Stunden – oder „nicht erfasst“ (fehlende Einträge sind keine Null). */
const ch = (t: { count: number; hours: number }) => (t.count ? `${t.count}× · ${hoursLabel(t.hours)}` : "nicht erfasst");

/** Eine Seite je Monat oder frei gewähltem Zeitraum – zum Ausdrucken oder als PDF für die Therapie. */
export default async function RueckblickPage({ searchParams }: { searchParams: Promise<{ monat?: string; von?: string; bis?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const today = todayIso();
  const z = rueckblickZeitraum(sp, today);
  const month = z.monat;
  const von = z.von;
  const end = z.bis;
  /** Tag im gewählten Zeitraum (Monat bis heute bzw. von–bis). */
  const drin = (d: string | undefined | null) => !!d && d.slice(0, 10) >= von && d.slice(0, 10) <= end;
  const zeitraumWort = z.frei ? "im Zeitraum" : "im Monat";
  const s = await privateSettings(session.tenantId);
  const name = s.partners;
  const [intim, dates, kids, sleep, timeout, tasks, care, thanks, moods, diary, touches, beob, zettel] = await Promise.all([
    loadEntries<IntimEntry>(session, ["intim"]),
    loadEntries<DateEntry>(session, ["paarzeit"]),
    loadEntries<KidsEntry>(session, ["kinder"]),
    loadEntries<SleepEntry>(session, ["ausschlafen"]),
    loadEntries<SleepEntry>(session, ["auszeit"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
    loadEntries<CareTask>(session, ["zustaendig"]),
    loadEntries<ThanksEntry>(session, ["danke"]),
    loadEntries<MoodEntry>(session, ["stimmung"]),
    loadEntries<DiaryEntry>(session, ["tagebuch"]),
    loadEntries<TouchEntry>(session, ["zuwendung"]),
    loadEntries<ObservationEntry>(session, ["beobachtung"]),
    loadEntries<ReflexionEntry>(session, ["reflexion"]),
  ]);
  // B22.1: eigene Beobachtungen und Zettel im Zeitraum (Verfasser = ich, egal über wen).
  const beobMonat = beob.filter((e) => e.userId === session.userId && drin(e.data.day)).length;
  const zettelMonat = zettel.filter((e) => e.userId === session.userId && drin(e.data.day)).length;
  // Streicheln/Massage: nur bestätigte zählen; ausgefallene getrennt (Geplantes nie).
  const inMonth = touches.map((t) => t.data).filter((t) => drin(t.day));
  const touchCount = (k: TouchEntry["kind"], st: TouchEntry["status"]) => inMonth.filter((t) => t.kind === k && t.status === st).length;
  // Die Monats-Auswertungen bekommen nur die Einträge des Zeitraums; Präfix "" = alle davon zählen.
  const ist = intimStats(intim.map((e) => e.data).filter((e) => drin(e.day)), "", end);
  // Nähe: Wochentage je Kalenderwoche (wie Ausgeschlafen), damit Pausen und Häufungen sichtbar werden.
  const naeheWochen = wochentageJeWoche(intim.map((e) => e.data.day), von, end);
  const ds = dateStats(dates.map((e) => e.data).filter((e) => drin(e.day)), "", end);
  const ko = kidsOverview(kids.map((e) => e.data).filter((e) => drin(e.day)), "");
  const so = kidsOverview(sleep.map((e) => e.data).filter((e) => drin(e.day)), "");
  // Ausgeschlafen: an welchen Wochentagen, je Kalenderwoche und Person (nur was stattgefunden hat).
  const schlafTage = (p: "a" | "b") => wochentageJeWoche(sleep.map((e) => e.data).filter((e) => e.person === p && happened(e)).map((e) => e.day), von, end);
  const schlafWochen = { a: schlafTage("a"), b: schlafTage("b") };
  const wochenText = (w: { kw: number; tage: string[] }[]) => w.map((x) => `KW ${x.kw}: ${x.tage.length ? x.tage.join(", ") : "–"}`).join(" · ");
  const to = kidsOverview(timeout.map((e) => e.data).filter((e) => drin(e.day)), "");
  const careDone = { a: 0, b: 0 };
  for (const t of care) for (const d of t.data.done ?? []) if (drin(d.day)) careDone[d.by]++;
  const co = careOverview(care.map((e) => e.data), end);
  const tasksDone = tasks.filter((t) => (t.data.repeat === "einmal" ? t.data.done && drin(t.data.doneAt) : (t.data.checks ?? []).some((d) => drin(d)))).length;
  const tasksOpen = tasks.filter((t) => taskState(t.data, end).open).length;
  const th = { a: thanks.filter((e) => e.data.from === "a" && drin(e.data.day)).length, b: thanks.filter((e) => e.data.from === "b" && drin(e.data.day)).length };
  const mood = { a: avgOf(moods.filter((e) => e.data.person === "a" && drin(e.data.day)).map((e) => e.data.value)), b: avgOf(moods.filter((e) => e.data.person === "b" && drin(e.data.day)).map((e) => e.data.value)) };
  const myDiary = diaryReport(diary.filter((e) => e.userId === session.userId).map((e) => e.data), von, end);

  const Row = ({ label, a, b, note, icon }: { label: string; a: React.ReactNode; b: React.ReactNode; note?: React.ReactNode; icon?: CalKind }) => (
    <tr><td>{icon && <><KindDot kind={icon} />{" "}</>}{label}</td><td className="num right">{a}</td><td className="num right">{b}</td><td className="small muted">{note}</td></tr>
  );

  return (
    <>
      <div className="no-print">
        <PrivatHead active="rueckblick" title={z.frei ? "Rückblick (Zeitraum)" : "Monatsrückblick"} pin={session.privatePin} month={month} sub={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <MonthNav path="/privat/rueckblick" month={month} />
            <Link className="btn" href="/privat/rueckblick/woche" data-testid="link-wochenrueckblick">Wochenrückblick</Link>
            <Link className="btn" href="/privat/beobachtungen" data-testid="link-beobachtungen">Beobachtungen</Link>
            <Link className="btn" href="/privat/therapie-bogen" data-testid="link-therapie-bogen">Therapie-Bogen</Link>
            <PrintButton label="Drucken / PDF" />
          </div>
        } />
        {/* Freier Zeitraum (von–bis), z. B. seit der letzten Sitzung oder über mehrere Monate */}
        <form method="get" action="/privat/rueckblick" className="card card-pad" data-testid="rb-zeitraum" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div className="field">
            <label className="label" htmlFor="rb-von">Von</label>
            <input className="input" type="date" id="rb-von" name="von" max={today} defaultValue={von} required data-testid="rb-von" />
          </div>
          <div className="field">
            <label className="label" htmlFor="rb-bis">Bis</label>
            <input className="input" type="date" id="rb-bis" name="bis" max={today} defaultValue={end} required data-testid="rb-bis" />
          </div>
          <button className="btn btn-primary" type="submit" data-testid="rb-zeitraum-anzeigen">Zeitraum anzeigen</button>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {zeitraumVorschlaege(today).map((v) => (
              <Link key={v.label} className="btn btn-small" href={`/privat/rueckblick?von=${v.von}&bis=${v.bis}`}>{v.label}</Link>
            ))}
            {z.frei && <Link className="btn btn-small" href={`/privat/rueckblick?monat=${month}`} data-testid="rb-zurueck-monat">Zurück zum Monat</Link>}
          </div>
        </form>
      </div>

      <section className="card card-pad stack" data-testid="review">
        <h2 data-testid="rb-titel">{z.frei ? `Rückblick ${dmy(von)} – ${dmy(end)}` : `Rückblick ${monthLabel(month)}${z.gekuerzt ? ` (bis ${end.slice(8, 10)}.${end.slice(5, 7)}.)` : ""}`}</h2>
        {z.frei && z.gekuerzt && <div className="small muted">Ende auf heute gekürzt – Zukünftiges zählt im Rückblick nicht.</div>}

        <h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Als Paar</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li className="rb-li" data-testid="rb-naehe"><KindDot kind="naehe" /> Nähe / Intimität: <strong>{ist.inMonth ? `${ist.inMonth}×` : "nicht erfasst"}</strong>
            {ist.inMonth > 0 && <span data-testid="rb-naehe-wochen"> — {wochenText(naeheWochen)}</span>}
          </li>
          <li className="rb-li"><KindDot kind="paarzeit" /> Paarzeit: <strong>{ds.inMonth ? `${ds.inMonth}×` : "nicht erfasst"}</strong>{ds.hoursInMonth ? `, ${hoursLabel(ds.hoursInMonth)}` : ""}{ds.costInMonth ? `, Babysitter ${euro(ds.costInMonth)}` : ""}</li>
          <li data-testid="rb-danke">💛 Wertschätzungen notiert: {th.a + th.b ? `${name.a} ${th.a ? `${th.a}×` : "keine notiert"} · ${name.b} ${th.b ? `${th.b}×` : "keine notiert"}` : "nicht erfasst"}</li>
          <li className="rb-li"><KindDot kind="streicheln" /> Streicheln / Massage (bestätigt): {touchCount("streicheln", "stattgefunden") + touchCount("massage", "stattgefunden") ? <strong>{touchCount("streicheln", "stattgefunden")}× Streicheln · {touchCount("massage", "stattgefunden")}× Massage</strong> : "nicht erfasst"}{touchCount("streicheln", "ausgefallen") + touchCount("massage", "ausgefallen") ? <span className="muted"> · {touchCount("streicheln", "ausgefallen") + touchCount("massage", "ausgefallen")}× ausgefallen/ausgelassen</span> : null}</li>
          <li>Stimmung als Paar (Ø 1–5): {name.a} {num(mood.a)} · {name.b} {num(mood.b)}</li>
          <li data-testid="rb-beobachtungen">📝 Meine Beobachtungen: {beobMonat ? <strong>{beobMonat}</strong> : "keine"}{zettelMonat ? ` · ${zettelMonat} Zettel für die Sitzung` : ""} <Link className="no-print" href="/privat/beobachtungen">ansehen →</Link></li>
        </ul>

        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Erfasste Zeiten</h3>
        <div className="small muted">Nur was eingetragen ist – keine Bewertung, wer mehr leistet. Kinderzeit und Auszeit eines gemeinsamen Vorgangs zählen je in ihrer Zeile einmal.</div>
        <table className="table">
          <thead><tr><th></th><th className="right">{name.a}</th><th className="right">{name.b}</th><th></th></tr></thead>
          <tbody>
            <Row icon="kinder" label="Allein mit den Kindern" a={ch(ko.totals.a)} b={ch(ko.totals.b)} />
            <Row icon="ausschlafen" label="Ausgeschlafen" a={ch(so.totals.a)} b={ch(so.totals.b)} />
            <Row icon="auszeit" label="Auszeit für sich" a={ch(to.totals.a)} b={ch(to.totals.b)} />
            <Row label="Familienaufgaben als erledigt eingetragen" a={careDone.a ? `${careDone.a}×` : "nicht erfasst"} b={careDone.b ? `${careDone.b}×` : "nicht erfasst"} note={`zuständig: ${co.owned.a} / ${co.owned.b}, beide ${co.owned.beide}, offen ${co.owned.offen}`} />
          </tbody>
        </table>
        {so.totals.a.count + so.totals.b.count > 0 && (
          <div className="small" data-testid="rb-ausschlafen-tage">
            <div className="rb-li"><KindDot kind="ausschlafen" /> Ausgeschlafen – Wochentage je Woche:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(["a", "b"] as const)
                .filter((p) => so.totals[p].count > 0)
                .map((p) => (
                  <li key={p} data-testid={`rb-ausschlafen-${p}`}>
                    {name[p]}: {wochenText(schlafWochen[p])}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Therapie-Aufgaben</h3>
        <div className="small">{tasksDone} {zeitraumWort} erledigt bzw. abgehakt · {tasksOpen} offen</div>

        {myDiary.days > 0 && (
          <>
            <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Mein ADHS-Tagebuch</h3>
            <div className="small">
              {myDiary.days} Tage eingetragen · Ø Konzentration {num(myDiary.averages.focus)} · Stimmung {num(myDiary.averages.mood)} · Schlaf {num(myDiary.averages.sleepQuality)}
              {myDiary.phases.length ? ` · Dosis: ${myDiary.phases.map((p) => (p.doseMg === null ? "–" : `${String(p.doseMg).replace(".", ",")} mg`)).join(" → ")}` : ""}
              {myDiary.sideEffects.length ? ` · Nebenwirkungen: ${myDiary.sideEffects.slice(0, 4).map((x) => `${x.name} ${x.count}×`).join(", ")}` : ""}
            </div>
            <div className="small muted no-print">Ausführlich: <Link href={`/privat/tagebuch/bericht?ab=${von}&bis=${end}`}>Bericht für den Arzttermin</Link></div>
          </>
        )}
      </section>
    </>
  );
}
