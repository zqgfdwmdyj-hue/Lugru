import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearIdealoCache, findProductLink, lookupIdealo, parsePriceHistory, parseProductPage, type FetchLike,
} from '@/lib/ebay/idealo/idealo';

const PRODUCT_URL = 'https://www.idealo.de/preisvergleich/OffersOfProduct/201234567_-kaffeemaschine-xy.html';

function page(ld: unknown): string {
  return `<html><head><link rel="canonical" href="${PRODUCT_URL}">
    <script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
}

function response(body: string, init: { status?: number; url?: string } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200 });
  Object.defineProperty(res, 'url', { value: init.url ?? '' });
  return res;
}

describe('findProductLink', () => {
  it('findet ID und URL in einer Weiterleitung oder im HTML', () => {
    expect(findProductLink(PRODUCT_URL)).toEqual({ id: '201234567', url: PRODUCT_URL });
    expect(findProductLink('<a href="/preisvergleich/OffersOfProduct/42_-x.html">x</a>')?.id).toBe('42');
    expect(findProductLink('<a href="/anderes">x</a>')).toBeNull();
  });
});

describe('parseProductPage', () => {
  it('liest AggregateOffer', () => {
    const html = page({
      '@type': 'Product', name: 'Kaffeemaschine XY',
      offers: { '@type': 'AggregateOffer', lowPrice: '79.90', highPrice: 129, offerCount: 23 },
    });
    expect(parseProductPage(html)).toEqual({ name: 'Kaffeemaschine XY', lowPrice: 79.9, highPrice: 129, offerCount: 23 });
  });

  it('nimmt aus Einzelangeboten den günstigsten Shop', () => {
    const html = page([{ '@type': 'Product', name: 'X', offers: [
      { '@type': 'Offer', price: '99,00', seller: { name: 'Shop B' } },
      { '@type': 'Offer', price: '89,50', seller: { name: 'Shop A' } },
    ] }]);
    expect(parseProductPage(html)).toMatchObject({ lowPrice: 89.5, highPrice: 99, offerCount: 2, cheapestShop: 'Shop A' });
  });

  it('bleibt leer ohne Produktdaten', () => {
    expect(parseProductPage('<html></html>')).toEqual({});
  });
});

describe('parsePriceHistory', () => {
  it('versteht {data:[{x,y}]} mit Millisekunden und fasst Tage zusammen', () => {
    const day = Date.UTC(2026, 8, 1);
    expect(parsePriceHistory({ data: [
      { x: day + 3600_000, y: 90 }, { x: day, y: 95 }, { x: day - 86_400_000, y: 99.9 },
    ] })).toEqual([
      { date: '2026-08-31', price: 99.9 },
      { date: '2026-09-01', price: 90 },
    ]);
  });

  it('versteht [[sekunden, preis]] und Datums-Text', () => {
    expect(parsePriceHistory([[1788220800, '12,50']])).toEqual([{ date: '2026-09-01', price: 12.5 }]);
    expect(parsePriceHistory([{ date: '2026-09-02', price: 11 }])).toEqual([{ date: '2026-09-02', price: 11 }]);
  });

  it('übergeht Unbrauchbares', () => {
    expect(parsePriceHistory(null)).toEqual([]);
    expect(parsePriceHistory({ data: [{ x: 'kaputt', y: 1 }, { x: 1, y: 0 }] })).toEqual([]);
  });
});

describe('lookupIdealo', () => {
  beforeEach(() => clearIdealoCache());

  it('folgt der EAN-Weiterleitung, liest Preis und Verlauf und speichert zwischen', async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      if (url.includes('MainSearch')) {
        return response(page({ '@type': 'Product', name: 'X', offers: { '@type': 'AggregateOffer', lowPrice: 10, offerCount: 3 } }), { url: PRODUCT_URL });
      }
      if (url.includes('pricechart')) return response(JSON.stringify({ data: [{ x: '2026-09-01', y: 12 }] }));
      throw new Error('unerwartet: ' + url);
    };
    const r = await lookupIdealo({ ean: '4002515289693' }, fetchFn);
    expect(r).toMatchObject({ status: 'ok', productId: '201234567', lowPrice: 10, offerCount: 3, history: [{ date: '2026-09-01', price: 12 }] });
    expect(r.searchUrl).toContain('q=4002515289693');
    await lookupIdealo({ ean: '4002515289693' }, fetchFn);
    expect(calls).toHaveLength(2);
  });

  it('lädt die Produktseite aus dem ersten Suchtreffer', async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.includes('MainSearch')) return response('<a href="/preisvergleich/OffersOfProduct/201234567_-kaffeemaschine-xy.html">x</a>');
      if (url === PRODUCT_URL) return response(page({ '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 7 } }));
      return response('', { status: 404 });
    };
    expect(await lookupIdealo({ title: 'Kaffeemaschine' }, fetchFn)).toMatchObject({ status: 'ok', lowPrice: 7, history: [] });
  });

  it('meldet Bot-Schutz und liefert trotzdem den Such-Link', async () => {
    const r = await lookupIdealo({ ean: '123' }, async () => response('nope', { status: 403 }));
    expect(r.status).toBe('blocked');
    expect(r.searchUrl).toContain('idealo.de');
  });

  it('meldet, wenn nichts gefunden wird', async () => {
    const r = await lookupIdealo({ ean: '123' }, async () => response('<html>keine Treffer</html>'));
    expect(r.status).toBe('not_found');
  });

  it('meldet Netzwerkfehler statt zu werfen', async () => {
    const r = await lookupIdealo({ ean: '123' }, async () => { throw new Error('ECONNRESET'); });
    expect(r).toMatchObject({ status: 'error' });
    expect(r.message).toContain('ECONNRESET');
  });

  it('verlangt EAN oder Titel', async () => {
    await expect(lookupIdealo({})).rejects.toThrow(/EAN oder Titel/);
  });
});
