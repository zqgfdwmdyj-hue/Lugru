"use client";

import { useRef, useState, useTransition } from "react";
import { antwortAction, vorschauAction } from "./actions";

/** Antwort an die VA: Deutsch schreiben; bei englischsprachiger VA die englische Fassung zeigen und bearbeiten. */
export function AntwortForm({ nachrichtId, englisch, vorschauOffen }: { nachrichtId: string; englisch: boolean; vorschauOffen: boolean }) {
  const de = useRef<HTMLTextAreaElement>(null);
  const [en, setEn] = useState("");
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zeigen = () =>
    start(async () => {
      const r = await vorschauAction(de.current?.value ?? "");
      setEn(r.text);
      setHinweis(r.hinweis);
    });
  return (
    <form action={antwortAction} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="nachricht" value={nachrichtId} />
      <textarea ref={de} name="text" rows={2} required placeholder={englisch ? "Antwort auf Deutsch – geht auf Englisch in den Thread der VA" : "Antwort – erscheint im Thread der VA"} data-testid="va-antwort-text" />
      {englisch && (
        <details open={vorschauOffen} className="small" data-testid="va-antwort-en">
          <summary style={{ cursor: "pointer" }}>Englische Fassung {en ? "(wird so gesendet)" : "(leer = automatisch übersetzen)"}</summary>
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-small" onClick={zeigen} disabled={pending} data-testid="va-antwort-vorschau">{pending ? "Übersetze …" : "Englisch anzeigen"}</button>
            <textarea name="englisch" rows={3} value={en} onChange={(e) => setEn(e.target.value)} placeholder="English version (optional)" data-testid="va-antwort-englisch" />
            {hinweis && <span className="muted">{hinweis}</span>}
          </div>
        </details>
      )}
      <div>
        <button className="btn btn-primary btn-small" type="submit" data-testid="va-antwort-senden">Antwort senden</button>
      </div>
    </form>
  );
}
