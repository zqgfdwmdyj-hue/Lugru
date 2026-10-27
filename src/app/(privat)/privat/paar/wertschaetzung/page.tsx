import { todayIso } from "@/lib/dates";
import { avgOf, moodSeries, type MoodEntry, type ThanksEntry } from "@/lib/private/logic";
import { loadEntries, myPartner, privateSettings, requirePrivate } from "@/lib/private/service";
import { addThanksAction, deleteEntryAction, saveMoodAction } from "../../actions";
import { StateForm } from "../../state-form";
import { PrivatHead, Rating, dm } from "../../ui";
import { WhoAmI } from "../../who-am-i";

/** Partnerschaft → Wertschätzung und „Wie geht’s uns?“. */
export default async function WertschaetzungPage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const s = await privateSettings(session.tenantId);
  const me = myPartner(s, session);
  const thanks = (await loadEntries<ThanksEntry>(session, ["danke"])).sort((a, b) => b.data.day.localeCompare(a.data.day) || b.createdAt.getTime() - a.createdAt.getTime());
  const moods = await loadEntries<MoodEntry>(session, ["stimmung"]);
  const myMood = moods.find((e) => e.userId === session.userId && e.data.day === today)?.data;
  const moodToday = { a: moods.find((e) => e.data.person === "a" && e.data.day === today)?.data.value, b: moods.find((e) => e.data.person === "b" && e.data.day === today)?.data.value };

  return (
    <>
      <PrivatHead active="danke" title="💛 Wertschätzung" pin={session.privatePin} />
      {!me && <WhoAmI partners={s.partners} account={session.name ?? session.email} tenantId={session.tenantId} userId={session.userId} userPartner={s.userPartner} />}

      <section className="card card-pad stack" id="danke">
        <h2>Was ich heute geschätzt habe</h2>
        <div className="small muted">Kleine Dinge gleich notieren, sonst vergisst man sie. Beim Paar-Gespräch stehen sie schon drin.</div>
        <StateForm action={addThanksAction} submit={me ? `Notieren (${me === "a" ? `${s.partners.a} über ${s.partners.b}` : `${s.partners.b} über ${s.partners.a}`})` : "Notieren (erst oben festlegen, wer du bist)"} testid="thanks-form" className="">
          <input className="input" name="text" required placeholder="z. B. hat mir heute Abend den Rücken freigehalten" autoComplete="off" />
        </StateForm>
        {thanks.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="thanks-list">
            {thanks.slice(0, 20).map((t) => (
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
          <Rating name="value" label={`Heute (${me === "a" ? s.partners.a : me === "b" ? s.partners.b : "wer du bist, oben festlegen"})`} low="schwierig" high="sehr gut" value={myMood?.value} />
          <input className="input" name="note" placeholder="Warum? (optional)" defaultValue={myMood?.note ?? ""} autoComplete="off" />
        </StateForm>
        <div className="small muted" data-testid="mood-today">
          Heute: {s.partners.a} {moodToday.a ? `${moodToday.a}/5` : "nicht erfasst"} · {s.partners.b} {moodToday.b ? `${moodToday.b}/5` : "nicht erfasst"}
        </div>
        <div className="priv-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
          {(["a", "b"] as const).map((k) => {
            const series = moodSeries(moods.map((e) => e.data), k, today, 30);
            const avg = avgOf(series.map((p) => p.value));
            return (
              <figure key={k} style={{ margin: 0, minWidth: 0 }}>
                <figcaption className="small" style={{ display: "flex", justifyContent: "space-between" }}><span>{k === "a" ? s.partners.a : s.partners.b}</span><span className="muted">Ø {avg === null ? "nicht erfasst" : String(avg).replace(".", ",")}</span></figcaption>
                <div className="spark" role="img" aria-label={`Stimmung ${k === "a" ? s.partners.a : s.partners.b}, letzte 30 Tage, Durchschnitt ${avg ?? "nicht erfasst"}`}>
                  {series.map((p) => <i key={p.day} className={p.value === null ? "empty" : ""} style={{ height: p.value === null ? "100%" : `${(p.value / 5) * 100}%` }} title={`${dm(p.day)}: ${p.value ?? "nicht erfasst"}`} />)}
                </div>
                <div className="small muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{dm(series[0].day)}</span><span>heute</span></div>
              </figure>
            );
          })}
        </div>
        <div className="small muted">Graue Tage = nicht erfasst. Jede Person sieht ihre eigene Einschätzung – kein Vergleich, wer „recht“ hat.</div>
      </section>
    </>
  );
}
