import { describe, it, expect } from 'vitest';
import { estimateFee, resolveFeeRate } from '@/lib/ebay/pipeline/fees';
import type { Settings } from '@/lib/ebay/types';

const base: Settings = { env: 'production' };

describe('resolveFeeRate', () => {
  it('nimmt den Satz aus der mitgelieferten Tabelle', () => {
    expect(resolveFeeRate('15032', 'NEW', base)).toEqual({ percent: 7, matched: true });
  });

  it('nimmt den ermäßigten Satz bei gebrauchten Artikeln', () => {
    expect(resolveFeeRate('15032', 'USED_GOOD', base)).toEqual({ percent: 5, matched: true });
    expect(resolveFeeRate('15032', 'NEW_OTHER', base)).toEqual({ percent: 5, matched: true });
  });

  it('gibt die Staffel mit heraus', () => {
    expect(resolveFeeRate('11450', 'NEW', base)).toEqual({
      percent: 12,
      tierLimit: 990,
      tierPercent: 3,
      matched: true,
    });
  });

  it('eigener Satz sticht die Tabelle und gilt für alle Artikelzustände', () => {
    const s: Settings = { ...base, feeCategoryRates: { '15032': 9 } };
    expect(resolveFeeRate('15032', 'NEW', s)).toEqual({ percent: 9, matched: true });
    expect(resolveFeeRate('15032', 'USED_GOOD', s)).toEqual({ percent: 9, matched: true });
  });

  it('gestaffelte Kategorien kennen keinen ermäßigten Satz — dort gilt auch gebraucht der volle', () => {
    // eBays Tarifseite führt die Spalte „bestimmte Artikelzustände" nur bei den
    // Festsatz-Tabellen. Kleidung (11450), Medien (11232) und Spielzeug (220)
    // stehen in den gestaffelten Tabellen ohne diese Spalte.
    for (const category of ['11450', '11232', '220']) {
      expect(resolveFeeRate(category, 'USED_GOOD', base)).toEqual(
        resolveFeeRate(category, 'NEW', base)
      );
    }
    expect(resolveFeeRate('11450', 'USED_ACCEPTABLE', base).percent).toBe(12);
  });

  it('unbekannte Kategorie fällt auf den Standardsatz und meldet matched=false', () => {
    expect(resolveFeeRate('71283', 'NEW', base)).toEqual({ percent: 14, matched: false });
    expect(resolveFeeRate(undefined, 'NEW', base)).toEqual({ percent: 14, matched: false });
    expect(resolveFeeRate('71283', 'NEW', { ...base, feePercent: 10 })).toEqual({
      percent: 10,
      matched: false,
    });
  });
});

describe('estimateFee', () => {
  const flat = { percent: 10, matched: true };

  it('rechnet Prozentsatz plus Fixbetrag', () => {
    // 20,00 × 10 % = 2,00 + 0,45 (über 10,00) = 2,45
    expect(estimateFee(20, flat, base)).toBe(2.45);
  });

  it('nutzt bei genau 10,00 noch den kleinen Fixbetrag', () => {
    // 10,00 × 10 % = 1,00 + 0,35 = 1,35
    expect(estimateFee(10, flat, base)).toBe(1.35);
  });

  it('rechnet die Staffel anteilig', () => {
    const tiered = { percent: 12, tierLimit: 990, tierPercent: 3, matched: true };
    // 990 × 12 % = 118,80 ; 10 × 3 % = 0,30 ; + 0,45 = 119,55
    expect(estimateFee(1000, tiered, base)).toBe(119.55);
  });

  it('lässt die eigenen Versandkosten aus der Bemessungsgrundlage heraus', () => {
    // Versandkostenfrei: der Käufer zahlt 20,00, mehr bemisst eBay nicht.
    // shippingAssumption sind unsere Kosten und gehören in die Gewinnrechnung, nicht hierher.
    expect(estimateFee(20, flat, { ...base, shippingAssumption: 5 })).toBe(2.45);
  });

  it('respektiert eigene Fixbeträge', () => {
    const s: Settings = { ...base, feeFixed: 0, feeFixedAbove: 0, feeFixedThreshold: 10 };
    expect(estimateFee(20, flat, s)).toBe(2);
  });
});
