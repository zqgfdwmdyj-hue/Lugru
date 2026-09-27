import { describe, expect, it } from 'vitest';
import { imageUrlsFromProduct, isAsin, lookupKeepaImages, type FetchLike } from '@/lib/ebay/keepa/keepa';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('isAsin', () => {
  it('erkennt ASIN und ISBN-10, aber keine EAN', () => {
    expect(isAsin('B08N5WRWNW')).toBe(true);
    expect(isAsin('349913599X')).toBe(true);
    expect(isAsin('4002515289693')).toBe(false);
  });
});

describe('imageUrlsFromProduct', () => {
  it('liest das neue images-Format (große Variante)', () => {
    expect(imageUrlsFromProduct({ images: [{ l: 'A1.jpg', m: 'a1.jpg' }, { m: 'B2.jpg' }] })).toEqual([
      'https://m.media-amazon.com/images/I/A1.jpg',
      'https://m.media-amazon.com/images/I/B2.jpg',
    ]);
  });

  it('fällt auf imagesCSV zurück und entfernt Doppelte', () => {
    expect(imageUrlsFromProduct({ imagesCSV: 'X.jpg, Y.jpg,X.jpg' })).toEqual([
      'https://m.media-amazon.com/images/I/X.jpg',
      'https://m.media-amazon.com/images/I/Y.jpg',
    ]);
  });
});

describe('lookupKeepaImages', () => {
  it('fragt per EAN auf amazon.de und liefert Bilder, ASIN und Link', async () => {
    let called = '';
    const fetchFn: FetchLike = async (url) => {
      called = url;
      return json({ tokensLeft: 42, products: [
        { asin: 'B000000001', title: 'Ohne Bild' },
        { asin: 'B08N5WRWNW', title: 'Kaffeemaschine', imagesCSV: 'P1.jpg,P2.jpg' },
      ] });
    };
    const r = await lookupKeepaImages('4002515289693', 'KEY', fetchFn);
    expect(called).toContain('domain=3');
    expect(called).toContain('code=4002515289693');
    expect(r).toEqual({
      asin: 'B08N5WRWNW', title: 'Kaffeemaschine', tokensLeft: 42,
      amazonUrl: 'https://www.amazon.de/dp/B08N5WRWNW',
      images: ['https://m.media-amazon.com/images/I/P1.jpg', 'https://m.media-amazon.com/images/I/P2.jpg'],
    });
  });

  it('fragt eine ASIN über den asin-Parameter', async () => {
    let called = '';
    await lookupKeepaImages('b08n5wrwnw', 'KEY', async (url) => { called = url; return json({ products: [] }); });
    expect(called).toContain('asin=B08N5WRWNW');
  });

  it('liefert leere Liste, wenn Amazon das Produkt nicht kennt', async () => {
    expect((await lookupKeepaImages('4002515289693', 'KEY', async () => json({ products: [] }))).images).toEqual([]);
  });

  it('übersetzt Keepa-Fehler', async () => {
    await expect(lookupKeepaImages('4002515289693', 'KEY', async () => json({}, 401))).rejects.toThrow(/ungültig/);
    await expect(lookupKeepaImages('4002515289693', 'KEY', async () => json({ error: { type: 'notEnoughToken' } }, 429))).rejects.toThrow(/Tokens/);
  });

  it('verlangt Schlüssel und gültigen Code', async () => {
    await expect(lookupKeepaImages('4002515289693', undefined)).rejects.toThrow(/Schlüssel/);
    await expect(lookupKeepaImages('abc', 'KEY')).rejects.toThrow(/weder/);
  });
});
