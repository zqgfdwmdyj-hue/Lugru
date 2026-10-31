import Link from "next/link";
import { AM_ZUG_TEXT, type AmZug } from "@/lib/recht/logic";
import type { RechtsEintrag, Rechtsfall } from "@/lib/recht/service";
import { entwurfAction, erledigtAction, zuordnenAction } from "./actions";

// Gemeinsame Ansicht für Rechtsfälle – geschäftlich (/rechtsfaelle, nur Inhaber) und privat (/privat/rechtsfaelle).

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const datum = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const ART_TEXT: Record<RechtsEintrag["art"], string> = { kommentar: "Kommentar (Asana)", mail: "Mail", frist: "Frist", status: "Status", entwurf: "Entwurf an Anwalt", notiz: "Notiz" };

export function FallListe({ faelle, basis, heute }: { faelle: Rechtsfall[]; basis: string; heute: string }) {
  if (!faelle.length) return <p className="muted small">Noch keine Fälle. Sobald Asana eingerichtet ist oder eine Mail vom Anwalt kommt, erscheinen sie hier.</p>;
  return (
    <div className="table-wrap">
      <table className="table" data-testid="rechtsfaelle-liste">
        <thead>
          <tr><th>Fall</th><th>Status</th><th>Am Zug</th><th>Nächste Frist</th><th>Letzte Bewegung</th></tr>
        </thead>
        <tbody>
          {faelle.map((f) => (
            <tr key={f.id}>
              <td>
                <Link href={`${basis}/${f.id}`}>{f.titel}</Link>
                <div className="small muted">{[f.aktenzeichen ? `Az. ${f.aktenzeichen}` : null, f.firma, f.quelle === "asana" ? "Asana" : f.quelle === "mail" ? "aus Mail" : "von Hand"].filter(Boolean).join(" · ")}</div>
              </td>
              <td>{f.status === "zuordnen" ? <span className="tag tag-warn">bitte zuordnen</span> : f.abgeschlossen ? <span className="tag tag-neutral">abgeschlossen</span> : f.status}</td>
              <td>{f.amZug === "wir" ? <span className="tag tag-danger">wir</span> : AM_ZUG_TEXT[f.amZug as AmZug]}</td>
              <td>{f.naechsteFrist ? <span className={f.naechsteFrist <= heute ? "danger" : undefined}>{dmy(f.naechsteFrist)}</span> : "–"}</td>
              <td className="small">{f.letzteBewegung ? datum(f.letzteBewegung) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FallDetail({ fall, verlauf, anwalt, privat, inhaber }: { fall: Rechtsfall; verlauf: RechtsEintrag[]; anwalt: string | null; privat: boolean; inhaber: boolean }) {
  const entwuerfe = verlauf.filter((e) => e.art === "entwurf");
  return (
    <div className="stack" data-testid="rechtsfall">
      <section className="card card-pad">
        <dl className="grid-2" style={{ gap: 8, margin: 0 }}>
          <div><dt className="small muted">Aktenzeichen</dt><dd style={{ margin: 0 }}>{fall.aktenzeichen ?? "–"}</dd></div>
          <div><dt className="small muted">Bereich</dt><dd style={{ margin: 0 }}>{fall.bereich === "privat" ? "privat" : `geschäftlich${fall.firma ? ` (${fall.firma})` : ""}`}</dd></div>
          <div><dt className="small muted">Status</dt><dd style={{ margin: 0 }} data-testid="rechtsfall-status">{fall.status}</dd></div>
          <div><dt className="small muted">Am Zug</dt><dd style={{ margin: 0 }} data-testid="rechtsfall-amzug">{AM_ZUG_TEXT[fall.amZug as AmZug]}</dd></div>
          <div><dt className="small muted">Nächste Frist</dt><dd style={{ margin: 0 }} data-testid="rechtsfall-frist">{dmy(fall.naechsteFrist)}{fall.fristText ? <div className="small muted">{fall.fristText}</div> : null}</dd></div>
          <div><dt className="small muted">Letzte Bewegung</dt><dd style={{ margin: 0 }}>{fall.letzteBewegung ? datum(fall.letzteBewegung) : "–"}</dd></div>
        </dl>
        {fall.letzterStand && <p style={{ marginBottom: 0 }}><strong>Letzter Stand:</strong> {fall.letzterStand}</p>}
        {fall.gegenstand && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{fall.gegenstand.slice(0, 1500)}</p>}
        {fall.asanaUrl && <p className="small" style={{ marginBottom: 0 }}><a href={fall.asanaUrl} target="_blank" rel="noreferrer">In Asana öffnen</a> (nur lesen – das System schreibt nichts nach Asana)</p>}
        <p className="small muted" style={{ marginBottom: 0 }}>Keine Rechtsberatung – nur Ordnung: Fristen und Stand laut Anwalt.</p>
      </section>

      {fall.status === "zuordnen" || inhaber ? (
        <section className="card card-pad">
          <h2 style={{ marginTop: 0 }}>Zuordnen</h2>
          <form action={zuordnenAction} className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }} data-testid="rechtsfall-zuordnen">
            <input type="hidden" name="id" value={fall.id} />
            <div className="field"><label className="label" htmlFor="rf-bereich">Bereich</label><select className="input" id="rf-bereich" name="bereich" defaultValue={fall.bereich}><option value="privat">privat</option>{inhaber && <option value="geschaeft">geschäftlich</option>}</select></div>
            <div className="field"><label className="label" htmlFor="rf-firma">Firma (geschäftlich)</label><input className="input" id="rf-firma" name="firma" defaultValue={fall.firma ?? ""} placeholder="LuGru, WiGru, W&G" maxLength={40} /></div>
            <button className="btn" type="submit">Speichern</button>
          </form>
          {privat && <p className="small muted" style={{ marginBottom: 0 }}>Private Fälle bleiben im Privatbereich; im Morgenbericht steht nur die Anzahl der Fristen.</p>}
        </section>
      ) : null}

      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Mail an den Anwalt (Entwurf)</h2>
        <form action={entwurfAction} className="stack" style={{ gap: 8 }} data-testid="rechtsfall-entwurf">
          <input type="hidden" name="id" value={fall.id} />
          <textarea className="input" name="text" rows={4} required maxLength={8000} placeholder="Was soll der Anwalt wissen oder tun?" />
          <div><button className="btn" type="submit">Entwurf speichern</button> <span className="small muted">Wird nie automatisch gesendet{anwalt ? "" : " – Anwalts-Adresse fehlt noch (Einstellungen auf der Seite „Rechtsfälle“)"}.</span></div>
        </form>
        {entwuerfe.slice(0, 3).map((e) => {
          const [kopf, ...rest] = e.text.split("\n\n");
          const betreff = /Betreff: (.*)/.exec(kopf)?.[1] ?? fall.titel;
          const body = rest.join("\n\n");
          return (
            <div key={e.id} className="notice notice-info small" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
              {e.text.slice(0, 1200)}
              {anwalt && <div style={{ marginTop: 6 }}><a className="btn btn-small" href={`mailto:${anwalt}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`}>Im Mailprogramm öffnen</a></div>}
            </div>
          );
        })}
      </section>

      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Verlauf</h2>
        {verlauf.length === 0 && <p className="muted small">Noch nichts.</p>}
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }} data-testid="rechtsfall-verlauf">
          {verlauf.map((e) => (
            <li key={e.id} className="small">
              <strong>{datum(e.datum)} · {ART_TEXT[e.art]}</strong>
              {e.art === "mail" ? (
                <details><summary>{/Betreff: (.*)/.exec(e.text)?.[1] ?? "Mail"}</summary><div style={{ whiteSpace: "pre-wrap" }}>{e.text.slice(0, 6000)}</div></details>
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{e.text.slice(0, 2000)}</div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {fall.quelle !== "asana" && !fall.abgeschlossen && (
        <form action={erledigtAction}>
          <input type="hidden" name="id" value={fall.id} />
          <button className="btn btn-small" type="submit">Fall abschließen</button>
        </form>
      )}
    </div>
  );
}
