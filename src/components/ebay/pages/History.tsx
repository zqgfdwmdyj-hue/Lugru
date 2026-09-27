import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatPercent, formatPrice, STATUS_LABELS, type Attempt } from '../api';
import { LegacyPurchases } from '../components/LegacyPurchases';

export function History({ onOpen }: { onOpen: (id: number) => void }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Attempt[]>('/attempts').then(setAttempts).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="card"><div className="banner error">{error}</div></div>;
  if (!attempts) return <div className="card">Lädt …</div>;
  if (attempts.length === 0) {
    return <div className="card muted">Noch keine Listings — such oben nach einer EAN oder einem Produkttitel.</div>;
  }

  return (
    <div className="card">
      <h1>Verlauf</h1>
      <LegacyPurchases onChanged={load} />
      <div className="table-wrap">
      <table className="history">
        <thead>
          <tr>
            <th>Datum</th><th>EAN</th><th>Titel</th><th>Quelle</th>
            <th>EK netto/Stück</th><th>Preis</th><th>Gewinn</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id}>
              <td>{formatDate(a.createdAt)}</td>
              <td className="mono">{a.ean || <span className="muted">—</span>}</td>
              <td className="title-cell" title={a.errorMessage ?? a.title}>{a.title ?? <span className="muted">—</span>}</td>
              <td>
                {a.source
                  ? a.source.url
                    ? <a href={a.source.url} target="_blank" rel="noreferrer">{a.source.merchant} ↗</a>
                    : a.source.merchant
                  : <span className="muted">—</span>}
              </td>
              <td className="mono">{a.purchasePrice !== undefined ? formatPrice(a.purchasePrice) : <span className="muted">—</span>}</td>
              <td className="mono">{formatPrice(a.price)}</td>
              <td className="mono">
                {a.profit
                  ? `${formatPrice(a.profit.profit)} (${formatPercent(a.profit.profitPercent)})`
                  : <span className="muted">—</span>}
              </td>
              <td><span className={`badge status-${a.status}`}>{STATUS_LABELS[a.status]}</span></td>
              <td className="actions">
                <button className="linklike" onClick={() => onOpen(a.id)}>Öffnen</button>
                {a.listingUrl && (
                  <a href={a.listingUrl} target="_blank" rel="noreferrer">eBay ↗</a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
