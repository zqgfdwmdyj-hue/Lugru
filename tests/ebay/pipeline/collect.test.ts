import { describe, expect, it, vi } from 'vitest';
import {listAttempts} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { CatalogProduct, Gpsr } from '@/lib/ebay/types';
import { applyFetchedItem, collectFromSelection, recollectWithMatch, type CollectSources } from '@/lib/ebay/pipeline/collect';

const product: CatalogProduct = {
  origin: 'catalog',
  epid: 'E1',
  title: 'Bosch Professional GSR 12V-15 Akku-Bohrschrauber 12 V mit 2 Akkus Ladegerät und Tasche im Karton',
  description: 'Der kompakte Bohrschrauber.',
  imageUrls: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg'],
  aspects: { Marke: ['Bosch'], Spannung: ['12 V'] },
  brand: 'Bosch',
  categoryId: '71283',
};

const gpsr: Gpsr = {
  manufacturer: { companyName: 'Bosch GmbH', addressLine1: 'Weg 1', city: 'Stuttgart', country: 'DE' },
  responsiblePersons: [],
  sourceItemId: 'v1|1|0',
};

const matches = [
  { ref: 'v1|1|0', epid: 'E1', title: 'Treffer 1' },
  { ref: 'v1|2|0', epid: 'E2', title: 'Treffer 2' },
];

function sources(overrides: Partial<CollectSources> = {}): CollectSources {
  return {
    // Der EAN-Sweep dient im neuen Flow nur noch als GPSR-Nachschlag.
    lookupByEan: vi.fn(async () => ({ matches, product, gpsr })),
    fetchItemByRef: vi.fn(async (ref: string) => ({
      product: { ...product, epid: ref === 'v1|2|0' ? 'E2' : 'E1' },
      gpsr: null,
    })),
    ...overrides,
  };
}

/** Auswahl aus der Trefferliste + eingegebene Verkaufsdaten. */
const selection = {
  ref: 'v1|1|0',
  epid: 'E1',
  ean: '3165140776649',
  price: 89.99,
  quantity: 1,
  condition: 'NEW' as const,
};

