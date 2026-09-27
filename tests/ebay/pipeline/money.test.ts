import { describe, it, expect } from 'vitest';
import { roundCents, roundTo } from '@/lib/ebay/pipeline/money';

describe('roundCents', () => {
  it('rundet kaufmännisch auf Cent', () => {
    expect(roundCents(1.234)).toBe(1.23);
    expect(roundCents(1.235)).toBe(1.24);
    expect(roundCents(19.999)).toBe(20);
  });

  it('kippt Halb-Cent-Fälle nicht durch Gleitkomma-Artefakte nach unten', () => {
    // 8,50 × 5 % + 0,35 = 0,775 — im Rechner 0,7749999999999999
    expect(roundCents(8.5 * 5 / 100 + 0.35)).toBe(0.78);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(1234.565)).toBe(1234.57);
  });

  it('lässt echte Werte unter der Hälfte unten', () => {
    expect(roundCents(0.7749)).toBe(0.77);
    expect(roundCents(1.05 * 5 / 100 + 0.35)).toBe(0.4); // 0,4025
  });

  it('rundet negative Beträge vom Betrag weg von null', () => {
    expect(roundCents(-5.045)).toBe(-5.05);
    expect(roundCents(-5.044)).toBe(-5.04);
  });

  it('rundet auf beliebig viele Stellen — Prozentangaben auf eine', () => {
    expect(roundTo(30.457, 1)).toBe(30.5);
    expect(roundTo(30.45, 1)).toBe(30.5);
    expect(roundTo(-1.25, 1)).toBe(-1.3);
    expect(roundTo(2.5, 0)).toBe(3);
  });

  it('liefert nie -0', () => {
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
    expect(Object.is(roundCents(-0), 0)).toBe(true);
  });
});
