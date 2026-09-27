import { useState, type FormEvent } from 'react';
import { api, type Attempt, type SearchResult } from '../api';
import { ResultGrid } from '../components/ResultGrid';
import { SearchIcon } from '../components/icons';

/**
 * Rettungsweg in der Vorschau, wenn der gewählte Treffer nicht reicht (z.B. kein
 * Bild): nochmal suchen und einen anderen Treffer auf denselben Entwurf
 * übernehmen — Titel, Bilder und Merkmale kommen aus dessen Katalogdaten oder,
 * ohne Katalogbezug, aus den Fakten des Angebots (nie aus Verkäufertexten).
 */
export function ListingSearch({ attempt, onApplied }: { attempt: Attempt; onApplied: (a: Attempt) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyingRef, setApplyingRef] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setResults(await api<SearchResult[]>(`/search?q=${encodeURIComponent(query.trim())}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyResult(r: SearchResult) {
    setError('');
    setApplyingRef(r.ref);
    try {
      const body = r.epid ? { ref: r.ref, epid: r.epid } : { ref: r.ref };
      onApplied(await api<Attempt>(`/attempts/${attempt.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingRef('');
    }
  }

  return (
    <section className="search-rescue">
      <h3>Anderes Listing wählen</h3>
      <p className="muted">
        Nach dem Produkt suchen (EAN, Titel oder eBay-Link) und einen Treffer übernehmen.
      </p>
      <form onSubmit={submit} className="searchbar small">
        <SearchIcon className="searchbar-icon" size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="EAN oder Produkttitel"
          aria-label="EAN oder Produkttitel"
        />
        <button className="primary" disabled={busy || query.trim().length < 2}>
          {busy ? 'Sucht …' : 'Suchen'}
        </button>
      </form>
      {error && <div className="banner error">{error}</div>}

      {results !== null && results.length === 0 && (
        <p className="muted">Nichts gefunden. Anderen Suchbegriff probieren — Marke und Modell reichen oft.</p>
      )}
      {results !== null && results.length > 0 && (
        <ResultGrid results={results} onSelect={applyResult} pendingRef={applyingRef} />
      )}
    </section>
  );
}