describe('collectFromSelection', () => {
  it('gewählter Treffer → draft mit gekürztem Titel, Beschreibung, Bildern, GPSR', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, sources(), selection);
    expect(a.status).toBe('draft');
    expect(a.ean).toBe('3165140776649');
    expect(a.price).toBe(89.99);
    expect(a.epid).toBe('E1');
    expect(a.title!.length).toBeLessThanOrEqual(80);
    expect(a.description).toContain('kompakte Bohrschrauber');
    expect(a.imageUrls).toHaveLength(2);
    expect(a.categoryId).toBe('71283');
    expect(a.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
    expect(a.catalogMatches).toEqual([{ ref: 'v1|1|0', epid: 'E1', title: product.title }]);
    expect(a.warnings ?? []).toHaveLength(0);
  });

  it('GPSR im gewählten Listing → kein zusätzlicher EAN-Sweep', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product, gpsr })) });
    const a = await collectFromSelection(db, s, selection);
    expect(a.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
    expect(s.lookupByEan).not.toHaveBeenCalled();
  });

  it('GPSR fehlt im Listing → wird über die EAN aus anderen Angeboten nachgeschlagen', async () => {
    const db = openMemoryDb();
    const s = sources();
    const a = await collectFromSelection(db, s, selection);
    expect(s.lookupByEan).toHaveBeenCalledWith('3165140776649');
    expect(a.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
  });

  it('nach Produkttitel gesucht → EAN kommt aus der GTIN des Listings', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product, gpsr, gtins: ['4006381333931'] })) });
    const a = await collectFromSelection(db, s, { ...selection, ean: undefined });
    expect(a.ean).toBe('4006381333931');
  });

  it('gesuchte EAN passt zur GTIN des Treffers → bleibt, auch mit führender Null', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product, gpsr, gtins: ['03165140776649'] })) });
    const a = await collectFromSelection(db, s, selection);
    expect(a.ean).toBe('3165140776649');
    expect(a.articleKey).toBe('ean:3165140776649');
  });

  it('Stichwort-Treffer trägt eine andere EAN → Fehler statt falscher Zuordnung, kein Eintrag', async () => {
    // Die EAN-Suche fällt still auf Stichworte zurück; die gesuchte Nummer darf
    // dann weder Artikelschlüssel noch product.ean eines fremden Produkts werden.
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product, gpsr, gtins: ['4006381333931'] })) });
    await expect(collectFromSelection(db, s, selection)).rejects.toThrow(/4006381333931.*3165140776649/);
    expect(await listAttempts(db)).toHaveLength(0);
  });

  it('nennt bei mehreren Nummern am Treffer alle — sonst führte ein UPC-Aspekt in die Irre', async () => {
    const db = openMemoryDb();
    const s = sources({
      fetchItemByRef: vi.fn(async () => ({ product, gpsr, gtins: ['885909950805', '4006381333931'] })),
    });
    await expect(collectFromSelection(db, s, selection)).rejects.toThrow(/885909950805, 4006381333931/);
  });

  it('ohne EAN und ohne GTIN → Entwurf ohne EAN, kein Sweep', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product, gpsr: null })) });
    const a = await collectFromSelection(db, s, { ...selection, ean: undefined });
    expect(a.ean).toBe('');
    expect(s.lookupByEan).not.toHaveBeenCalled();
    expect(a.warnings?.some((w) => w.includes('GPSR'))).toBe(true);
  });

  it('scheiternder GPSR-Sweep blockiert den Entwurf nicht', async () => {
    const db = openMemoryDb();
    const s = sources({ lookupByEan: vi.fn(async () => { throw new Error('eBay down'); }) });
    const a = await collectFromSelection(db, s, selection);
    expect(a.status).toBe('draft');
    expect(a.gpsr ?? null).toBeNull();
    expect(a.warnings?.some((w) => w.includes('GPSR'))).toBe(true);
  });

  it('Treffer ohne jede Artikeldaten → Fehler, kein Eintrag im Verlauf', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product: null, gpsr: null })) });
    await expect(collectFromSelection(db, s, selection)).rejects.toThrow(/keine Artikeldaten/);
    expect(await listAttempts(db)).toHaveLength(0);
  });

  it('keine Bilder und keine ePID → no_images (Blocker)', async () => {
    const db = openMemoryDb();
    const s = sources({
      fetchItemByRef: vi.fn(async () => ({ product: { ...product, imageUrls: [], epid: undefined }, gpsr })),
    });
    const a = await collectFromSelection(db, s, selection);
    expect(a.status).toBe('no_images');
    expect(a.errorMessage).toContain('Bild');
    expect(a.title).toBeTruthy();
  });

  it('keine Bilder, aber ePID → draft mit Katalogreferenz-Hinweis', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product: { ...product, imageUrls: [] }, gpsr })) });
    const a = await collectFromSelection(db, s, selection);
    expect(a.status).toBe('draft');
    expect(a.errorMessage).toBeUndefined();
    expect(a.warnings?.some((w) => w.includes('Katalogreferenz'))).toBe(true);
  });

  it('Referenz-Treffer ohne Katalogtitel → Fakten-Titel aus Marke + Merkmalen', async () => {
    const db = openMemoryDb();
    const referenceProduct = {
      origin: 'catalog' as const,
      epid: '25011365921',
      title: '',
      imageUrls: [],
      aspects: { Marke: ['STABILO'], Produktart: ['Fineliner'], Modell: ['point 88'] },
      brand: 'STABILO',
      categoryId: '104121',
    };
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product: referenceProduct, gpsr })) });
    const a = await collectFromSelection(db, s, selection);
    expect(a.status).toBe('draft');
    expect(a.title).toBe('STABILO Fineliner point 88');
    expect(a.description).toContain('Fineliner');
  });

  it('kein GPSR auffindbar → draft mit Warnung', async () => {
    const db = openMemoryDb();
    const s = sources({ lookupByEan: vi.fn(async () => ({ matches, product, gpsr: null })) });
    const a = await collectFromSelection(db, s, selection);
    expect(a.status).toBe('draft');
    expect(a.gpsr ?? null).toBeNull();
    expect(a.warnings?.some((w) => w.includes('GPSR'))).toBe(true);
  });
});

