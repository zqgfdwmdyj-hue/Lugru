"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { importAction } from "./actions";

/** Screenshots per Drag & Drop, Auswahl oder Einfügen (Strg+V) – oder Text aus Discord. */
export function ImportForm() {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  const take = (list: FileList | File[]) => {
    const dt = new DataTransfer();
    for (const f of [...(input.current?.files ?? [])]) dt.items.add(f);
    for (const f of [...list]) if (/^image\/|json$/.test(f.type) || /\.json$/i.test(f.name)) dt.items.add(f);
    if (input.current) input.current.files = dt.files;
    setNames([...dt.files].map((f) => f.name));
  };

  return (
    <form action={importAction} className="stack" style={{ gap: 8 }} data-testid="rh-import">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); take(e.clipboardData.files); } }}
        onClick={() => input.current?.click()}
        tabIndex={0}
        role="button"
        aria-label="Screenshots auswählen"
        style={{ border: `2px dashed ${over ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, padding: 16, textAlign: "center", cursor: "pointer", background: over ? "var(--surface-2, transparent)" : undefined }}
      >
        <div><strong>Screenshots vom Rechnungshelfer</strong> hierher ziehen, antippen zum Auswählen oder einfügen (Strg+V)</div>
        <div className="small muted">bis zu 4 Bilder – die KI liest Positionen, Mengen, Netto, Sendungen, Ticket und Leistungsdatum ab · auch die JSON-Datei geht</div>
        {names.length > 0 && <div className="small" data-testid="rh-files" style={{ marginTop: 6 }}>{names.join(", ")}</div>}
      </div>
      <input ref={input} type="file" name="file" multiple accept="image/png,image/jpeg,image/webp,.json,application/json" style={{ display: "none" }} onChange={(e) => e.target.files && setNames([...e.target.files].map((f) => f.name))} data-testid="rh-file" />
      <div className="field">
        <label className="label" htmlFor="rh-text">… oder Text aus Discord einfügen</label>
        <textarea className="textarea" id="rh-text" name="text" placeholder={"Pos 1 — Artikel\nMenge: 3 | Netto: 480,00 | Brutto: 571,20\n…\nTicket: acht-10001"} style={{ minHeight: 90, fontSize: 12 }} />
      </div>
      <div><SubmitButton label="Einlesen und prüfen" pendingLabel="Lese ein … (Screenshots bis zu 30 Sek.)" testId="rh-import-submit" /></div>
    </form>
  );
}
