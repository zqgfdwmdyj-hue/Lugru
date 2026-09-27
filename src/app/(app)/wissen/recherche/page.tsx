import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { formatDate } from "@/lib/numbers";
import { getResearchSettings, recentResearch } from "@/lib/research/service";
import { saveResearch } from "./actions";
import { RunButton } from "./run-button";

export default async function RecherchePage() {
  const session = await requireSession();
  const [s, recent, ai] = await Promise.all([getResearchSettings(session.tenantId), recentResearch(session.tenantId, 40), getIntegration(session.tenantId, "anthropic")]);
  const next = s.lastRun ? new Date(Date.parse(s.lastRun) + s.intervalDays * 86400_000) : null;
  const when = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/wissen">Wissen</Link></div>
          <h1>Themen-Recherche</h1>
        </div>
        <Link className="btn" href="/wissen?kat=Recherche">Gefundenes ansehen</Link>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 780 }}>
        Alle {s.intervalDays} Tage sucht das System nach neuen Meldungen zu deinen Themen (Google News, deutschsprachig) und in deinen eigenen Feeds.
        Je Thema entsteht ein Eintrag in der Wissensdatenbank unter „Recherche“ – mit Links zu den Artikeln{ai?.apiKey ? " und einer KI-Zusammenfassung" : ""}.
        Schon Bekanntes wird übersprungen.
      </p>

      <div className="row">
        <form action={saveResearch} className="card card-pad stack" style={{ flexGrow: 1, minWidth: 0, gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="topics">Themen – eins pro Zeile</label>
            <textarea className="textarea" id="topics" name="topics" defaultValue={s.topics.join("\n")} style={{ minHeight: 200 }} />
            <span className="small muted">Wie eine Suche: „Amazon Private Label“, „Immobilien Zinsen“, „Aktien Dividenden“ … Mit Anführungszeichen sucht Google nach dem genauen Begriff.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="feeds">Eigene Feeds (RSS/Atom) – eine Adresse pro Zeile, optional</label>
            <textarea className="textarea" id="feeds" name="feeds" defaultValue={s.feeds.join("\n")} style={{ minHeight: 90, fontFamily: "var(--mono)", fontSize: 12 }} placeholder="https://www.example.de/feed/" />
            <span className="small muted">Z. B. der Blog eines Tools, ein Podcast oder ein Branchen-Newsletter mit Feed.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="intervalDays">Suchen alle</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input className="input" id="intervalDays" name="intervalDays" type="number" min={1} max={30} defaultValue={s.intervalDays} style={{ width: 80 }} />
              <span className="small muted">Tage</span>
            </div>
          </div>
          <div><button className="btn btn-primary" type="submit">Speichern</button></div>
        </form>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Stand</h2>
            <div className="small">
              {s.lastRun ? <>Zuletzt gesucht: {when(new Date(s.lastRun))}<br />Nächste Suche: ab {when(next!)}</> : "Noch nie gesucht – die erste Suche läuft beim nächsten Hintergrund-Abruf."}
            </div>
            {s.lastError && <div className="notice notice-warn small">{s.lastError}</div>}
            <RunButton />
          </section>
          <section className="card card-pad stack">
            <h2>KI-Zusammenfassung</h2>
            <div className="small muted">
              {ai?.apiKey
                ? "Aktiv – je Thema fasst Claude die neuen Meldungen in Stichpunkten zusammen (nur aus Titel und Kurztext, mit Quellennummern)."
                : "Optional: Mit einem Claude-API-Schlüssel (Anbindungen → KI) steht über jeder Artikelliste eine kurze Zusammenfassung. Ohne Schlüssel gibt es nur die Liste."}
            </div>
            {session.role === "owner" && <Link className="small" href="/anbindungen?p=anthropic#anthropic">Anbindungen → KI</Link>}
          </section>
        </aside>
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Zuletzt gefunden</h2></div>
        {recent.length === 0 ? (
          <div className="card-pad muted">Noch nichts gefunden.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Thema</th><th>Artikel</th><th>Quelle</th><th>Datum</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.topic}</td>
                  <td><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>{r.knowledgeId && <> · <Link className="small" href={`/wissen/${r.knowledgeId}`}>Eintrag</Link></>}</td>
                  <td className="small muted">{r.source ?? "–"}</td>
                  <td className="num small">{r.publishedAt ? formatDate(r.publishedAt.toISOString()) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
