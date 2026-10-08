import { describe, expect, it } from 'vitest';
import {
  aspectProblems, aspectsFromError, isValidGtin, mapTaxonomyAspects, missingRequired, normalizeAspects, parseEan,
} from '@/lib/ebay/pipeline/aspects';

const taxonomy = {
  aspects: [
    { localizedAspectName: 'Farbe', aspectConstraint: { aspectRequired: false, aspectUsage: 'RECOMMENDED', aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'MULTI' }, aspectValues: [{ localizedValue: 'Weiß' }, { localizedValue: 'Schwarz' }] },
    { localizedAspectName: 'Stil', aspectConstraint: { aspectRequired: true, aspectUsage: 'RECOMMENDED', aspectMode: 'SELECTION_ONLY', itemToAspectCardinality: 'SINGLE' }, aspectValues: [{ localizedValue: 'Crew' }, { localizedValue: 'Sneaker' }] },
    { localizedAspectName: 'Marke', aspectConstraint: { aspectRequired: true, aspectUsage: 'RECOMMENDED', aspectMode: 'FREE_TEXT', itemToAspectCardinality: 'SINGLE', aspectMaxLength: 65 } },
    { localizedAspectName: 'Muster', aspectConstraint: { aspectUsage: 'OPTIONAL' } },
    { localizedAspectName: 'EAN', aspectConstraint: { aspectRequired: true } },
  ],
};

describe('Artikelmerkmale der Kategorie', () => {
  const defs = mapTaxonomyAspects(taxonomy);

  it('Pflicht zuerst, dann empfohlen, dann optional', () => {
    expect(defs.map((d) => d.name)).toEqual(['Stil', 'Marke', 'EAN', 'Farbe', 'Muster']);
    expect(defs[0]).toMatchObject({ required: true, selectionOnly: true, multi: false, values: ['Crew', 'Sneaker'] });
    expect(defs.find((d) => d.name === 'Farbe')).toMatchObject({ required: false, recommended: true, multi: true });
  });

  it('fehlende Pflichtangaben – EAN zählt über das EAN-Feld', () => {
    expect(missingRequired(defs, { Marke: ['Nike'] }, '')).toEqual(['Stil', 'EAN']);
    expect(missingRequired(defs, { marke: ['Nike'], Stil: ['Crew'] }, '4006381333931')).toEqual([]);
    expect(missingRequired(defs, { Marke: [' '], Stil: ['Crew'] }, '4006381333931')).toEqual(['Marke']);
  });

  it('säubert Eingaben und übernimmt die Schreibweise aus der eBay-Liste', () => {
    expect(normalizeAspects({ ' stil ': ['crew'], Farbe: ['Weiß', 'Weiß', ' '], Leer: [], Größe: '43' }, defs)).toEqual({ Stil: ['Crew'], Farbe: ['Weiß'], Größe: ['43'] });
    expect(() => normalizeAspects(['x'], defs)).toThrow();
    expect(() => normalizeAspects({ ['x'.repeat(70)]: ['a'] })).toThrow(/höchstens 65/);
  });

  it('meldet Werte, die eBay nicht annimmt', () => {
    expect(aspectProblems(defs, { Stil: ['Kniestrumpf'] })[0]).toMatch(/nicht in der eBay-Liste/);
    expect(aspectProblems(defs, { Stil: ['Crew', 'Sneaker'] })[0]).toMatch(/nur ein Wert/);
    expect(aspectProblems(defs, { Farbe: ['Weiß', 'Rot'] })).toEqual([]);
  });

  it('liest fehlende Merkmale aus eBays Fehlermeldung', () => {
    expect(aspectsFromError('Ein Nutzerfehler ist aufgetreten. Das Artikelmerkmal Stil fehlt. Fügen Sie Stil zu diesem Angebot hinzu')).toEqual(['Stil']);
    expect(aspectsFromError('The item specific Style is missing. | The item specific Size is missing.')).toEqual(['Style', 'Size']);
    expect(aspectsFromError('Das Artikelmerkmal „Schuhgröße“ fehlt.')).toEqual(['Schuhgröße']);
    expect(aspectsFromError(undefined)).toEqual([]);
  });

  it('EAN-Prüfziffer', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(parseEan(' 4006381-333931 ')).toBe('4006381333931');
    expect(parseEan('')).toBe('');
    expect(() => parseEan('4006381333932')).toThrow(/Prüfziffer/);
    expect(() => parseEan('abc')).toThrow(/Ziffern/);
  });
});
