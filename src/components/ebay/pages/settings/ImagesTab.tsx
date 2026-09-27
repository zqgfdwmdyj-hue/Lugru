import { useState } from 'react';
import { api } from '../../api';
import type { TabContext } from './types';

/** Bildquellen neben eBay — aktuell Amazon über Keepa. */
export function ImagesTab({ ctx }: { ctx: TabContext }) {
  const { s, run } = ctx;
  const [key, setKey] = useState('');
  const stored = s.keepaApiKey === '***';

  const save = (value: string, success: string) =>
    run(async () => {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ keepaApiKey: value }) });
      setKey('');
    }, success);

  return (
    <section className="stack">
      <h3>Amazon-Bilder über Keepa</h3>
      <p className="muted">
        Mit einem Keepa-API-Schlüssel lädt die Vorschau per EAN oder ASIN die Produktbilder von
        amazon.de. Den Schlüssel gibt es mit einem Keepa-API-Abo unter{' '}
        <a href="https://keepa.com/#!api" target="_blank" rel="noreferrer">keepa.com → API</a>.
        Jede Abfrage kostet ein Keepa-Token.
      </p>
      <p className="muted">
        Wichtig: Die Bilder gehören Herstellern oder Amazon-Händlern. Nur verwenden, wenn du die
        Nutzungsrechte hast — sonst drohen Abmahnungen.
      </p>
      <label>
        Keepa-API-Schlüssel
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={stored ? 'Schlüssel ist hinterlegt — zum Ändern neu eingeben' : 'Schlüssel einfügen'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="tab-actions">
        <button className="primary" disabled={key.trim() === ''} onClick={() => void save(key.trim(), 'Keepa-Schlüssel gespeichert.')}>
          Speichern
        </button>
        {stored && (
          <button className="linklike" onClick={() => void save('', 'Keepa-Schlüssel entfernt.')}>Schlüssel entfernen</button>
        )}
      </div>
    </section>
  );
}
