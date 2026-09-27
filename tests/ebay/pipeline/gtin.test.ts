import { describe, it, expect } from 'vitest';
import { extractGtin, extractGtins, isRealGtin, itemCarriesGtin, sameGtin } from '@/lib/ebay/pipeline/gtin';

describe('isRealGtin', () => {
  it('nimmt 8 bis 14 Ziffern', () => {
    expect(isRealGtin('4006381333931')).toBe(true);
    expect(isRealGtin('04006381333931')).toBe(true);
    expect(isRealGtin('12345678')).toBe(true);
  });

  it('weist Verkäufertexte und Zahlen anderer Länge zurück', () => {
    expect(isRealGtin('Nicht zutreffend')).toBe(false);
    expect(isRealGtin('1234567')).toBe(false);
    expect(isRealGtin(4006381333931)).toBe(false);
  });
});

describe('sameGtin', () => {
  it('ignoriert führende Nullen', () => {
    expect(sameGtin('04006381333931', '4006381333931')).toBe(true);
    expect(sameGtin('4006381333931', '4006381333948')).toBe(false);
  });
});

describe('extractGtins', () => {
  it('liest gtin-Feld und EAN-Aspekte, ohne Dubletten', () => {
    const item = {
      gtin: '4006381333931',
      localizedAspects: [
        { name: 'EAN', value: '04006381333931' },
        { name: 'Marke', value: 'Bosch' },
        { name: 'UPC', value: ['885909950805'] },
      ],
    };
    expect(extractGtins(item)).toEqual(['4006381333931', '885909950805']);
    expect(extractGtin(item)).toBe('4006381333931');
  });

  it('übergeht Verkäufertexte im gtin-Feld', () => {
    expect(extractGtins({ gtin: 'Nicht zutreffend' })).toEqual([]);
    expect(extractGtin({ gtin: 'Nicht zutreffend' })).toBeUndefined();
    expect(extractGtins(null)).toEqual([]);
  });
});

describe('itemCarriesGtin', () => {
  it('findet die EAN im gtin-Feld oder in einem Aspekt', () => {
    expect(itemCarriesGtin({ gtin: '04006381333931' }, '4006381333931')).toBe(true);
    expect(itemCarriesGtin({ localizedAspects: [{ name: 'GTIN', value: '4006381333931' }] }, '4006381333931')).toBe(true);
  });

  it('lässt sich von der Nummer im Titel nicht täuschen', () => {
    expect(itemCarriesGtin({ title: 'Bohrer 4006381333931', gtin: '4006381333948' }, '4006381333931')).toBe(false);
  });
});
