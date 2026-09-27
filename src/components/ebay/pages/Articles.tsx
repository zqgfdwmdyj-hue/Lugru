import { useCallback, useEffect, useState } from 'react';
import {
  api, formatDate, formatPercent, formatPrice, STATUS_LABELS,
  type Article, type ArticleDetail,
} from '../api';
import { ArrowLeftIcon } from '../components/icons';
import { LegacyPurchases } from '../components/LegacyPurchases';

/** Liste aller Artikel — eine Zeile je EAN bzw. Katalogreferenz. */
export function Articles({ onOpen }: { onOpen: (key: string) => void }) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Article[]>('/articles').then(setArticles).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="card"><div className="banner error">{error}</div></div>;
  if (!articles) return <div className="card">Lädt …</div>;
  if (articles.length === 0) {
    return <div className="card muted">Noch keine Artikel — leg über die Suche ein Listing an.</div>;
  }

  return (
    <div className="card">
      <h1>Artikel</h1>
      <LegacyPurchases onChanged={load} />
      <div className="table-wrap">
      <table className="history">
        <thead>
          <tr>
            <th></th><th>Artikel</th><th>EAN</th><th>Gekauft</th><th>Ø EK netto</th>
            <th>Ø Gewinn/Stück</th><th>Quellen</th><th>Listings</th><th></th>
          </tr>
        </thead>
        <tbody>
          {articles.map((a) => (
            <tr key={a.key}>
              <td>{a.imageUrl ? <img className="thumb" src={a.imageUrl} alt="" /> : null}</td>
              <td className="title-cell" title={a.title}>{a.title ?? <span className="muted">—</span>}</td>
              <td className="mono">{a.ean ?? <span className="muted">—</span>}</td>
              <td className="mono">{a.purchasedUnits > 0 ? a.purchasedUnits : <span className="muted">—</span>}</td>
              <td className="mono">{a.avgPurchasePrice !== undefined ? formatPrice(a.avgPurchasePrice) : <span className="muted">—</span>}</td>
              <td className="mono">{a.avgProfit !== undefined ? formatPrice(a.avgProfit) : <span className="muted">—</span>}</td>
              <td>{a.merchants.length > 0 ? a.merchants.join(', ') : <span className="muted">—</span>}</td>
              <td className="mono">{a.listingCount}{a.publishedCount > 0 ? ` (${a.publishedCount} live)` : ''}</td>
              <td className="actions"><button className="linklike" onClick={() => onOpen(a.key)}>Historie</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** Detail: alle Einkäufe und Listings eines Artikels in Zeitfolge. */
export function ArticleView({
  articleKey, onBack, onOpenAttempt,
}: { articleKey: string; onBack: () => void; onOpenAttempt: (id: number) => void }) {
  const [data, setData] = useState<ArticleDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<ArticleDetail>(`/articles/${encodeURIComponent(articleKey)}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [articleKey]);

  if (error) return <div className="card"><div className="banner error">{error}</div></div>;
  if (!data) return <div className="card">Lädt …</div>;

  const { article, attempts } = data;

  return (
    <div className="card">
      <button className="back" onClick={onBack}><ArrowLeftIcon size={16} /> Alle Artikel</button>
      <h1>{article.title ?? 'Artikel'}</h1>
      <dl className="figures">
        <div><dt>EAN</dt><dd className="mono">{article.ean ?? '—'}</dd></div>
        <div><dt>Gekaufte Einheiten</dt><dd>{article.purchasedUnits}</dd></div>
        <div><dt>Einkaufswert</dt><dd>{formatPrice(article.purchaseValue)}</dd></div>
        <div><dt>Ø Einkaufspreis netto</dt><dd>{article.avgPurchasePrice !== undefined ? formatPrice(article.avgPurchasePrice) : '—'}</dd></div>
        <div><dt>Ø Gewinn je Stück</dt><dd>{article.avgProfit !== undefined ? formatPrice(article.avgProfit) : '—'}</dd></div>
        <div><dt>Listings</dt><dd>{article.listingCount} ({article.publishedCount} veröffentlicht)</dd></div>
      </dl>

      <div className="table-wrap">
      <table className="history">
        <thead>
          <tr>
            <th>Datum</th><th>Quelle</th><th>Gekauft</th><th>EK netto/Stück</th>
            <th>Angedacht</th><th>Gelistet</th><th>Gewinn</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id}>
              <td>{formatDate(a.createdAt)}</td>
              <td>
                {a.source
                  ? a.source.url
                    ? <a href={a.source.url} target="_blank" rel="noreferrer">{a.source.merchant} ↗</a>
                    : a.source.merchant
                  : <span className="muted">—</span>}
              </td>
              <td className="mono">{a.purchasedUnits ?? <span className="muted">—</span>}</td>
              <td className="mono">{a.purchasePrice !== undefined ? formatPrice(a.purchasePrice) : <span className="muted">—</span>}</td>
              <td className="mono">{a.targetPrice !== undefined ? formatPrice(a.targetPrice) : <span className="muted">—</span>}</td>
              <td className="mono">{formatPrice(a.price)}</td>
              <td className="mono">
                {a.profit
                  ? `${formatPrice(a.profit.profit)} (${formatPercent(a.profit.profitPercent)})`
                  : <span className="muted">—</span>}
              </td>
              <td><span className={`badge status-${a.status}`}>{STATUS_LABELS[a.status]}</span></td>
              <td className="actions"><button className="linklike" onClick={() => onOpenAttempt(a.id)}>Öffnen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="muted">Gewinne sind Schätzungen: die tatsächliche eBay-Provision steht erst nach dem Verkauf fest, Verpackung und Rücksendungen fehlen.</p>
    </div>
  );
}
