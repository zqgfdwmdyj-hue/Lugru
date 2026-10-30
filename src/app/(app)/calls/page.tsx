import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { callsListe, wissenStand } from "@/lib/calls/service";
import { getIntegration } from "@/lib/integrations/store";
import { archivImportAction, callImportAction, discordImportAction, gruppenKanaeleAction, rohTageAction, sammelImportAction, wissenNachholenAction } from "./actions";
import { kanalStaende } from "@/lib/discord-wissen/service";
import { getSettings } from "@/lib/settings";

// Call-Archiv: Calls mit dem Amazon-Consultant und Wochen-Calls der Deal-Gruppe – Import (Dateien/ZIP, Links,
// Text, Discord) und was daraus folgt.

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const QUELLE = { text: "Text", google_doc: "Google Doc", discord: "Discord", archiv: "altes Call-Archiv", datei: "Datei", chat: "Discord-Chat (Zusammenfassung)" } as const;

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const [liste, discord, wissen] = await Promise.all([callsListe(session.tenantId), getIntegration(session.tenantId, "discord_calls"), wissenStand(session.tenantId)]);
  const wartend = liste.filter((c) => c.auswertung === "offen").length;
  const inhaber = session.role === "owner";
  const [gruppe, gruppeCfg, rohTage] = inhaber ? await Promise.all([kanalStaende(session.tenantId), getIntegration(session.tenantId, "discord_wissen"), getSettings(session.tenantId).then((x) => x.discordWissen.rohTage)]) : [null, null, 30];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon · SAS</div>
          <h1>Calls</h1>
          <div className="small muted">Consultant-Calls und Wochen-Calls der Deal-Gruppe</div>
        </div>
        <Link className="btn btn-primary" href="/calls/offen" data-testid="calls-offen-link">Offene Punkte für den nächsten Call</Link>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}
      {wartend > 0 && (
        <div className="notice small" style={{ marginBottom: 12 }} data-testid="calls-wartend">
          {wartend} {wartend === 1 ? "Call wartet" : "Calls warten"} auf die KI-Auswertung – läuft nacheinander im Hintergrund (je Call etwa eine Minute). <Link href="/calls">Neu laden</Link>
        </div>
      )}

      {liste.length > 0 && (
        <div className="small" style={{ marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }} data-testid="calls-wissen">
          <span>
            <strong>Wissen aus Calls:</strong> <Link href="/wissen?bereich=call">{wissen.eintraege} Einträge im Wissen</Link>
            {wissen.ausstehend > 0 && <span className="muted"> · {wissen.ausstehend} {wissen.ausstehend === 1 ? "Call wartet" : "Calls warten"} noch auf den Auszug</span>}
          </span>
          {wissen.ausstehend > 0 && (
            <form action={wissenNachholenAction} style={{ display: "inline" }}>
              <button className="btn-link small" type="submit" data-testid="calls-wissen-nachholen">jetzt nachholen</button>
            </form>
          )}
        </div>
      )}

      {inhaber && (
        <details className="card card-pad" style={{ marginBottom: 14 }} data-testid="gruppen-kanaele">
          <summary><strong>Gruppen-Kanäle (Discord, nur lesen)</strong> <span className="small muted">– {gruppeCfg ? `${gruppe?.staende.length ?? 0} Kanäle, ${gruppe?.rohNachrichten ?? 0} Rohnachrichten (werden nach ${rohTage} Tagen gelöscht)` : "nicht eingerichtet"}</span></summary>
          <div className="stack small" style={{ gap: 8, marginTop: 10 }}>
            {gruppe && gruppe.staende.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {gruppe.staende.map((k) => <li key={k.id}>{k.name} ({k.rhythmus === "taeglich" ? "täglich" : k.rhythmus === "woechentlich" ? "wöchentlich" : "aus"}) – letzte Zusammenfassung {k.letzteZusammenfassung ? k.letzteZusammenfassung.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "noch keine"}</li>)}
              </ul>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <form action={gruppenKanaeleAction}><button className="btn" type="submit" data-testid="gruppen-lesen">Jetzt lesen</button></form>
              <form action={rohTageAction} style={{ display: "flex", gap: 6, alignItems: "end" }}>
                <label className="small">Rohtexte löschen nach (Tagen)<input className="input" name="rohTage" type="number" min={1} max={90} defaultValue={rohTage} style={{ width: 90 }} /></label>
                <button className="btn btn-small" type="submit">Speichern</button>
              </form>
              <Link href="/wissen?herkunft=chat">Wissen aus den Chats</Link>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Der Bot liest nur freigegebene Kanäle und schreibt nie in die Gruppe. Nur ein Bot, den der Server-Admin einlädt – keine Nutzer-Token. Text für die Gruppe:
              „Ich lasse unsere Kanäle Amazon/eBay/Fragen von einem Lese-Bot zusammenfassen – nur für mich, ohne Namen, Rohtexte werden nach {rohTage} Tagen gelöscht.“
            </p>
          </div>
        </details>
      )}

      <details className="card card-pad" style={{ marginBottom: 14 }} open={liste.length === 0}>
        <summary><strong>Calls importieren</strong></summary>
        <form action={sammelImportAction} className="stack" style={{ gap: 8, marginTop: 10, maxWidth: 820 }} data-testid="calls-sammel">
          <div><strong>Mehrere Calls auf einmal</strong> <span className="small muted">– z. B. alle Wochen-Calls der Deal-Gruppe</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="small" style={{ flex: 1, minWidth: 200 }}>
              Art
              <select name="art" defaultValue="gruppe" data-testid="calls-sammel-art">
                <option value="gruppe">Wochen-Calls der Deal-Gruppe</option>
                <option value="consultant">Calls mit dem Consultant</option>
              </select>
            </label>
            <label className="small" style={{ flex: 2, minWidth: 220 }}>
              Bezeichnung (optional)
              <input name="bezeichnung" placeholder="z. B. Wochen-Call Deal-Gruppe → „… 12.09.2026“" data-testid="calls-sammel-bezeichnung" />
            </label>
          </div>
          <label className="small">
            Dateien
            <input type="file" name="dateien" multiple accept=".docx,.odt,.pdf,.txt,.md,.vtt,.srt,.zip" data-testid="calls-dateien" />
          </label>
          <div className="small muted">Word, PDF, Text, Untertitel (.vtt/.srt) oder ein ZIP – z. B. Google-Drive-Ordner → „Herunterladen“. Zusammen bis 20 MB. Das Datum kommt aus dem Dateinamen oder dem Anfang des Transkripts.</div>
          <label className="small">
            … und/oder Google-Docs-Links bzw. kopierte Discord-Nachrichten
            <textarea name="links" rows={4} placeholder={"https://docs.google.com/document/d/…\nhttps://docs.google.com/document/d/…"} data-testid="calls-links" />
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" data-testid="calls-sammel-import">Alle importieren</button>
            <span className="small muted">Schon vorhandene Calls werden übersprungen. Die KI wertet danach einen nach dem anderen aus.</span>
          </div>
        </form>

        <details style={{ marginTop: 14 }} data-testid="calls-einzeln">
          <summary className="small"><strong>Einzelner Call</strong> (Link oder Transkript, sofort ausgewertet)</summary>
          <form action={callImportAction} className="stack" style={{ gap: 8, marginTop: 10, maxWidth: 820 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label className="small" style={{ flex: 2, minWidth: 220 }}>Titel<input name="titel" placeholder="z. B. Consultant-Call Oktober" /></label>
              <label className="small" style={{ flex: 1, minWidth: 120 }}>Datum<input name="datum" placeholder="TT.MM.JJJJ" /></label>
              <label className="small" style={{ flex: 1, minWidth: 160 }}>
                Art
                <select name="art" defaultValue="consultant">
                  <option value="consultant">Consultant-Call</option>
                  <option value="gruppe">Wochen-Call Deal-Gruppe</option>
                </select>
              </label>
            </div>
            <label className="small">Google-Docs-Link<input name="link" placeholder="https://docs.google.com/document/d/…" data-testid="calls-link" /></label>
            <label className="small">… oder Transkript einfügen<textarea name="text" rows={6} data-testid="calls-text" /></label>
            <div><button className="btn btn-primary" type="submit" data-testid="calls-import">Importieren und auswerten</button></div>
          </form>
        </details>

        <form action={archivImportAction} className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <span><strong>Umzug aus dem bisherigen Call-Archiv:</strong> Export-Datei (JSON) mit Zusammenfassung und Transkript</span>
          <input type="file" name="datei" accept=".json,application/json" required data-testid="calls-archiv-datei" />
          <button className="btn btn-small" type="submit" data-testid="calls-archiv-import">Übernehmen</button>
        </form>
        <div className="small muted" style={{ marginTop: 10 }}>
          {discord?.botToken ? (
            <form action={discordImportAction} style={{ display: "inline" }}>
              Der Discord-Kanal wird einmal pro Woche gelesen. <button className="btn-link small" type="submit">Jetzt aus Discord holen</button>
              {" · "}
              <button className="btn-link small" type="submit" name="nachholen" value="1" data-testid="calls-discord-nachholen">Ältere Nachrichten nachholen (bis 2.000)</button>
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
                  <td><Link href={`/calls/${c.id}`}>{c.titel}</Link>{c.art === "gruppe" && <span className="tag" style={{ marginLeft: 6 }}>Deal-Gruppe</span>}{c.auswertung === "offen" && <div className="small muted">wartet auf KI-Auswertung …</div>}{c.zusammenfassung?.teilnehmer?.length ? <div className="small muted">{c.zusammenfassung.teilnehmer.join(", ")}</div> : null}{c.auswertung === "fehler" && <div className="small" style={{ color: "var(--danger)" }}>Auswertung fehlgeschlagen</div>}{c.auswertung === "ohne_ki" && <div className="small muted">ohne KI</div>}</td>
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
