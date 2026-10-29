import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { callsListe } from "@/lib/calls/service";
import { getIntegration } from "@/lib/integrations/store";
import { callImportAction, discordImportAction } from "./actions";

// Call-Archiv: Calls mit dem Amazon-Consultant, Import (Text, Google-Doc, Discord) und was daraus folgt.

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const QUELLE = { text: "Text", google_doc: "Google Doc", discord: "Discord" } as const;

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const [liste, discord] = await Promise.all([callsListe(session.tenantId), getIntegration(session.tenantId, "discord_calls")]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon · SAS</div>
          <h1>Consultant-Calls</h1>
        </div>
        <Link className="btn btn-primary" href="/calls/offen" data-testid="calls-offen-link">Offene Punkte für den nächsten Call</Link>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}

      <details className="card card-pad" style={{ marginBottom: 14 }} open={liste.length === 0}>
        <summary><strong>Call importieren</strong></summary>
        <form action={callImportAction} className="stack" style={{ gap: 8, marginTop: 10, maxWidth: 820 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="small" style={{ flex: 2, minWidth: 220 }}>Titel<input name="titel" placeholder="z. B. Consultant-Call Oktober" /></label>
            <label className="small" style={{ flex: 1, minWidth: 120 }}>Datum<input name="datum" placeholder="TT.MM.JJJJ" /></label>
          </div>
          <label className="small">Google-Docs-Link<input name="link" placeholder="https://docs.google.com/document/d/…" data-testid="calls-link" /></label>
          <label className="small">… oder Transkript einfügen<textarea name="text" rows={6} data-testid="calls-text" /></label>
          <div><button className="btn btn-primary" type="submit" data-testid="calls-import">Importieren und auswerten</button></div>
        </form>
        <div className="small muted" style={{ marginTop: 10 }}>
          {discord?.botToken ? (
            <form action={discordImportAction} style={{ display: "inline" }}>
              Der Discord-Kanal wird einmal pro Woche gelesen. <button className="btn-link small" type="submit">Jetzt aus Discord holen</button>
            </form>
          ) : (
            <>Wöchentlich automatisch aus dem Discord-Kanal: <Link href="/anbindungen#discord_calls">Anbindungen → Discord – Call-Kanal</Link>.</>
          )}
        </div>
      </details>

      {liste.length === 0 ? (
        <div className="card card-pad small muted" data-testid="calls-leer">Noch keine Calls im Archiv.</div>
      ) : (
        <div className="table-wrap card">
          <table className="table" data-testid="calls-liste">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Call</th>
                <th>Quelle</th>
                <th className="right">zu prüfen</th>
                <th className="right">Aufgaben</th>
                <th className="right">offene Fragen</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => (
                <tr key={c.id} data-testid="calls-zeile">
                  <td className="num">{dmy(c.datum)}</td>
                  <td><Link href={`/calls/${c.id}`}>{c.titel}</Link>{c.auswertung === "fehler" && <div className="small" style={{ color: "var(--danger)" }}>Auswertung fehlgeschlagen</div>}{c.auswertung === "ohne_ki" && <div className="small muted">ohne KI</div>}</td>
                  <td className="small">{QUELLE[c.quelle]}</td>
                  <td className="right num">{c.vorschlaege ? <span className="tag tag-warn">{c.vorschlaege}</span> : "0"}</td>
                  <td className="right num">{c.aufgaben}</td>
                  <td className="right num">{c.fragenOffen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
