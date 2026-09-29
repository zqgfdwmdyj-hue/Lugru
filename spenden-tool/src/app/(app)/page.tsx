import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireLogin } from "@/lib/auth";
import { formatDate, formatEuro } from "@/lib/numbers";
import { createEvent } from "./actions";

export default async function SpendenPage() {
  await requireLogin();
  const E = schema.events;
  const [events, [stats]] = await Promise.all([
    db
      .select({
        e: E,
        items: sql<number>`(select count(*)::int from event_items i where i.event_id = events.id)`,
        value: sql<number | null>`(select sum(i.price * coalesce(i.quantity, 0))::float from event_items i where i.event_id = events.id)`,
      })
      .from(E)
            .orderBy(desc(E.eventDate), desc(E.createdAt))
      .limit(100),
    db.select({ products: sql<number>`count(*)::int` }).from(schema.products).where(eq(schema.products.archived, false)),
  ]);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const nextSat = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  })();
  const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short" });

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lebensmittelverteilung</div><h1>Verteilungen</h1></div>
        <Link href="/produkte" className="btn">Produkte ({stats.products})</Link>
      </div>
      <div className="row">
        <section className="card" style={{ flexGrow: 1, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Datum</th><th>Titel</th><th className="right">Produkte</th><th className="right">Warenwert*</th><th></th></tr></thead>
            <tbody>
              {events.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Verteilung. Rechts die erste anlegen – danach Fotos hochladen, Preise eintragen, Collage und Aushang erzeugen.</td></tr>}
              {events.map(({ e, items, value }) => (
                <tr key={e.id}>
                  <td className="num">{weekday(e.eventDate)} {formatDate(e.eventDate)}{e.eventTime ? <span className="muted"> · {e.eventTime}</span> : null}{e.eventDate >= today ? <span className="chip" style={{ marginLeft: 8, padding: "1px 8px", fontSize: 11 }}>geplant</span> : null}</td>
                  <td><Link href={`/verteilung/${e.id}`}>{e.title}</Link>{e.location ? <span className="small muted"> · {e.location}</span> : null}</td>
                  <td className="num right">{items}</td>
                  <td className="num right">{value ? formatEuro(value) : "–"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link href={`/verteilung/${e.id}/collage`} className="btn btn-small">Collage</Link>{" "}
                    <Link href={`/aushang/${e.id}`} className="btn btn-small" target="_blank">Aushang</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ padding: "8px 14px" }}>* Preis × eingetragene Menge – nur wenn Mengen gepflegt werden.</div>
        </section>
        <aside className="col-side">
          <form action={createEvent} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Neue Verteilung</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="field"><label className="label" htmlFor="ed">Datum</label><input className="input" id="ed" name="eventDate" type="date" required defaultValue={nextSat} /></div>
              <div className="field"><label className="label" htmlFor="et">Uhrzeit</label><input className="input" id="et" name="eventTime" placeholder="11 Uhr" /></div>
            </div>
            <div className="field"><label className="label" htmlFor="ti">Überschrift</label><input className="input" id="ti" name="title" defaultValue="Unsere Spendenempfehlungen" /></div>
            <div className="field"><label className="label" htmlFor="st">Unterzeile</label><input className="input" id="st" name="subtitle" defaultValue="Dank eurer Spenden können wir retten!" /></div>
            <div className="field"><label className="label" htmlFor="lo">Ort (optional)</label><input className="input" id="lo" name="location" /></div>
            <div className="field">
              <label className="label" htmlFor="cf">Produkte übernehmen von</label>
              <select className="select" id="cf" name="copyFrom" defaultValue="">
                <option value="">– leer beginnen –</option>
                {events.slice(0, 30).map(({ e, items }) => <option key={e.id} value={e.id}>{formatDate(e.eventDate)} · {e.title} ({items})</option>)}
              </select>
            </div>
            <button className="btn btn-primary" type="submit">Anlegen</button>
          </form>
          <div className="card card-pad small muted stack" style={{ gap: 6 }}>
            <strong style={{ color: "var(--ink)" }}>So geht’s</strong>
            <div>1. Verteilung anlegen (oder die letzte übernehmen).</div>
            <div>2. Fotos auf einmal hochladen – jedes Foto wird ein Produkt. Wiederkehrende Produkte aus der Datenbank dazunehmen.</div>
            <div>3. Namen und Preise eintragen. Der Preis wird für das nächste Mal gemerkt.</div>
            <div>4. Collage-Bilder erzeugen und teilen, Aushang drucken, Text für den Messenger kopieren.</div>
          </div>
        </aside>
      </div>
    </>
  );
}
