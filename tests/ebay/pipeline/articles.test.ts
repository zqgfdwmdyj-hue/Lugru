import { describe, it, expect } from 'vitest';
import { articleKey, groupArticles, keyOf } from '@/lib/ebay/pipeline/articles';
import type { ListingAttempt, Settings } from '@/lib/ebay/types';

/** Ohne USt und ohne Versandkosten, damit die Aggregat-Tests nur die Gruppierung prüfen. */
const settings: Settings = { env: 'production' };

function attempt(over: Partial<ListingAttempt> = {}): ListingAttempt {
  return {
    id: 1,
    ean: '4006381333931',
    price: 25,
    quantity: 1,
    condition: 'NEW',
    status: 'draft',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  };
}

describe('articleKey', () => {
  it('bevorzugt die EAN', () => {
    expect(articleKey({ ean: '400638', epid: '77', id: 5 })).toBe('ean:400638');
  });

  it('fällt ohne EAN auf die ePID zurück', () => {
    expect(articleKey({ ean: '', epid: '77', id: 5 })).toBe('epid:77');
  });

  it('bleibt ohne beides ein Einzelfall', () => {
    expect(articleKey({ id: 5 })).toBe('attempt:5');
  });
});

describe('keyOf', () => {
  it('nimmt den gespeicherten Schlüssel', () => {
    expect(keyOf(attempt({ articleKey: 'ean:alt', ean: '999' }))).toBe('ean:alt');
  });

  it('leitet ihn für Altbestand ohne gespeicherten Schlüssel ab', () => {
    expect(keyOf(attempt({ ean: '999' }))).toBe('ean:999');
  });
});

describe('groupArticles', () => {
  it('fasst Versuche mit gleichem Schlüssel zusammen und summiert', () => {
    const list = [
      attempt({
        id: 1, articleKey: 'ean:1', title: 'Alt', purchasedUnits: 10, purchasePrice: 8,
        purchaseSource: 'metro.de', price: 25, status: 'published',
        createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
      }),
      attempt({
        id: 2, articleKey: 'ean:1', title: 'Neu', purchasedUnits: 5, purchasePrice: 6,
        purchaseSource: 'Kaufland Filiale', price: 20, status: 'draft',
        createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
      }),
    ];
    const [a] = groupArticles(list, settings);
    expect(a.key).toBe('ean:1');
    expect(a.title).toBe('Neu');
    expect(a.purchasedUnits).toBe(15);
    expect(a.purchaseValue).toBe(110); // 10×8 + 5×6
    expect(a.avgPurchasePrice).toBe(7.33); // 110 / 15
    expect(a.merchants).toEqual(['Metro', 'Kaufland Filiale']);
    // Standardsatz 14 % + 0,45 fix: 10 × (25−8−3,95) + 5 × (20−6−3,25) = 184,25 / 15 Stück → 12,28
    expect(a.avgProfit).toBe(12.28);
    expect(a.listingCount).toBe(2);
    expect(a.publishedCount).toBe(1);
    expect(a.firstAt).toBe('2026-08-01T10:00:00.000Z');
    expect(a.lastAt).toBe('2026-08-05T10:00:00.000Z');
  });

  it('trennt verschiedene Schlüssel und sortiert neueste zuerst', () => {
    const list = [
      attempt({ id: 1, articleKey: 'ean:1', createdAt: '2026-08-01T10:00:00.000Z' }),
      attempt({ id: 2, articleKey: 'ean:2', createdAt: '2026-08-09T10:00:00.000Z' }),
    ];
    expect(groupArticles(list, settings).map((a) => a.key)).toEqual(['ean:2', 'ean:1']);
  });

  it('kommt mit Altbestand ohne Einkaufsdaten klar', () => {
    const [a] = groupArticles([attempt({ id: 1, ean: '5' })], settings);
    expect(a.key).toBe('ean:5');
    expect(a.purchasedUnits).toBe(0);
    expect(a.purchaseValue).toBe(0);
    expect(a.avgPurchasePrice).toBeUndefined();
    expect(a.avgProfit).toBeUndefined();
    expect(a.merchants).toEqual([]);
  });

  it('dedupliziert Händler unabhängig von der Schreibweise', () => {
    const list = [
      attempt({ id: 1, articleKey: 'ean:1', purchaseSource: 'Metro' }),
      attempt({ id: 2, articleKey: 'ean:1', purchaseSource: 'METRO' }),
      attempt({ id: 3, articleKey: 'ean:1', purchaseSource: 'https://www.metro.de/x' }),
    ];
    expect(groupArticles(list, settings)[0].merchants).toEqual(['Metro']);
  });

  it('mittelt nur über Versuche mit Einkaufspreis', () => {
    const list = [
      attempt({ id: 1, articleKey: 'ean:1', purchasedUnits: 2, purchasePrice: 10 }),
      attempt({ id: 2, articleKey: 'ean:1' }),
    ];
    expect(groupArticles(list, settings)[0].avgPurchasePrice).toBe(10);
  });

  it('gewichtet Ø Gewinn nach Einheiten, genau wie Ø EK', () => {
    // 100 Stück mit 10 € Gewinn je Stück und 1 Stück mit 0 € → 9,90, nicht 5,00.
    const list = [
      attempt({ id: 1, articleKey: 'ean:1', purchasedUnits: 100, purchasePrice: 11.05, price: 25 }), // 25 − 11,05 − 3,95 = 10
      attempt({ id: 2, articleKey: 'ean:1', purchasedUnits: 1, purchasePrice: 21.05, price: 25 }), // 25 − 21,05 − 3,95 = 0
    ];
    const [a] = groupArticles(list, settings);
    expect(a.avgPurchasePrice).toBe(11.15); // (1105 + 21,05) / 101
    expect(a.avgProfit).toBe(9.9); // 1000 / 101
  });
});
