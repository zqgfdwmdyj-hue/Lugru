import { describe, it, expect } from 'vitest';
import { computeProfit } from '@/lib/ebay/pipeline/profit';

describe('computeProfit', () => {
  it('rechnet Pascals Beispiel exakt nach', () => {
    const p = computeProfit({
      salePrice: 35,
      purchasePrice: 10.13,
      fee: 5.25,
      shipping: 3.37,
      vatPercentage: 19,
    })!;
    expect(p.vat).toBe(5.59);
    expect(p.profit).toBe(10.66);
  });

  it('die angezeigten Zeilen summieren sich exakt zum Gewinn', () => {
    const p = computeProfit({
      salePrice: 35, purchasePrice: 10.13, fee: 5.25, shipping: 3.37, vatPercentage: 19,
    })!;
    const summe = p.salePrice - p.vat! - p.purchasePrice - p.fee - p.shipping;
    expect(Math.round(summe * 100) / 100).toBe(p.profit);
  });

  it('ohne USt-Satz entfällt die Umsatzsteuer-Zeile', () => {
    const p = computeProfit({ salePrice: 35, purchasePrice: 10.13, fee: 5.25, shipping: 3.37 })!;
    expect(p.vat).toBeUndefined();
    expect(p.profit).toBe(16.25); // 35 − 10,13 − 5,25 − 3,37
  });

  it('ohne Einkaufspreis gibt es keinen Gewinn — keine geschätzten Zahlen', () => {
    expect(computeProfit({ salePrice: 35, fee: 5.25 })).toBeNull();
    expect(computeProfit({ salePrice: 35, purchasePrice: 0, fee: 5.25 })).toBeNull();
  });

  it('ohne Verkaufspreis gibt es nichts zu rechnen', () => {
    expect(computeProfit({ salePrice: 0, purchasePrice: 10, fee: 1 })).toBeNull();
  });

  it('Versand ist optional', () => {
    const p = computeProfit({ salePrice: 35, purchasePrice: 10.13, fee: 5.25, vatPercentage: 19 })!;
    expect(p.shipping).toBe(0);
    expect(p.profit).toBe(14.03);
  });

  it('darf negativ werden', () => {
    const p = computeProfit({ salePrice: 10, purchasePrice: 12, fee: 1.45, vatPercentage: 19 })!;
    expect(p.profit).toBeLessThan(0);
    expect(p.profit).toBe(-5.05); // 10 − 1,60 − 12 − 1,45
  });

  it('rechnet den Gewinn in Prozent auf den Bruttopreis', () => {
    const p = computeProfit({
      salePrice: 35, purchasePrice: 10.13, fee: 5.25, shipping: 3.37, vatPercentage: 19,
    })!;
    expect(p.profitPercent).toBe(30.5); // 10,66 / 35 = 30,457 %
  });

  it('kommt mit anderen USt-Sätzen klar', () => {
    const p = computeProfit({ salePrice: 107, purchasePrice: 50, fee: 10, vatPercentage: 7 })!;
    expect(p.vat).toBe(7); // 107 × 7/107
    expect(p.profit).toBe(40);
  });
});
