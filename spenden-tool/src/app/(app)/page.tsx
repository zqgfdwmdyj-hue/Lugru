import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireLogin } from "@/lib/auth";
import { formatDate } from "@/lib/numbers";
import { createEvent } from "./actions";
import { InstallHint } from "@/components/install-hint";

type Row = { e: typeof schema.events.$inferSelect; items: number; noPrice: number; unconfirmed: number; noOutcome: number };

export default async function SpendenPage({ searchParams }: { searchParams: Promise<{ archiv?: string }> }) {
  await requireLogin();
  const sp = await searchParams;
  const E = schema.events;
  const [events, [stats]] = await Promise.all([
    db
      .select({
        e: E,
        items: sql<number>`(select count(*)::int from event_items i where i.event_id = events.id)`,
        noPrice: sql<number>`(select count(*)::int from event_items i where i.event_id = events.id and i.price is null)`,
        unconfirmed: sql<number>`(select count(*)::int from event_items i where i.event_id = events.id and i.price is not null and not i.price_confirmed)`,
        noOutcome: sql<number>`(select count(*)::int from event_items i where i.event_id = events.id and i.outcome is null)`,
      })
      .from(E)
      .orderBy(desc(E.eventDate), desc(E.createdAt))
      .limit(300),
    db.select({ products: sql<number>`count(*)::int` }).from(schema.products).where(eq(schema.products.archived, false)),
  ]);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  /** Nächster Samstag nach dem Datum. */
  const saturdayAfter = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  };
  const nextSat = saturdayAfter(today);
  const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short" });
  const current = events.filter((r) => r.e.eventDate >= today).reverse();
  const past = events.filter((r) => r.e.eventDate < today);
  const allPast = sp.archiv === "alle";
  const archive = allPast ? past : past.slice(0, 8);
  const latest = events[0];
  // Letzte vergangene Verteilungen mit offenen Ergebnissen (höchstens zwei, jüngste zuerst)
  const followUp = past.filter((r) => r.items > 0 && r.noOutcome > 0).slice(0, 2);
  // „Letzte übernehmen“: am Samstag nach der letzten (bzw. nach heute, wenn die letzte vorbei ist).
  const copyDate = latest ? saturdayAfter(latest.e.eventDate > today ? latest.e.eventDate : today) : nextSat;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Lebensmittelverteilung</div><h1>Verteilungen</h1></div>
        <div className="head-actions">
          {latest && (
            <form action={createEvent}>
              <input type="hidden" name="eventDate" value={copyDate} />
              <input type="hidden" name="eventTime" value={latest.e.eventTime ?? ""} />
              <input type="hidden" name="title" value={latest.e.title} />
              <input type="hidden" name="subtitle" value={latest.e.subtitle ?? ""} />
              <input type="hidden" name="location" value={latest.e.location ?? ""} />
              <input type="hidden" name="copyFrom" value={latest.e.id} />
              <button className="btn" type="submit" title={`Neue Verteilung am ${formatDate(copyDate)} mit allen Produkten und Preisen vom ${formatDate(latest.e.eventDate)} – Bestand und Ergebnisse werden nicht übernommen`}>
                ↻ Letzte übernehmen ({latest.items})
              </button>
            </form>
          )}
          <Link href="/produkte" className="btn">Produkte ({stats.products})</Link>
        </div>
      </div>
      <InstallHint />

      <details className="card new-event" open={events.length === 0 || undefined}>
        <summary className="btn btn-primary">+ Neue Verteilung</summary>
        <form action={createEvent} className="stack" style={{ gap: 10, padding: "14px 0 4px" }}>
          <div className="form-grid">
            <div className="field"><label className="label" htmlFor="ed">Datum</label><input className="input" id="ed" name="eventDate" type="date" required defaultValue={nextSat} /></div>
            <div className="field"><label className="label" htmlFor="et">Uhrzeit</label><input className="input" id="et" name="eventTime" placeholder="11 Uhr" defaultValue={latest?.e.eventTime ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="lo">Ort (optional)</label><input className="input" id="lo" name="location" defaultValue={latest?.e.location ?? ""} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label className="label" htmlFor="ti">Überschrift</label><input className="input" id="ti" name="title" defaultValue="Unsere Spendenempfehlungen" /></div>
            <div className="field"><label className="label" htmlFor="st">Unterzeile</label><input className="input" id="st" name="subtitle" defaultValue="Dank eurer Spenden können wir retten!" /></div>
          </div>
          <div className="field">
            <label className="label" htmlFor="cf">Produkte übernehmen von</label>
            <select className="select" id="cf" name="copyFrom" defaultValue="">
              <option value="">– leer beginnen –</option>
              {events.slice(0, 30).map(({ e, items }) => <option key={e.id} value={e.id}>{formatDate(e.eventDate)} · {e.title} ({items})</option>)}
            </select>
            <span className="small muted">Übernommen werden Produkte, Preise, Einheiten und Packungsangaben. Bestand und Ergebnisse („Wie lief es?“) gehören zur jeweiligen Verteilung und werden nicht übernommen.</span>
          </div>
          <div><button className="btn btn-primary" type="submit">Anlegen</button></div>
        </form>
      </details>

      {events.length === 0 && (
        <div className="card card-pad small muted stack" style={{ gap: 6 }}>
          <strong style={{ color: "var(--ink)" }}>So geht’s</strong>
          <div>1. Verteilung anlegen (oder später die letzte übernehmen).</div>
          <div>2. Fotos auf einmal hochladen – jedes Foto wird ein Produkt. Wiederkehrende Produkte aus der Datenbank dazunehmen.</div>
          <div>3. Unter „Prüfen“ Namen, Preise und Abgabeeinheiten klären.</div>
          <div>4. Unter „Ausgabe“ Collage, Aushang, Messenger-Text und Social Media erzeugen.</div>
        </div>
      )}

      {current.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>Aktuell & geplant</h2>
          <div className="event-cards">{current.map((r) => <EventCard key={r.e.id} r={r} weekday={weekday(r.e.eventDate)} upcoming={r.e.eventDate > today} />)}</div>
        </section>
      )}

      {followUp.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2>Nachbereitung: Wie lief es?</h2>
          <div className="small muted">Für diese Verteilungen fehlen noch Ergebnisse (alles weg / wenig übrig / viel übrig) – Grundlage der Statistik.</div>
          <div className="event-cards">{followUp.map((r) => <EventCard key={r.e.id} r={r} weekday={weekday(r.e.eventDate)} />)}</div>
        </section>
      )}

      {past.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="between"><h2>Archiv</h2><span className="small muted">{past.length} frühere Verteilungen</span></div>
          <div className="card archive-list">
            {archive.map((r) => (
              <Link key={r.e.id} href={`/verteilung/${r.e.id}`} className="archive-row">
                <span className="num">{weekday(r.e.eventDate)} {formatDate(r.e.eventDate)}</span>
                <span className="archive-title">{r.e.title}{r.e.location ? <span className="muted"> · {r.e.location}</span> : null}</span>
                <span className="small muted">{r.items} Produkte{r.items > 0 ? (r.noOutcome ? ` · ${r.noOutcome} ohne Ergebnis` : " · Ergebnisse ✓") : ""}</span>
              </Link>
            ))}
          </div>
          {past.length > archive.length && <Link href="/?archiv=alle" className="small">Alle {past.length} anzeigen</Link>}
        </section>
      )}
    </>
  );
}