describe('recollectWithMatch', () => {
  it('wechselt den Katalogtreffer, behält GPSR', async () => {
    const db = openMemoryDb();
    const s = sources();
    const first = await collectFromSelection(db, s, selection);
    const changed = await recollectWithMatch(db, s, first.id, 'v1|2|0');
    expect(changed.epid).toBe('E2');
    expect(changed.status).toBe('draft');
    expect(changed.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
    expect(s.lookupByEan).toHaveBeenCalledTimes(1); // GPSR-Sweep nicht wiederholt
    expect(changed.catalogMatches).toHaveLength(2);
  });

  it('Treffer ohne jede Artikeldaten → verständlicher Fehler', async () => {
    const db = openMemoryDb();
    const s = sources();
    const first = await collectFromSelection(db, s, selection);
    s.fetchItemByRef = vi.fn(async () => ({ product: null, gpsr: null }));
    await expect(recollectWithMatch(db, s, first.id, 'v1|2|0')).rejects.toThrow(/keine Artikeldaten/);
  });

  it('Treffer-Übernahme überschreibt vorhandenes GPSR nicht', async () => {
    const db = openMemoryDb();
    const otherGpsr = { manufacturer: { companyName: 'Anders AG', city: 'Wien' }, responsiblePersons: [], sourceItemId: 'v1|8|0' };
    const s = sources({ fetchItemByRef: vi.fn(async (ref: string) => ({ product, gpsr: ref === 'v1|1|0' ? gpsr : otherGpsr })) });
    const first = await collectFromSelection(db, s, selection); // hat schon Bosch-GPSR
    const applied = await recollectWithMatch(db, s, first.id, 'v1|2|0');
    expect(applied.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
  });

  it('unbekannte Attempt-ID wirft', async () => {
    const db = openMemoryDb();
    await expect(recollectWithMatch(db, sources(), 999, 'v1|1|0')).rejects.toThrow(/nicht gefunden/);
  });
});

describe('applyFetchedItem (URL-Übernahme)', () => {
  it('übernimmt die Daten des Links in den Entwurf', async () => {
    const db = openMemoryDb();
    const s = sources({ fetchItemByRef: vi.fn(async () => ({ product: { ...product, imageUrls: [] }, gpsr: null })) });
    const first = await collectFromSelection(db, s, { ...selection, ean: undefined });

    const applied = await applyFetchedItem(db, first.id, { ref: 'v1|404770748596|0', product, gpsr });
    expect(applied.status).toBe('draft');
    expect(applied.imageUrls).toHaveLength(2);
    expect(applied.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
    expect(applied.catalogMatches?.some((m) => m.ref === 'v1|404770748596|0')).toBe(true);
  });

  it('wirft verständlich, wenn der Link gar keine Artikeldaten liefert', async () => {
    const db = openMemoryDb();
    const first = await collectFromSelection(db, sources(), selection);
    await expect(applyFetchedItem(db, first.id, { ref: 'v1|1|0', product: null, gpsr })).rejects.toThrow(/keine Artikeldaten/);
  });
});

describe('Listing-Bilder im Entwurf', () => {
  const listingImages = ['https://i.ebayimg.com/L1.jpg', 'https://i.ebayimg.com/L2.jpg'];

  it('hängt die Bilder des gewählten Listings hinter die Katalogbilder', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(
      db,
      sources({ fetchItemByRef: vi.fn(async () => ({ product, gpsr: null, listingImages })) }),
      selection
    );
    expect(a.imageUrls).toEqual([
      'https://i.ebayimg.com/1.jpg',
      'https://i.ebayimg.com/2.jpg',
      ...listingImages,
    ]);
  });

  it('nutzt die Listing-Bilder auch, wenn der Katalog keine liefert', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(
      db,
      sources({
        fetchItemByRef: vi.fn(async () => ({ product: { ...product, imageUrls: [] }, gpsr: null, listingImages })),
      }),
      selection
    );
    expect(a.imageUrls).toEqual(listingImages);
    expect(a.status).toBe('draft');
  });

  it('nimmt kein Bild doppelt', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(
      db,
      sources({
        fetchItemByRef: vi.fn(async () => ({
          product,
          gpsr: null,
          listingImages: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/L1.jpg'],
        })),
      }),
      selection
    );
    expect(a.imageUrls).toEqual([
      'https://i.ebayimg.com/1.jpg',
      'https://i.ebayimg.com/2.jpg',
      'https://i.ebayimg.com/L1.jpg',
    ]);
  });

  it('kappt bei zwölf Bildern (eBay-Limit)', async () => {
    const db = openMemoryDb();
    const many = Array.from({ length: 20 }, (_, i) => `https://i.ebayimg.com/m${i}.jpg`);
    const a = await collectFromSelection(
      db,
      sources({
        fetchItemByRef: vi.fn(async () => ({ product: { ...product, imageUrls: [] }, gpsr: null, listingImages: many })),
      }),
      selection
    );
    expect(a.imageUrls).toHaveLength(12);
    expect(a.imageUrls![11]).toBe('https://i.ebayimg.com/m11.jpg');
  });

  it('bleibt ohne Listing-Bilder beim bisherigen Verhalten', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, sources(), selection);
    expect(a.imageUrls).toEqual(['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg']);
  });
});

