import { describe, expect, it } from 'vitest';
import { formatPrice, parseAmount } from '@/components/ebay/api';

describe('parseAmount', () => {
  it('deutsche Schreibweise: Komma dezimal, Punkt als Tausenderpunkt', () => {
    expect(parseAmount('19,99')).toBe(19.99);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1.234.567,89')).toBe(1234567.89);
    expect(parseAmount('0,5')).toBe(0.5);
    expect(parseAmount(' 12 ')).toBe(12);
  });

  it('englische Dezimalschreibweise mit ein oder zwei Nachkommastellen', () => {
    expect(parseAmount('19.99')).toBe(19.99);
    expect(parseAmount('8.5')).toBe(8.5);
  });

  it('ein Punkt vor drei Ziffern ist ein Tausenderpunkt — „1.200" ist nicht 1,20', () => {
    expect(parseAmount('1.200')).toBe(1200);
    expect(parseAmount('12.345')).toBe(12345);
  });

  it('ein hängendes Trennzeichen beim Tippen ist noch kein Fehler', () => {
    expect(parseAmount('8,')).toBe(8);
    expect(parseAmount('8.')).toBe(8);
  });

  it('leer und Unsinn bleiben undefined, damit nichts still als NaN oder null gesendet wird', () => {
    for (const input of ['', '   ', 'abc', '8,5o', '1,2,3', '1.2.3', '1..2', '1234.567', ',5']) {
      expect(parseAmount(input), input).toBeUndefined();
    }
  });
});

describe('formatPrice', () => {
  it('setzt ein echtes Minuszeichen', () => {
    expect(formatPrice(-5.05)).toMatch(/^−5,05\s€$/);
    expect(formatPrice(5.05)).toMatch(/^5,05\s€$/);
  });
});
