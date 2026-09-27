import Link from "next/link";
import { ALL_CATEGORIES } from "@/lib/knowledge/categories";

type Entry = { id?: string; title: string; category: string; kind: "article" | "snippet"; body: string; tags: string[] };

export function EntryForm({
  action,
  entry,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  entry?: Entry;
  cancelHref: string;
}) {
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 16, padding: 24, maxWidth: 900 }}>
      {entry?.id && <input type="hidden" name="id" value={entry.id} />}
      <div className="field">
        <label className="label" htmlFor="title">Titel</label>
        <input className="input" id="title" name="title" defaultValue={entry?.title} required />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor="kind">Art</label>
          <select className="select" id="kind" name="kind" defaultValue={entry?.kind ?? "article"}>
            <option value="article">Wissen / Anleitung</option>
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
      <div className="field">
        <label className="label" htmlFor="body">Inhalt</label>
        <textarea className="textarea" id="body" name="body" defaultValue={entry?.body} />
        <span className="small muted">Platzhalter wie {"{Sendungs-ID}"} oder {"{Anzahl}"} werden später automatisch befüllt.</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit">Speichern</button>
        <Link className="btn" href={cancelHref}>Abbrechen</Link>
      </div>
    </form>
  );
}