describe('applyFetchedItem — Bilder aus dem URL-Einfüge-Pfad', () => {
  it('merged Listing-Bilder hinter die Katalogbilder und dedupliziert', async () => {
    const db = openMemoryDb();
    const first = await collectFromSelection(db, sources(), selection);

    const a = await applyFetchedItem(db, first.id, {
      ref: 'v1|9|0',
      product,
      gpsr: null,
      listingImages: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/L9.jpg'],
    });

    expect(a.imageUrls).toEqual([
      'https://i.ebayimg.com/1.jpg',
      'https://i.ebayimg.com/2.jpg',
      'https://i.ebayimg.com/L9.jpg',
    ]);
  });

  it('bleibt ohne listingImages beim bisherigen Verhalten', async () => {
    const db = openMemoryDb();
    const first = await collectFromSelection(db, sources(), selection);
    const a = await applyFetchedItem(db, first.id, { ref: 'v1|9|0', product, gpsr: null });
    expect(a.imageUrls).toEqual(['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg']);
  });
});

describe('collectFromSelection — Einkaufsdaten', () => {
  it('speichert die Einkaufsdaten und setzt den Artikelschlüssel aus der EAN', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, sources(), {
      ...selection,
      purchasedUnits: 10,
      purchasePrice: 8.5,
      purchaseSource: 'https://metro.de/x',
      targetPrice: 89.99,
    });
    expect(a.purchasedUnits).toBe(10);
    expect(a.purchasePrice).toBe(8.5);
    expect(a.purchaseSource).toBe('https://metro.de/x');
    expect(a.targetPrice).toBe(89.99);
    expect(a.articleKey).toBe('ean:3165140776649');
  });

  it('nimmt ohne EAN die ePID als Artikelschlüssel', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, sources(), { ...selection, ean: undefined });
    expect(a.ean).toBe('');
    expect(a.articleKey).toBe('epid:E1');
  });

  it('ändert den Artikelschlüssel beim Katalogtreffer-Wechsel nicht', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, sources(), selection);
    expect(a.articleKey).toBe('ean:3165140776649');

    const changed = await recollectWithMatch(db, sources(), a.id, 'v1|2|0', 'E2');
    expect(changed.epid).toBe('E2');
    expect(changed.articleKey).toBe('ean:3165140776649');
  });

  it('lässt die Einkaufsfelder leer, wenn nichts angegeben wurde', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, sources(), selection);
    expect(a.purchasedUnits).toBeUndefined();
    expect(a.purchasePrice).toBeUndefined();
    expect(a.targetPrice).toBeUndefined();
  });
});

