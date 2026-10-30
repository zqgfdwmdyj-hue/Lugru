import Link from "next/link";
import { ALL_CATEGORIES } from "@/lib/knowledge/categories";

type Anleitung = { zweck: string; wann: string; wer: string; schritte: string[]; zugaenge: string[]; fehler: string[]; aufgabenTypen: string[] };
type Entry = { id?: string; title: string; category: string; kind: "article" | "snippet" | "anleitung"; body: string; tags: string[]; origin?: "recherche" | "anleitung" | "notiz" | "call" | "chat"; anleitung?: Anleitung | null };

export function EntryForm({
  action,
  entry,
  cancelHref,
  alsAnleitung,
}: {
  action: (formData: FormData) => Promise<void>;
  entry?: Entry;
  cancelHref: string;
  /** Neuer Eintrag direkt als Anleitung (z. B. /wissen/neu?art=anleitung). */
  alsAnleitung?: boolean;
}) {
  const a = entry?.anleitung;
  const istAnleitung = entry?.kind === "anleitung" || alsAnleitung;
  // Bei Anleitungen entsteht der Text aus den Feldern – im Textfeld stehen nur die Ergänzungen.
  const text = entry?.kind === "anleitung" ? (entry.body.split("\n\nErgänzungen:\n")[1] ?? (entry.anleitung ? "" : entry.body)) : entry?.body;
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 16, padding: 24, maxWidth: 900 }}>
      {entry?.id && <input type="hidden" name="id" value={entry.id} />}
      <div className="field">
        <label className="label" htmlFor="title">Titel</label>
        <input className="input" id="title" name="title" defaultValue={entry?.title} required />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor="origin">Herkunft</label>
          <select className="select" id="origin" name="origin" defaultValue={entry?.origin ?? "notiz"}>
            <option value="notiz">Eigene Notiz</option>
            <option value="anleitung">Anleitung (verbindlich)</option>
            <option value="recherche">Recherche (ungeprüft)</option>
            {entry?.origin === "call" && <option value="call">Aus einem Call (ungeprüft)</option>}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="kind">Art</label>
          <select className="select" id="kind" name="kind" defaultValue={istAnleitung ? "anleitung" : (entry?.kind ?? "article")} data-testid="entry-kind">
            <option value="article">Wissen</option>
            <option value="anleitung">Anleitung (Schritt für Schritt)</option>
            <option value="snippet">Textbaustein</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="category">Bereich</label>
          <select className="select" id="category" name="category" defaultValue={entry?.category ?? ALL_CATEGORIES[0]}>
            {ALL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="tags">Schlagwörter (mit Komma)</label>
          <input className="input" id="tags" name="tags" defaultValue={entry?.tags.join(", ")} placeholder="FBA, Erstattung" />
        </div>
      </div>
      <details open={istAnleitung} className="card card-pad" style={{ background: "var(--surface-2, transparent)" }}>
        <summary><strong>Felder der Anleitung</strong> <span className="small muted">(nur bei Art „Anleitung“)</span></summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <div className="field"><label className="label" htmlFor="a_zweck">Zweck</label><input className="input" id="a_zweck" name="a_zweck" defaultValue={a?.zweck} placeholder="Wozu dient der Ablauf?" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div className="field"><label className="label" htmlFor="a_wann">Wann</label><input className="input" id="a_wann" name="a_wann" defaultValue={a?.wann} placeholder="z. B. jeden Montag, wenn eine Remission ankommt" /></div>
            <div className="field"><label className="label" htmlFor="a_wer">Wer (zuständig)</label><input className="input" id="a_wer" name="a_wer" defaultValue={a?.wer} placeholder="z. B. Assistenz" /></div>
          </div>
          <div className="field"><label className="label" htmlFor="a_schritte">Schritte (je Zeile einer, werden nummeriert)</label><textarea className="textarea" id="a_schritte" name="a_schritte" rows={6} defaultValue={a?.schritte.join("\n")} data-testid="entry-schritte" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div className="field"><label className="label" htmlFor="a_zugaenge">Benötigte Zugänge (je Zeile)</label><textarea className="textarea" id="a_zugaenge" name="a_zugaenge" rows={3} defaultValue={a?.zugaenge.join("\n")} /></div>
            <div className="field"><label className="label" htmlFor="a_fehler">Häufige Fehler (je Zeile)</label><textarea className="textarea" id="a_fehler" name="a_fehler" rows={3} defaultValue={a?.fehler.join("\n")} /></div>
          </div>
          <div className="field">
            <label className="label" htmlFor="a_typen">Aufgabentypen (je Zeile) – wird eine passende Aufgabe jemandem zugewiesen, hängt die Anleitung automatisch an</label>
            <textarea className="textarea" id="a_typen" name="a_typen" rows={3} defaultValue={a?.aufgabenTypen.join("\n")} placeholder={"kategorie:amazon\nschluessel:remission\ntitel:Inventur"} data-testid="entry-typen" />
            <span className="small muted">„kategorie:…“ (amazon, ebay, versand, einkauf, geld, support, marken, system), „schluessel:…“ (Anfang der Systemkennung) oder einfach ein Stichwort aus dem Aufgabentitel.</span>
          </div>
        </div>
      </details>
      <div className="field">
        <label className="label" htmlFor="body">{istAnleitung ? "Ergänzungen (optional)" : "Inhalt"}</label>
        <textarea className="textarea" id="body" name="body" defaultValue={text} />
        <span className="small muted">Platzhalter wie {"{Sendungs-ID}"} oder {"{Anzahl}"} werden später automatisch befüllt.</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit">Speichern</button>
        <Link className="btn" href={cancelHref}>Abbrechen</Link>
      </div>
    </form>
  );
}