function EventCard({ r, weekday, upcoming }: { r: Row; weekday: string; upcoming?: boolean }) {
  const { e } = r;
  const base = `/verteilung/${e.id}`;
  const open = r.noPrice + r.unconfirmed;
  return (
    <div className="card event-card">
      <Link href={base} className="event-card-main">
        <span className="event-date">{weekday} {formatDate(e.eventDate)}{e.eventTime ? ` · ${e.eventTime}` : ""}</span>
        <strong className="wrap-anywhere">{e.title}</strong>
        <span className="small muted">{e.location ? `${e.location} · ` : ""}{r.items} Produkte</span>
        <span>
          {upcoming && <span className="tag tag-info">geplant</span>}{" "}
          {r.items > 0 && (open ? <span className="tag tag-warn">{r.noPrice ? `${r.noPrice} ohne Preis` : ""}{r.noPrice && r.unconfirmed ? " · " : ""}{r.unconfirmed ? `${r.unconfirmed} unbestätigt` : ""}</span> : <span className="tag tag-ok">✓ Preise vollständig</span>)}
        </span>
      </Link>
      <div className="event-card-actions">
        <Link href={base} className="btn btn-small btn-primary">Produkte</Link>
        <Link href={`${base}/pruefen`} className="btn btn-small">Prüfen</Link>
        <Link href={`${base}/ausgabe`} className="btn btn-small">Ausgabe</Link>
        {!upcoming && r.items > 0 && <Link href={`${base}/ergebnisse`} className="btn btn-small">Ergebnisse ({r.items - r.noOutcome}/{r.items})</Link>}
      </div>
    </div>
  );
}
