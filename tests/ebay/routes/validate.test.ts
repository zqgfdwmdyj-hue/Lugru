import { describe, expect, it } from 'vitest';
import { parseCondition, parseOptionalPrice, parsePrice, parsePurchasedUnits, parseQuantity, purchaseUnitNet } from '@/lib/ebay/routes/api';

describe('parsePrice', () => {
  it('nimmt positive Zahlen (auch als String)', () => {
    expect(parsePrice(19.99)).toBe(19.99);
    expect(parsePrice('19.99')).toBe(19.99);
  });

  it('lehnt 0, negative Werte und Unsinn ab', () => {
    expect(() => parsePrice(0)).toThrow(/Preis/);
    expect(() => parsePrice(-1)).toThrow(/Preis/);
    expect(() => parsePrice('teuer')).toThrow(/Preis/);
    expect(() => parsePrice(undefined)).toThrow(/Preis/);
  });

  it('rundet auf Cent — Datenbank, Aufstellung und eBay führen dieselbe Zahl', () => {
    expect(parsePrice(19.999)).toBe(20);
    expect(parsePrice('19.995')).toBe(20);
    expect(parsePrice(19.994)).toBe(19.99);
    // Unter einem halben Cent bleibt nichts übrig — kein Preis von 0,00.
    expect(() => parsePrice(0.004)).toThrow(/Preis/);
  });
});

describe('parseQuantity', () => {
  it('nimmt ganze Zahlen ab 1', () => {
    expect(parseQuantity(1)).toBe(1);
    expect(parseQuantity('7')).toBe(7);
  });

  it('lehnt 0, Kommazahlen und Leereingaben ab', () => {
    expect(() => parseQuantity(0)).toThrow(/Stückzahl/);
    expect(() => parseQuantity(1.5)).toThrow(/Stückzahl/);
    expect(() => parseQuantity('')).toThrow(/Stückzahl/);
  });
});

describe('parseCondition', () => {
  it('nimmt die bekannten Zustände', () => {
    expect(parseCondition('NEW')).toBe('NEW');
    expect(parseCondition('USED_GOOD')).toBe('USED_GOOD');
  });

  it('lehnt unbekannte Zustände ab', () => {
    expect(() => parseCondition('KAPUTT')).toThrow(/Zustand/);
    expect(() => parseCondition(undefined)).toThrow(/Zustand/);
  });
});

describe('parsePurchasedUnits', () => {
  it('akzeptiert ganze Zahlen ab 1', () => {
    expect(parsePurchasedUnits(10)).toBe(10);
    expect(parsePurchasedUnits('10')).toBe(10);
  });

  it('leere Eingaben bleiben undefined — das Feld ist optional', () => {
    expect(parsePurchasedUnits(undefined)).toBeUndefined();
    expect(parsePurchasedUnits('')).toBeUndefined();
    expect(parsePurchasedUnits(null)).toBeUndefined();
  });

  it('weist Unsinn zurück', () => {
    expect(() => parsePurchasedUnits(0)).toThrow();
    expect(() => parsePurchasedUnits(-3)).toThrow();
    expect(() => parsePurchasedUnits(1.5)).toThrow();
    expect(() => parsePurchasedUnits('abc')).toThrow();
  });
});

describe('parseOptionalPrice', () => {
  it('akzeptiert positive Beträge', () => {
    expect(parseOptionalPrice(8.5)).toBe(8.5);
    expect(parseOptionalPrice('8.5')).toBe(8.5);
  });

  it('leer bleibt undefined', () => {
    expect(parseOptionalPrice('')).toBeUndefined();
    expect(parseOptionalPrice(undefined)).toBeUndefined();
  });

  it('weist Null und Negatives zurück', () => {
    expect(() => parseOptionalPrice(0)).toThrow();
    expect(() => parseOptionalPrice(-1)).toThrow();
  });

  it('rundet auf Cent', () => {
    expect(parseOptionalPrice(8.505)).toBe(8.51);
  });
});

describe('purchaseUnitNet', () => {
  it('lässt einen Netto-Stückpreis unverändert', () => {
    expect(purchaseUnitNet(8.5, {})).toBe(8.5);
    expect(purchaseUnitNet(8.5, { mode: 'unit', units: 10 })).toBe(8.5);
  });

  it('rechnet den Gesamtbetrag auf den Stückpreis um', () => {
    expect(purchaseUnitNet(80, { mode: 'total', units: 10 })).toBe(8);
  });

  it('ohne Stückzahl ist ein Gesamtbetrag ein Fehler — kein stiller Stückpreis', () => {
    expect(() => purchaseUnitNet(80, { mode: 'total' })).toThrow(/Einheiten/);
    expect(() => purchaseUnitNet(80, { mode: 'total', units: 0 })).toThrow(/Einheiten/);
  });

  it('ohne Preis bleibt es undefined', () => {
    expect(purchaseUnitNet(undefined, { mode: 'total', units: 10 })).toBeUndefined();
  });

  it('rechnet brutto auf netto herunter', () => {
    // 12,05 brutto bei 19 % → 10,13 netto (Pascals Beispielwert)
    expect(purchaseUnitNet(12.05, { vatMode: 'gross', vatPercentage: 19 })).toBe(10.13);
  });

  it('netto ist der Standard — ohne Schalter wird nicht umgerechnet', () => {
    expect(purchaseUnitNet(12.05, { vatPercentage: 19 })).toBe(12.05);
    expect(purchaseUnitNet(12.05, { vatMode: 'net', vatPercentage: 19 })).toBe(12.05);
  });

  it('ohne USt-Satz ist brutto ein Fehler — sonst würde brutto still als netto gespeichert', () => {
    expect(() => purchaseUnitNet(12.05, { vatMode: 'gross' })).toThrow(/USt-Satz/);
    expect(() => purchaseUnitNet(12.05, { vatMode: 'gross', vatPercentage: 0 })).toThrow(/USt-Satz/);
  });

  it('rundet Halb-Cent-Fälle kaufmännisch', () => {
    // 25,50 gesamt für 4 Stück = 6,375 → 6,38
    expect(purchaseUnitNet(25.5, { mode: 'total', units: 4 })).toBe(6.38);
  });

  it('kombiniert gesamt und brutto mit nur einer Rundung', () => {
    // 120,50 gesamt für 10 Stück, brutto → 12,05 → netto 10,126… → 10,13
    expect(purchaseUnitNet(120.5, { mode: 'total', units: 10, vatMode: 'gross', vatPercentage: 19 })).toBe(10.13);
  });

  it('rundet auf zwei Nachkommastellen', () => {
    expect(purchaseUnitNet(10, { mode: 'total', units: 3 })).toBe(3.33);
  });
});
