import { loadEntries, requirePrivate } from "@/lib/private/service";
import { PrivatHead, dmy } from "../ui";
import { schulbriefHochladenAction, schulbriefUebernehmenAction, type Schulbrief } from "./actions";

// Briefe von Schule/Kita per Foto (Modul 8): hochladen → Vorschläge prüfen → in Privatkalender/Privat-Aufgaben.

export default async function SchulbriefePage({ searchParams }: { searchParams: Promise<{ meldung?: string; brief?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const briefe = (await loadEntries<Schulbrief>(session, ["schulbrief"])).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const aktiv = briefe.find((b) => b.id === sp.brief) ?? briefe.find((b) => b.data.vorschlaege.some((v) => !v.uebernommen)) ?? briefe[0];
  return (
    <>
      <PrivatHead active="schulbriefe" title="Briefe von Schule & Kita" />
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="sb-meldung">{sp.meldung}</div>}
      <section className="card card-pad" style={{ marginBottom: 12 }}>
        <form action={schulbriefHochladenAction} className="stack" style={{ gap: 8 }} data-testid="sb-upload">
          <label className="label" htmlFor="sb-datei">Foto oder PDF des Briefs</label>
          <input className="input" id="sb-datei" name="datei" type="file" accept="image/*,application/pdf" capture="environment" required />
          <div><button className="btn btn-primary btn-small" type="submit">Hochladen und lesen</button></div>
          <div className="small muted">Das Original wird verschlüsselt gespeichert und am Termin verlinkt. Die KI schlägt Termine und Aufgaben vor – übernommen wird erst nach deiner Auswahl.</div>
        </form>
      </section>
      {aktiv && (
        <section className="card card-pad stack" style={{ marginBottom: 12 }} data-testid="sb-vorschlaege">
          <div className="between"><h2 style={{ margin: 0 }}>{aktiv.data.name}</h2><a className="small" href={`/privat/schulbriefe/${aktiv.id}/original`} target="_blank" rel="noopener">Original ansehen</a></div>
          {aktiv.data.hinweis && <div className="notice notice-info small">{aktiv.data.hinweis}</div>}
          {aktiv.data.vorschlaege.length > 0 && (
            <form action={schulbriefUebernehmenAction} className="stack" style={{ gap: 6 }}>
              <input type="hidden" name="id" value={aktiv.id} />
              {aktiv.data.vorschlaege.map((v, i) => (
                <div key={i} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="sb-vorschlag">
                  <input type="checkbox" name="nr" value={i} defaultChecked={!v.uebernommen} disabled={Boolean(v.uebernommen)} aria-label="übernehmen" />
                  <span className="tag">{v.art === "termin" ? "Termin" : "Aufgabe"}</span>
                  <input className="input" name={`titel-${i}`} defaultValue={v.titel} aria-label="Titel" style={{ minWidth: 220, flexGrow: 1 }} disabled={Boolean(v.uebernommen)} />
                  <input className="input" type="date" name={`tag-${i}`} defaultValue={v.tag ?? ""} aria-label="Tag" style={{ width: 150 }} disabled={Boolean(v.uebernommen)} />
                  <span className="small muted">{[v.uhrzeit, v.kind, v.notiz].filter(Boolean).join(" · ")}{v.uebernommen ? " · übernommen ✓" : ""}</span>
                </div>
              ))}
              <div><button className="btn btn-primary btn-small" type="submit">Ausgewählte übernehmen</button></div>
            </form>
          )}
        </section>
      )}
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table small" data-testid="sb-liste">
          <thead><tr><th>Hochgeladen</th><th>Brief</th><th>Vorschläge</th></tr></thead>
          <tbody>
            {briefe.length === 0 && <tr><td colSpan={3} className="muted">Noch keine Briefe.</td></tr>}
            {briefe.map((b) => (
              <tr key={b.id}><td className="num">{dmy(b.data.hochgeladen)}</td><td><a href={`/privat/schulbriefe?brief=${b.id}`}>{b.data.name}</a></td><td>{b.data.vorschlaege.filter((v) => v.uebernommen).length}/{b.data.vorschlaege.length} übernommen</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
