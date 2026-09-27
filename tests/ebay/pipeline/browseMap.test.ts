import { describe, expect, it } from 'vitest';
import { extractCatalogProduct, extractListingFacts, extractListingImages } from '@/lib/ebay/pipeline/browseMap';
import browseItem from './fixtures/browse-item.json';

describe('extractCatalogProduct', () => {
  it('extrahiert Katalogdaten aus dem product-Block eines Browse-Items', () => {
    const p = extractCatalogProduct(browseItem);
    expect(p).not.toBeNull();
    expect(p!.origin).toBe('catalog');
    expect(p!.epid).toBe('27000723598');
    expect(p!.title).toBe('Bosch Professional GSR 12V-15 Akku-Bohrschrauber 12 V mit 2 Akkus');
    expect(p!.description).toContain('kompakte Akku-Bohrschrauber');
    expect(p!.imageUrls).toEqual([
      'https://i.ebayimg.com/images/g/main/s-l500.jpg',
      'https://i.ebayimg.com/images/g/two/s-l500.jpg',
      'https://i.ebayimg.com/images/g/three/s-l500.jpg',
    ]);
    expect(p!.aspects).toEqual({
      Marke: ['Bosch'],
      Spannung: ['12 V'],
      Produktart: ['Bohrschrauber', 'Schrauber'],
    });
    expect(p!.brand).toBe('Bosch');
    expect(p!.categoryId).toBe('71283');
  });

  it('übernimmt NIE Verkäufer-Inhalte (Titel, Foto, Beschreibung des Listings)', () => {
    const p = extractCatalogProduct(browseItem)!;
    expect(p.title).not.toContain('BLITZVERSAND');
    expect(p.imageUrls.join()).not.toContain('SELLERPHOTO');
    expect(p.description ?? '').not.toContain('Verkäufer-HTML');
  });

  it('Item ohne product-Block und ohne ePID → null (kein Katalogbezug, siehe extractListingFacts)', () => {
    expect(extractCatalogProduct({ itemId: 'v1|1|0', title: 'x' })).toBeNull();
  });

  it('Referenz-Fall: kein product-Block, aber ePID-Hint → Fakten ohne Titel/Bilder', () => {
    const item = {
      itemId: 'v1|5|0',
      title: 'Verkäufertitel SUPER DEAL',
      brand: 'STABILO',
      categoryId: '104121',
      image: { imageUrl: 'https://x/seller.jpg' },
      localizedAspects: [
        { type: 'STRING', name: 'Marke', value: 'STABILO' },
        { type: 'STRING', name: 'Produktart', value: 'Fineliner' },
      ],
    };
    const p = extractCatalogProduct(item, '25011365921');
    expect(p).not.toBeNull();
    expect(p!.epid).toBe('25011365921');
    expect(p!.title).toBe(''); // kein Katalogtitel verfügbar — wird später generiert/eingegeben
    expect(p!.imageUrls).toEqual([]); // Verkäuferfoto wird nicht übernommen
    expect(p!.aspects).toEqual({ Marke: ['STABILO'], Produktart: ['Fineliner'] });
    expect(p!.brand).toBe('STABILO');
    expect(p!.categoryId).toBe('104121');
  });

  it('ePID-Hint ergänzt auch ein Item mit product-Block ohne eigenes epid-Feld', () => {
    const item = { itemId: 'v1|6|0', product: { title: 'Katalog-Titel', image: { imageUrl: 'https://x/k.jpg' } } };
    const p = extractCatalogProduct(item, '777');
    expect(p!.epid).toBe('777');
    expect(p!.title).toBe('Katalog-Titel');
  });

  it('Item mit product-Block ohne Titel → null', () => {
    expect(extractCatalogProduct({ itemId: 'v1|1|0', product: { brand: 'X' } })).toBeNull();
  });

  it('nutzt localizedAspects des Items als Fallback, wenn der product-Block keine aspectGroups hat', () => {
    const item = {
      itemId: 'v1|2|0',
      leafCategoryIds: ['9355'],
      localizedAspects: [
        { type: 'STRING', name: 'Marke', value: 'ACME' },
        { type: 'STRING', name: 'Farbe', value: 'Rot' },
        { type: 'STRING', name: 'Farbe', value: 'Blau' },
      ],
      product: {
        title: 'ACME Ding',
        image: { imageUrl: 'https://x/1.jpg' },
      },
    };
    const p = extractCatalogProduct(item)!;
    expect(p.aspects).toEqual({ Marke: ['ACME'], Farbe: ['Rot', 'Blau'] });
    expect(p.imageUrls).toEqual(['https://x/1.jpg']);
    expect(p.categoryId).toBe('9355');
    expect(p.epid).toBeUndefined();
  });

  it('dedupliziert Katalogbilder', () => {
    const item = {
      itemId: 'v1|3|0',
      product: {
        title: 'T',
        image: { imageUrl: 'https://x/1.jpg' },
        additionalImages: [{ imageUrl: 'https://x/1.jpg' }, { imageUrl: 'https://x/2.jpg' }],
      },
    };
    expect(extractCatalogProduct(item)!.imageUrls).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
  });
});

