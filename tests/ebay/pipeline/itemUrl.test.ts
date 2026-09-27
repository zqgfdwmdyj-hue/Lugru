import { describe, expect, it } from 'vitest';
import { parseEbayItemUrl, parseSearchInputAsItemUrl } from '@/lib/ebay/pipeline/itemUrl';

describe('parseEbayItemUrl', () => {
  it('extrahiert die Artikelnummer aus einer vollen ebay.de-URL mit Parametern', () => {
    const url =
      'https://www.ebay.de/itm/404770748596?_skw=404770748596&itmmeta=01M1A28BDDADWWVC5KW3WEFTZ0&hash=item5e3e3778b4:g:vKkAAeSwdqlqZJhv&itmprp=enc%3AAQALAAAA8GfYFPkwiKCW4ZNSs2u11xC1%2FCLMBiKJuWusf9AFxoGzlAgWkxynNKy8fmbPRZoeTbO224AqcBvYqo%2FD7CUgM%2Fd%2BHWO5U4lyHDnT8AD6yWL7rerqmfA58DaAKbSgz3KbE3UTZASjukrSMRyHSe5F%2F4XA2q1GnTAReEG3G4%2BjxRCbT8RxXZDUV8ze19eFZ%2FCNnxvC2d1EANOk24%2FCkGfKNcdeg6d4Rmj1avk5ZYgYB5fuZkkk4i4Svmts4PGefRocLxjvFLXY2liDBl6ijmlaHlUeBdlIqe1tbrzTUKc7c4SVGwDhn%2B4TIaXij8nAe7Rq1g%3D%3D%7Ctkp%3ABk9SR-62ocKKaA';
    expect(parseEbayItemUrl(url)).toBe('404770748596');
  });

  it('versteht die alte Form mit Titel-Slug im Pfad', () => {
    expect(parseEbayItemUrl('https://www.ebay.de/itm/Bosch-GSR-12V-15-Akkuschrauber/283899210390?hash=x')).toBe('283899210390');
  });

  it('versteht ebay.com und andere Marktplätze', () => {
    expect(parseEbayItemUrl('https://www.ebay.com/itm/404770748596')).toBe('404770748596');
    expect(parseEbayItemUrl('https://www.ebay.at/itm/404770748596')).toBe('404770748596');
  });

  it('akzeptiert eine nackte Artikelnummer', () => {
    expect(parseEbayItemUrl('404770748596')).toBe('404770748596');
    expect(parseEbayItemUrl('  404770748596  ')).toBe('404770748596');
  });

  it('lehnt Nicht-eBay-Eingaben ab', () => {
    expect(parseEbayItemUrl('stabilo point 88')).toBeNull();
    expect(parseEbayItemUrl('https://www.amazon.de/dp/B000KT6OTA')).toBeNull();
    expect(parseEbayItemUrl('12345')).toBeNull(); // zu kurz für eine Artikelnummer
    expect(parseEbayItemUrl('')).toBeNull();
  });

  it('erkennt, ob eine Eingabe als eBay-Link gemeint ist', () => {
    expect(parseEbayItemUrl('https://www.ebay.de/itm/vielzeichen')).toBeNull();
  });
});

describe('parseSearchInputAsItemUrl', () => {
  it('übernimmt eine eingefügte Artikel-URL', () => {
    expect(parseSearchInputAsItemUrl('https://www.ebay.de/itm/404770748596?hash=x')).toBe('404770748596');
    expect(parseSearchInputAsItemUrl('  ebay.de/itm/404770748596  ')).toBe('404770748596');
  });

  it('lässt Suchbegriffe mit „ebay." im Text Suchbegriffe bleiben', () => {
    expect(parseSearchInputAsItemUrl('bohrer ebay.de test')).toBeNull();
    expect(parseSearchInputAsItemUrl('ebay.de Angebote')).toBeNull();
  });

  it('behandelt nackte Ziffern als EAN, nicht als Artikelnummer', () => {
    expect(parseSearchInputAsItemUrl('4006381333931')).toBeNull();
    expect(parseSearchInputAsItemUrl('404770748596')).toBeNull();
  });

  it('ignoriert Nicht-eBay-Links', () => {
    expect(parseSearchInputAsItemUrl('https://www.amazon.de/dp/B000KT6OTA')).toBeNull();
  });
});
