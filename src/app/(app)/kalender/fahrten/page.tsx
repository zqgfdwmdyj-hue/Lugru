import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { fahrtenListe } from "@/lib/mobil/fahrten";
import { abrufenAction, fahrtAction, wocheAction } from "./actions";

// Fahrtenbuch (B13): Fahrten aus dem Tesla mit Vorschlag geschäftlich/privat; Wochenliste zum Bestätigen, CSV.

const montag = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
};
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function FahrtenPage({ searchParams }: { searchParams: Promise<{ woche?: string; meldung?: string }> }) {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/kalender");
  const sp = await searchParams;
  const woche = /^\d{4}-\d{2}-\d{2}$/.test(sp.woche ?? "") ? montag(sp.woche!) : montag(todayIso());
  const von = new Date(`${woche}T00:00:00Z`);
  const liste = await fahrtenListe(session.tenantId, von, new Date(von.getTime() + 7 * 86_400_000));
  const km = (a: "geschaeftlich" | "privat") => liste.filter((f) => (f.art ?? f.vorschlag) === a).reduce((n, f) => n + f.km, 0);
  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/kalender">Kalender</Link></div><h1>Fahrtenbuch</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <div className="notice notice-info small" style={{ marginBottom: 12 }}>Ob Fahrtenbuch oder Pauschale steuerlich besser ist, klärt der Steuerberater – das System berät nicht. Ein ordnungsgemäßes Fahrtenbuch hat eigene Anforderungen; vor der Nutzung mit dem Steuerberater abstimmen.</div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link className="btn btn-small" href={`/kalender/fahrten?woche=${plus(woche, -7)}`}>← Vorwoche</Link>
        <strong style={{ alignSelf: "center" }}>Woche ab {woche.slice(8, 10)}.{woche.slice(5, 7)}.</strong>
        <Link className="btn btn-small" href={`/kalender/fahrten?woche=${plus(woche, 7)}`}>Folgewoche →</Link>
        <form action={abrufenAction}><input type="hidden" name="woche" value={woche} /><button className="btn btn-small" type="submit">Fahrten holen</button></form>
        <form action={wocheAction}><input type="hidden" name="woche" value={woche} /><button className="btn btn-small btn-primary" type="submit">Alle Vorschläge bestätigen</button></form>
        <a className="btn btn-small" href={`/kalender/fahrten/csv?woche=${woche}`}>CSV</a>
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>Geschäftlich {km("geschaeftlich").toFixed(1).replace(".", ",")} km · privat {km("privat").toFixed(1).replace(".", ",")} km</div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table small" data-testid="fahrten-liste">
          <thead><tr><th>Wann</th><th>Ziel</th><th className="num">km</th><th>Art / Zweck</th><th /></tr></thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={5} className="muted">Keine Fahrten in dieser Woche.</td></tr>}
            {liste.map((f) => {
              const art = f.art ?? f.vorschlag;
              return (
                <tr key={f.id}>
                  <td>{zeit(f.beginn)}</td>
                  <td>{art === "privat" ? "privat" : (f.ziel ?? "–")}</td>
                  <td className="num">{String(f.km).replace(".", ",")}</td>
                  <td colSpan={2}>
                    <form action={fahrtAction} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="woche" value={woche} />
                      <select className="input" name="art" defaultValue={art} aria-label="Art" style={{ width: 140 }}><option value="geschaeftlich">geschäftlich</option><option value="privat">privat</option></select>
                      <input className="input" name="zweck" defaultValue={f.zweck ?? ""} placeholder="Zweck" aria-label="Zweck" style={{ minWidth: 160 }} />
                      <button className="btn btn-small" type="submit">{f.bestaetigtAt ? "ändern" : "bestätigen"}</button>
                      {!f.bestaetigtAt && <span className="tag">Vorschlag</span>}
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