describe('extractListingFacts', () => {
  it('Angebot ohne Katalogbezug → Merkmale, Marke und Kategorie des Angebots', () => {
    const item = {
      itemId: 'v1|7|0',
      title: 'Verkäufertitel SUPER DEAL',
      description: '<p>Verkäufer-HTML</p>',
      brand: 'STABILO',
      leafCategoryIds: ['104121'],
      image: { imageUrl: 'https://x/seller.jpg' },
      localizedAspects: [
        { type: 'STRING', name: 'Marke', value: 'STABILO' },
        { type: 'STRING', name: 'Produktart', value: 'Fineliner' },
      ],
    };
    const p = extractListingFacts(item)!;
    expect(p.origin).toBe('listing');
    expect(p.epid).toBeUndefined();
    expect(p.aspects).toEqual({ Marke: ['STABILO'], Produktart: ['Fineliner'] });
    expect(p.brand).toBe('STABILO');
    expect(p.categoryId).toBe('104121');
  });

  it('übernimmt auch ohne Katalog NIE Verkäufer-Inhalte (Titel, Foto, Beschreibung)', () => {
    const p = extractListingFacts(browseItem)!;
    expect(p.title).toBe(''); // Titel entsteht später aus den Fakten oder per Eingabe
    expect(p.description).toBeUndefined();
    expect(p.imageUrls).toEqual([]); // Angebotsfotos kommen über extractListingImages
  });

  it('ohne Merkmale bleibt ein leeres Faktengerüst — Kategorie zählt trotzdem', () => {
    const p = extractListingFacts({ itemId: 'v1|8|0', categoryId: '9355' })!;
    expect(p).toMatchObject({ origin: 'listing', title: '', aspects: {}, categoryId: '9355' });
    expect(p.brand).toBeUndefined();
  });

  it('kein Objekt → null', () => {
    expect(extractListingFacts(null)).toBeNull();
    expect(extractListingFacts('v1|1|0')).toBeNull();
  });
});

describe('extractListingImages', () => {
  it('liest Haupt- und Zusatzbild des Listings', () => {
    const item = {
      image: { imageUrl: 'https://i.ebayimg.com/a.jpg' },
      additionalImages: [{ imageUrl: 'https://i.ebayimg.com/b.jpg' }, { imageUrl: 'https://i.ebayimg.com/c.jpg' }],
    };
    expect(extractListingImages(item)).toEqual([
      'https://i.ebayimg.com/a.jpg',
      'https://i.ebayimg.com/b.jpg',
      'https://i.ebayimg.com/c.jpg',
    ]);
  });

  it('nimmt das Hauptbild nur einmal, wenn es auch in additionalImages steht', () => {
    const item = {
      image: { imageUrl: 'https://i.ebayimg.com/a.jpg' },
      additionalImages: [{ imageUrl: 'https://i.ebayimg.com/a.jpg' }, { imageUrl: 'https://i.ebayimg.com/b.jpg' }],
    };
    expect(extractListingImages(item)).toEqual(['https://i.ebayimg.com/a.jpg', 'https://i.ebayimg.com/b.jpg']);
  });

  it('liefert eine leere Liste, wenn das Item keine Bilder hat', () => {
    expect(extractListingImages({ itemId: 'v1|1|0' })).toEqual([]);
    expect(extractListingImages(null)).toEqual([]);
    expect(extractListingImages({ image: {}, additionalImages: [{}] })).toEqual([]);
  });

  it('liest das Verkäuferfoto des echten Browse-Items', () => {
    expect(extractListingImages(browseItem)).toEqual([
      'https://i.ebayimg.com/images/g/SELLERPHOTO/s-l1600.jpg',
    ]);
  });
});
