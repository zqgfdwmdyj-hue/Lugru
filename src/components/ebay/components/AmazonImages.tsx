import { useState } from 'react';
import { api, type Attempt } from '../api';

interface KeepaImages {
  asin?: string;
  title?: string;
  images: string[];
  amazonUrl?: string;
  tokensLeft?: number;
}

/**
 * Amazon-Produktbilder (über Keepa) nachschlagen und auswählen. Übernommen wird
 * nur, was angehakt ist — wie die eBay-Bilder werden sie erst beim
 * Veröffentlichen als eigene Kopien zu eBay hochgeladen.
 */
export function AmazonImages({ attempt, busy, onAdd }: {
  attempt: Attempt;
  busy: boolean;
  onAdd: (urls: string[]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(attempt.ean ?? '');
  const [result, setResult] = useState<KeepaImages | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const existing = attempt.imageUrls ?? [];

  async function load() {
    setError('');
    setLoading(true);
    try {
      const r = await api<KeepaImages>(`/attempts/${attempt.id}/keepa-images?code=${encodeURIComponent(code.trim())}`);
      setResult(r);
      setSelected(r.images.filter((u) => !existing.includes(u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const toggle = (url: string) =>
    setSelected((s) => (s.includes(url) ? s.filter((u) => u !== url) : [...s, url]));

  if (!open) {
    return (
      <button type="button" disabled={busy} onClick={() => { setOpen(true); if (code.trim()) void load(); }}>
        + Bilder von Amazon (Keepa)
      </button>
    );
  }

  return (
    <div className="amazon-images">
      <div className="image-url-row">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EAN oder ASIN" />
        <button type="button" disabled={loading || code.trim() === ''} onClick={() => void load()}>
          {loading ? 'Sucht …' : 'Bei Amazon suchen'}
        </button>
        <button type="button" className="linklike" onClick={() => setOpen(false)}>Schließen</button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {result && result.images.length === 0 && <p className="muted">Keine Amazon-Bilder zu „{code}" gefunden.</p>}
      {result && result.images.length > 0 && (
        <>
          <p className="muted small">
            {result.title}
            {result.amazonUrl && <> · <a href={result.amazonUrl} target="_blank" rel="noreferrer">bei Amazon ansehen ↗</a></>}
            {result.tokensLeft !== undefined && <> · {result.tokensLeft} Keepa-Tokens übrig</>}
          </p>
          <div className="gallery">
            {result.images.map((url) => {
              const already = existing.includes(url);
              return (
                <label key={url} className={'thumb pick' + (selected.includes(url) ? ' on' : '') + (already ? ' done' : '')}>
                  <img src={url} alt="" loading="lazy" />
                  <input
                    type="checkbox"
                    checked={already || selected.includes(url)}
                    disabled={already}
                    onChange={() => toggle(url)}
                    aria-label={already ? 'Bereits im Listing' : 'Bild auswählen'}
                  />
                </label>
              );
            })}
          </div>
          <p className="hint">Nur Bilder übernehmen, für die du die Nutzungsrechte hast.</p>
          <div className="tab-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || selected.length === 0}
              onClick={() => void onAdd(selected).then(() => setSelected([]))}
            >
              {selected.length === 1 ? '1 Bild übernehmen' : `${selected.length} Bilder übernehmen`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
