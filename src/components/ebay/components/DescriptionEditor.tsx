import { useEffect, useState } from 'react';
import type { Attempt } from '../api';

/**
 * Beschreibung als HTML: einfügen, bearbeiten, Vorschau. Die Vorschau läuft
 * in einem abgeschotteten iframe — wie bei eBay selbst, so beeinflussen die
 * Styles der Beschreibung die Seite nicht und umgekehrt.
 */
export function DescriptionEditor({ attempt, editable, onSave, onReset }: {
  attempt: Attempt;
  editable: boolean;
  onSave: (html: string) => Promise<unknown>;
  onReset: () => Promise<unknown>;
}) {
  const saved = attempt.description ?? '';
  const [html, setHtml] = useState(saved);
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');

  // Nach Speichern, Neuerzeugen oder Trefferwechsel den Serverstand übernehmen.
  useEffect(() => setHtml(saved), [saved]);

  const dirty = html !== saved;

  return (
    <fieldset className="description-editor">
      <legend>Beschreibung (HTML)</legend>
      <div className="seg">
        <button type="button" className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Vorschau</button>
        <button type="button" className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} disabled={!editable}>
          HTML bearbeiten
        </button>
      </div>

      {mode === 'edit' ? (
        <>
          <textarea
            className="code"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder="<h2>Produktname</h2>&#10;<p>Beschreibung …</p>"
          />
          <p className="muted small">
            Eigenen HTML-Code hier einfügen, z.B. aus einer Vorlage. Nicht erlaubt sind aktive Inhalte
            (&lt;script&gt;, &lt;iframe&gt;, onclick= …) — eBay lehnt sie ab.
          </p>
          <div className="tab-actions">
            <button type="button" className="primary" disabled={!dirty || html.trim() === ''} onClick={() => void onSave(html)}>
              Beschreibung speichern
            </button>
            <button type="button" disabled={!dirty} onClick={() => setHtml(saved)}>Verwerfen</button>
            <button
              type="button"
              className="linklike"
              onClick={() => {
                if (confirm('Die Beschreibung aus Titel und Artikelmerkmalen neu erzeugen? Eigenes HTML geht dabei verloren.')) {
                  void onReset();
                }
              }}
            >
              Aus Merkmalen neu erzeugen
            </button>
            {dirty && <span className="muted">Nicht gespeichert.</span>}
          </div>
        </>
      ) : html.trim() === '' ? (
        <p className="muted">Noch keine Beschreibung.</p>
      ) : (
        <iframe className="desc-frame" title="Beschreibung" sandbox="" srcDoc={html} />
      )}
    </fieldset>
  );
}
