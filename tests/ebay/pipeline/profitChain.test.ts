import { describe, expect, it } from 'vitest';
import { groupArticles } from '@/lib/ebay/pipeline/articles';
import { estimateFee, resolveFeeRate } from '@/lib/ebay/pipeline/fees';
import { computeProfit } from '@/lib/ebay/pipeline/profit';
import type { ListingAttempt, Settings } from '@/lib/ebay/types';

/**
 * Die ganze Kette in einem Lauf: Rundung → Gebühr → Gewinn → Artikel-Aggregat,
 * über Versuche mit gemischten Stückzahlen (keine / 1 / 100), mit USt,
 * Versandkosten, eigenem Kategoriesatz, ermäßigtem Satz und einem
 * Halb-Cent-Fall in der Gebühr. Die Erwartungswerte sind von Hand gerechnet.
 */
const settings: Settings = {
  env: 'production',
  vatPercentage: 19,
  shippingAssumption: 3.37,
  feeCategoryRates: { '900100': 15 },
};

function attempt(over: Partial<ListingAttempt>): ListingAttempt {
  return {
    id: 1,
    ean: '4006381333931',
    articleKey: 'ean:4006381333931',
    price: 25,
    quantity: 1,
    condition: 'NEW',
    status: 'draft',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  };
}

// A: keine Stückzahl → zählt als eine Einheit. Eigener Satz 15 % + 0,45.
const a = attempt({ id: 1, price: 35, purchasePrice: 10.13, categoryId: '900100' });
// B: 1 Stück, Technik neu 7 % + 0,45.
const b = attempt({ id: 2, price: 20, purchasedUnits: 1, purchasePrice: 8.5, categoryId: '15032' });
// C: 100 Stück, Technik gebraucht 5 % + 0,35 (unter 10 €) — 0,425 + 0,35 = 0,775 ist der Halb-Cent-Fall.
const c = attempt({ id: 3, price: 8.5, purchasedUnits: 100, purchasePrice: 5, categoryId: '15032', condition: 'USED_GOOD' });

function profitOf(x: ListingAttempt) {
  const fee = estimateFee(x.price, resolveFeeRate(x.categoryId, x.condition, settings), settings);
  return computeProfit({
    salePrice: x.price,
    purchasePrice: x.purchasePrice,
    fee,
    shipping: settings.shippingAssumption,
    vatPercentage: settings.vatPercentage,
  })!;
}

describe('Rechenkette Rundung → Gebühr → Gewinn → Artikel', () => {
  it('rechnet jeden Versuch wie von Hand', () => {
    // A: USt 35 × 19/119 = 5,59; Gebühr 5,25 + 0,45 = 5,70; 35 − 5,59 − 10,13 − 5,70 − 3,37 = 10,21
    expect(profitOf(a)).toMatchObject({ vat: 5.59, fee: 5.7, profit: 10.21 });
    // B: USt 20 × 19/119 = 3,19; Gebühr 1,40 + 0,45 = 1,85; 20 − 3,19 − 8,50 − 1,85 − 3,37 = 3,09
    expect(profitOf(b)).toMatchObject({ vat: 3.19, fee: 1.85, profit: 3.09 });
    // C: USt 8,50 × 19/119 = 1,36; Gebühr 0,775 → 0,78 (kaufmännisch); 8,50 − 1,36 − 5,00 − 0,78 − 3,37 = −2,01
    expect(profitOf(c)).toMatchObject({ vat: 1.36, fee: 0.78, profit: -2.01 });
  });

  it('gewichtet das Artikel-Aggregat nach Einheiten und rundet erst am Ende', () => {
    const [article] = groupArticles([a, b, c], settings);
    expect(article.purchasedUnits).toBe(101); // ohne A, das keine Stückzahl hat
    // Einkaufswert: 1 × 10,13 + 1 × 8,50 + 100 × 5,00 = 518,63 über 102 gewichtete Einheiten
    expect(article.purchaseValue).toBe(518.63);
    expect(article.avgPurchasePrice).toBe(5.08); // 518,63 / 102 = 5,0846
    // Ø Gewinn: (1 × 10,21 + 1 × 3,09 + 100 × −2,01) / 102 = −187,70 / 102 = −1,8402
    expect(article.avgProfit).toBe(-1.84);
    expect(article.listingCount).toBe(3);
  });

  it('lässt Versuche ohne Einkaufspreis aus dem Schnitt, zählt sie aber als Listing', () => {
    const d = attempt({ id: 4, price: 30, purchasedUnits: 50 });
    const [article] = groupArticles([a, b, c, d], settings);
    expect(article.avgProfit).toBe(-1.84);
    expect(article.purchasedUnits).toBe(151);
    expect(article.listingCount).toBe(4);
  });
});
