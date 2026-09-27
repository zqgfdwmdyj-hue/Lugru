import { formatPrice, type SearchResult } from '../api';

const NO_CATALOG_HINT =
  'Dieses Angebot führt keine Katalogreferenz (ePID). Übernehmen lässt es sich trotzdem: Artikelmerkmale, ' +
  'Kategorie und Bilder kommen dann aus dem Angebot selbst, den Titel gibst du bei Bedarf in der Vorschau ein.';

/**
 * Trefferliste der Suche (Schritt 2). Eine Karte = ein aktives eBay-Listing;
 * Klick wählt es aus. „Katalogdaten" markiert Treffer mit Katalogreferenz —
 * daraus wird das neue Listing gebaut (nie aus Verkäuferinhalten). Treffer ohne
 * diese Kennzeichnung sind ebenso wählbar: die vollen Artikeldaten können
 * Katalogdaten enthalten, die im Such-Summary noch nicht sichtbar sind — und
 * sonst tragen die Fakten des Angebots (Merkmale, Kategorie, Bilder) den Entwurf.
 */
export function ResultGrid({ results, onSelect, pendingRef = '' }: {
  results: SearchResult[];
  onSelect: (r: SearchResult) => void;
  pendingRef?: string;
}) {
  return (
    <div className="result-grid">
      {results.map((r) => {
        const hasCatalog = Boolean(r.epid);
        return (
          <div key={r.ref} className={'result-card' + (hasCatalog ? '' : ' dimmed')}>
            <button
              className="result-pick"
              onClick={() => onSelect(r)}
              disabled={pendingRef !== ''}
              title={hasCatalog ? undefined : NO_CATALOG_HINT}
            >
              <span className="result-img">
                {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" /> : <span className="noimg">Kein Bild</span>}
                <span className={'catalog-flag ' + (hasCatalog ? 'yes' : 'no')}>
                  {hasCatalog ? 'Katalogdaten' : 'ohne Katalogdaten'}
                </span>
              </span>
              <span className="result-body">
                <span className="result-title" title={r.title}>{r.title}</span>
                <span className="result-meta">
                  {r.price && <strong>{formatPrice(Number(r.price), r.currency)}</strong>}
                  {r.condition && <span className="muted"> · {r.condition}</span>}
                </span>
                <span className="result-cta">
                  {pendingRef === r.ref ? 'Wird geladen …' : hasCatalog ? 'Auswählen' : 'Ohne Katalogdaten wählen'}
                </span>
              </span>
            </button>
            {r.itemWebUrl && (
              <a className="result-link" href={r.itemWebUrl} target="_blank" rel="noreferrer">
                Angebot ansehen ↗
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