/**
 * eBays Katalog kennt viele Artikel nicht (siehe extractListingFacts in
 * pipeline/browseMap.ts). Solche Treffer landen trotzdem im Entwurf — aus den
 * Fakten des Angebots, mit Hinweis statt Fehlermeldung.
 */
describe('Treffer ohne Katalogdaten', () => {
  const listingFacts: CatalogProduct = {
    origin: 'listing',
    title: '',
    imageUrls: [],
    aspects: { Marke: ['STABILO'], Produktart: ['Fineliner'], Modell: ['point 88'] },
    brand: 'STABILO',
    categoryId: '104121',
  };
  const listingImages = ['https://i.ebayimg.com/L1.jpg', 'https://i.ebayimg.com/L2.jpg'];

  function factSources(overrides: Partial<CatalogProduct> = {}, images = listingImages) {
    return sources({
      fetchItemByRef: vi.fn(async () => ({
        product: { ...listingFacts, ...overrides },
        gpsr,
        listingImages: images,
      })),
    });
  }

  it('→ Entwurf aus den Fakten des Angebots statt Fehler', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, factSources(), selection);
    expect(a.status).toBe('draft');
    expect(a.errorMessage).toBeUndefined();
    expect(a.epid).toBeUndefined();
    expect(a.title).toBe('STABILO Fineliner point 88');
    expect(a.aspects).toEqual(listingFacts.aspects);
    expect(a.categoryId).toBe('104121');
    expect(a.description).toContain('Fineliner');
    expect(a.imageUrls).toEqual(listingImages); // die Fotos des Angebots
    expect(a.warnings?.some((w) => w.includes('keinen Katalogbezug'))).toBe(true);
  });

  it('führt den Treffer mit dem erzeugten Titel im Umschalter', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, factSources(), selection);
    expect(a.catalogMatches).toEqual([{ ref: 'v1|1|0', title: 'STABILO Fineliner point 88' }]);
  });

  it('ohne verwertbare Fakten → Entwurf mit Titel-Hinweis', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, factSources({ aspects: {}, brand: undefined }), selection);
    expect(a.status).toBe('draft');
    expect(a.title).toBe('');
    expect(a.warnings?.some((w) => w.includes('Titel'))).toBe(true);
    expect(a.catalogMatches?.[0].title).toBe('Angebot ohne Titel');
  });

  it('ohne Bilder bleibt der Blocker — ohne ePID verlangt eBay ein eigenes Bild', async () => {
    const db = openMemoryDb();
    const a = await collectFromSelection(db, factSources({}, []), selection);
    expect(a.status).toBe('no_images');
    expect(a.errorMessage).toContain('Bild');
  });

  it('Treffer-Wechsel darauf ändert weder Artikel noch GPSR, löscht aber die ePID', async () => {
    const db = openMemoryDb();
    const first = await collectFromSelection(db, sources(), selection);
    expect(first.epid).toBe('E1');

    const changed = await recollectWithMatch(db, factSources(), first.id, 'v1|2|0');
    expect(changed.status).toBe('draft');
    expect(changed.epid).toBeUndefined();
    expect(changed.articleKey).toBe('ean:3165140776649');
    expect(changed.gpsr?.manufacturer.companyName).toBe('Bosch GmbH');
    expect(changed.catalogMatches).toHaveLength(2);
    expect(changed.warnings?.some((w) => w.includes('keinen Katalogbezug'))).toBe(true);
  });
});
