import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { avgOf, careOverview, dateStats, diaryReport, intimStats, kidsOverview, taskState, type CareTask, type DateEntry, type DiaryEntry, type IntimEntry, type KidsEntry, type MoodEntry, type SleepEntry, type TaskEntry, type ThanksEntry } from "@/lib/private/logic";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { PrintButton } from "@/components/print-button";
import { MonthNav, PrivatHead, hoursLabel, monthLabel, monthParam } from "../ui";

const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const num = (v: number | null) => (v === null ? "nicht erfasst" : String(v).replace(".", ","));
/** Anzahl · Stunden – oder „nicht erfasst“ (fehlende Einträge sind keine Null). */
const ch = (t: { count: number; hours: number }) => (t.count ? `${t.count}× · ${hoursLabel(t.hours)}` : "nicht erfasst");

/** Eine Seite je Monat – zum Ausdrucken oder als PDF für die Therapie. */
export default async function RueckblickPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const today = todayIso();
  const month = monthParam(sp.monat);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const end = last < today ? last : today;
  const s = await privateSettings(session.tenantId);
  const name = s.partners;
  const [intim, dates, kids, sleep, timeout, tasks, care, thanks, moods, diary] = await Promise.all([
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
  ]);
  const ist = intimStats(intim.map((e) => e.data), month, end);
  const ds = dateStats(dates.map((e) => e.data), month, end);
  const ko = kidsOverview(kids.map((e) => e.data), month);
  const so = kidsOverview(sleep.map((e) => e.data), month);
  const to = kidsOverview(timeout.map((e) => e.data), month);
  const careDone = { a: 0, b: 0 };
  for (const t of care) for (const d of t.data.done ?? []) if (d.day.startsWith(month)) careDone[d.by]++;
  const co = careOverview(care.map((e) => e.data), end);
  const tasksDone = tasks.filter((t) => (t.data.repeat === "einmal" ? t.data.done && (t.data.doneAt ?? "").startsWith(month) : (t.data.checks ?? []).some((d) => d.startsWith(month)))).length;
  const tasksOpen = tasks.filter((t) => taskState(t.data, end).open).length;
  const th = { a: thanks.filter((e) => e.data.from === "a" && e.data.day.startsWith(month)).length, b: thanks.filter((e) => e.data.from === "b" && e.data.day.startsWith(month)).length };
  const mood = { a: avgOf(moods.filter((e) => e.data.person === "a" && e.data.day.startsWith(month)).map((e) => e.data.value)), b: avgOf(moods.filter((e) => e.data.person === "b" && e.data.day.startsWith(month)).map((e) => e.data.value)) };
  const myDiary = diaryReport(diary.filter((e) => e.userId === session.userId).map((e) => e.data), `${month}-01`, end);

  const Row = ({ label, a, b, note }: { label: string; a: React.ReactNode; b: React.ReactNode; note?: React.ReactNode }) => (
    <tr><td>{label}</td><td className="num right">{a}</td><td className="num right">{b}</td><td className="small muted">{note}</td></tr>
  );

  return (
    <>
      <div className="no-print">
        <PrivatHead active="rueckblick" title="Monatsrückblick" pin={session.privatePin} month={month} sub={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <MonthNav path="/privat/rueckblick" month={month} />
            <PrintButton label="Drucken / PDF" />
          </div>
        } />
      </div>

      <section className="card card-pad stack" data-testid="review">
        <h2>Rückblick {monthLabel(month)}{end < last ? ` (bis ${end.slice(8, 10)}.${end.slice(5, 7)}.)` : ""}</h2>

        <h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Als Paar</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Nähe / Intimität: <strong>{ist.inMonth ? `${ist.inMonth}×` : "nicht erfasst"}</strong></li>
          <li>🥂 Paarzeit: <strong>{ds.inMonth ? `${ds.inMonth}×` : "nicht erfasst"}</strong>{ds.hoursInMonth ? `, ${hoursLabel(ds.hoursInMonth)}` : ""}{ds.costInMonth ? `, Babysitter ${euro(ds.costInMonth)}` : ""}</li>
          <li>💛 Wertschätzungen notiert: {th.a + th.b ? `${name.a} ${th.a ? `${th.a}×` : "keine notiert"} · ${name.b} ${th.b ? `${th.b}×` : "keine notiert"}` : "nicht erfasst"}</li>
          <li>Stimmung als Paar (Ø 1–5): {name.a} {num(mood.a)} · {name.b} {num(mood.b)}</li>
        </ul>

        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Erfasste Zeiten</h3>
        <div className="small muted">Nur was eingetragen ist – keine Bewertung, wer mehr leistet. Kinderzeit und Auszeit eines gemeinsamen Vorgangs zählen je in ihrer Zeile einmal.</div>
        <table className="table">
          <thead><tr><th></th><th className="right">{name.a}</th><th className="right">{name.b}</th><th></th></tr></thead>
          <tbody>
            <Row label="Allein mit den Kindern" a={ch(ko.totals.a)} b={ch(ko.totals.b)} />
            <Row label="Ausgeschlafen" a={ch(so.totals.a)} b={ch(so.totals.b)} />
            <Row label="Auszeit für sich" a={ch(to.totals.a)} b={ch(to.totals.b)} />
            <Row label="Familienaufgaben als erledigt eingetragen" a={careDone.a ? `${careDone.a}×` : "nicht erfasst"} b={careDone.b ? `${careDone.b}×` : "nicht erfasst"} note={`zuständig: ${co.owned.a} / ${co.owned.b}, beide ${co.owned.beide}, offen ${co.owned.offen}`} />
          </tbody>
        </table>

        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Therapie-Aufgaben</h3>
        <div className="small">{tasksDone} im Monat erledigt bzw. abgehakt · {tasksOpen} offen</div>

        {myDiary.days > 0 && (
          <>
            <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Mein ADHS-Tagebuch</h3>
            <div className="small">
              {myDiary.days} Tage eingetragen · Ø Konzentration {num(myDiary.averages.focus)} · Stimmung {num(myDiary.averages.mood)} · Schlaf {num(myDiary.averages.sleepQuality)}
              {myDiary.phases.length ? ` · Dosis: ${myDiary.phases.map((p) => (p.doseMg === null ? "–" : `${String(p.doseMg).replace(".", ",")} mg`)).join(" → ")}` : ""}
              {myDiary.sideEffects.length ? ` · Nebenwirkungen: ${myDiary.sideEffects.slice(0, 4).map((x) => `${x.name} ${x.count}×`).join(", ")}` : ""}
            </div>
            <div className="small muted no-print">Ausführlich: <Link href={`/privat/tagebuch/bericht?ab=${month}-01&bis=${end}`}>Bericht für den Arzttermin</Link></div>
          </>
        )}
      </section>
    </>
  );
}
