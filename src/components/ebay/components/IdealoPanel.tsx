import type React from 'react';
import { useEffect, useState } from 'react';
import { api, formatPrice, type Attempt } from '../api';

interface PricePoint { date: string; price: number }

interface IdealoResult {
  status: 'ok' | 'not_found' | 'blocked' | 'error';
  searchUrl: string;
  productUrl?: string;
  name?: string;
  lowPrice?: number;
  highPrice?: number;
  offerCount?: number;
  cheapestShop?: string;
  history?: PricePoint[];
  historySource?: 'idealo' | 'own';
  message?: string;
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Preisvergleich bei idealo: günstigster Anbieter und Preisverlauf, daneben der eigene Preis. */
export function IdealoPanel({ attempt }: { attempt: Attempt }) {
  const [data, setData] = useState<IdealoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await api<IdealoResult>(`/attempts/${attempt.id}/idealo`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const query = attempt.ean || attempt.title;
  useEffect(() => {
    if (query) void load();
  }, [attempt.id, query]);

  if (!query) return null;

  const diff = data?.lowPrice !== undefined ? attempt.price - data.lowPrice : undefined;

  return (
    <section className="idealo-box">
      <div className="idealo-head">
        <h3>Preisvergleich idealo</h3>
        <span className="idealo-links">
          {data?.productUrl && <a href={data.productUrl} target="_blank" rel="noreferrer">Produktseite ↗</a>}
          <a href={data?.searchUrl ?? `https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">
            Bei idealo suchen ↗
          </a>
          <button type="button" className="linklike" onClick={() => void load()} disabled={loading}>
            {loading ? 'Lädt …' : 'Aktualisieren'}
          </button>
        </span>
      </div>

      {error && <p className="muted">{error}</p>}
      {loading && !data && <p className="muted">idealo wird abgefragt …</p>}
      {data && data.status !== 'ok' && <p className="muted">{data.message}</p>}

      {data?.status === 'ok' && (
        <>
          {data.name && <p className="muted small">{data.name}</p>}
          <dl className="figures">
            <div>
              <dt>Günstigster Preis</dt>
              <dd>{data.lowPrice !== undefined ? formatPrice(data.lowPrice) : '—'}</dd>
            </div>
            <div>
              <dt>Günstigster Anbieter</dt>
              <dd>{data.cheapestShop ?? <span className="muted">auf der Produktseite</span>}</dd>
            </div>
            {data.offerCount !== undefined && (
              <div><dt>Angebote</dt><dd>{data.offerCount}</dd></div>
            )}
            {data.lowPrice !== undefined && data.highPrice !== undefined && data.highPrice !== data.lowPrice && (
              <div><dt>Spanne</dt><dd>{formatPrice(data.lowPrice)} – {formatPrice(data.highPrice)}</dd></div>
            )}
            {diff !== undefined && (
              <div>
                <dt>Dein Preis</dt>
                <dd className={diff > 0 ? 'neg' : 'pos'}>
                  {formatPrice(attempt.price)}{' '}
                  <span className="small">
                    ({diff === 0 ? 'gleich' : `${diff > 0 ? '+' : '−'}${formatPrice(Math.abs(diff))} ${diff > 0 ? 'teurer' : 'günstiger'}`})
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {(data.history ?? []).length >= 2 ? (
            <PriceChart points={data.history!} ownPrice={attempt.price} source={data.historySource ?? 'idealo'} />
          ) : (
            <p className="muted small">
              idealo hat keinen Preisverlauf geliefert. Das Tool zeichnet den Bestpreis deshalb selbst auf
              {(data.history ?? []).length === 1 ? ` (erster Wert vom ${formatDay(data.history![0].date)})` : ''} — das
              Diagramm erscheint ab dem zweiten Tag. Den vollständigen Verlauf zeigt die{' '}
              {data.productUrl ? <a href={data.productUrl} target="_blank" rel="noreferrer">Produktseite bei idealo ↗</a> : 'Produktseite bei idealo'}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

const W = 640;
const H = 180;
const PAD = { top: 16, right: 12, bottom: 24, left: 56 };

/** Preisverlauf als Linie; die gestrichelte Linie ist der eigene Angebotspreis. */
function PriceChart({ points, ownPrice, source }: { points: PricePoint[]; ownPrice: number; source: 'idealo' | 'own' }) {
  const [hover, setHover] = useState<number | null>(null);

  const prices = points.map((p) => p.price);
  let min = Math.min(...prices, ownPrice);
  let max = Math.max(...prices, ownPrice);
  const pad = (max - min) * 0.1 || max * 0.05 || 1;
  min = Math.max(0, min - pad);
  max += pad;

  const t0 = Date.parse(points[0].date);
  const t1 = Date.parse(points[points.length - 1].date);
  const x = (iso: string) => PAD.left + ((Date.parse(iso) - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

  // Stufenlinie: ein Preis gilt, bis der nächste kommt.
  let d = `M${x(points[0].date)},${y(points[0].price)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(points[i].date)} V${y(points[i].price)}`;

  const ticks = [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15];
  const low = points.reduce((a, b) => (b.price < a.price ? b : a));
  const hp = hover !== null ? points[hover] : null;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - PAD.left - PAD.right) + PAD.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    }
    setHover(best);
  }

  return (
    <figure className="price-chart">
      <figcaption className="muted small">
        {source === 'own' ? 'Eigene Aufzeichnung des idealo-Bestpreises' : 'Bestpreis bei idealo'}, {formatDay(points[0].date)} – {formatDay(points[points.length - 1].date)} ·
        Tiefstwert {formatPrice(low.price)} am {formatDay(low.date)}
      </figcaption>
      <div className="chart-area">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Preisverlauf bei idealo, Tiefstwert ${formatPrice(low.price)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{formatPrice(t)}</text>
          </g>
        ))}
        <text className="axis" x={PAD.left} y={H - 6}>{formatDay(points[0].date)}</text>
        <text className="axis" x={W - PAD.right} y={H - 6} textAnchor="end">{formatDay(points[points.length - 1].date)}</text>

        <line className="own" x1={PAD.left} x2={W - PAD.right} y1={y(ownPrice)} y2={y(ownPrice)} />
        <text className="axis own-label" x={PAD.left + 4} y={y(ownPrice) - 5}>Dein Preis {formatPrice(ownPrice)}</text>

        <path className="line" d={d} />

        {hp && (
          <g>
            <line className="cross" x1={x(hp.date)} x2={x(hp.date)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className="dot" cx={x(hp.date)} cy={y(hp.price)} r={4.5} />
          </g>
        )}
        <rect
          x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom}
          fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: `${(x(hp.date) / W) * 100}%` }}>
          <strong>{formatPrice(hp.price)}</strong> <span className="muted">{formatDay(hp.date)}</span>
        </div>
      )}
      </div>
      <details>
        <summary className="small">Als Tabelle</summary>
        <table className="aspects">
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date}><th>{formatDay(p.date)}</th><td>{formatPrice(p.price)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
