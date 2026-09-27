import { afterEach, describe, expect, it, vi } from 'vitest';
import {saveToken} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { Settings } from '@/lib/ebay/types';
import browseItem from '../pipeline/fixtures/browse-item.json';
import { lookupByEan, fetchItemByRef, fetchItemByLegacyId, searchListings } from '@/lib/ebay/ebay/browse';

const settings: Settings = { env: 'sandbox', clientId: 'id', clientSecret: 'sec' };

async function freshDb() {
  const db = openMemoryDb();
  await saveToken(db, 'sandbox', 'app', {
    accessToken: 'app-tok',
    accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  return db;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const summary = (id: string, host: string) => ({
  itemId: id,
  itemWebUrl: `https://${host}/itm/x`,
});

// Item mit Katalogdaten, aber ohne GPSR
const productOnlyItem = (id: string) => {
  const { manufacturer: _m, responsiblePersons: _r, ...rest } = browseItem as Record<string, unknown>;
  return { ...rest, itemId: id };
};
// Item mit GPSR, aber ohne Katalogdaten
const gpsrOnlyItem = (id: string) => {
  const { product: _p, epid: _e, ...rest } = browseItem as Record<string, unknown>;
  return { ...rest, itemId: id };
};

afterEach(async () => vi.unstubAllGlobals());

describe('lookupByEan', () => {
  it('holt Produkt + GPSR aus einem Sweep, priorisiert ebay.de, nutzt fieldgroups=PRODUCT', async () => {
    const db = await freshDb();
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        expect(u).toContain('gtin=3165140776649');
        return json({ itemSummaries: [summary('v1|100|0', 'www.ebay.com'), summary('v1|200|0', 'www.ebay.de')] });
      }
      expect(u).toContain('fieldgroups=PRODUCT');
      const itemId = decodeURIComponent(u.split('/item/')[1].split('?')[0]);
      fetched.push(itemId);
      return json({ ...(browseItem as Record<string, unknown>), itemId });
    }));

    const r = await lookupByEan(db, settings, '3165140776649');
    expect(fetched).toEqual(['v1|200|0']); // .de zuerst, früher Abbruch nach Volltreffer
    expect(r.product?.title).toContain('Bosch Professional');
    expect(r.product?.epid).toBe('27000723598');
    expect(r.gpsr?.manufacturer.companyName).toContain('Bosch');
    expect(r.matches).toEqual([
      { ref: 'v1|200|0', epid: '27000723598', title: 'Bosch Professional GSR 12V-15 Akku-Bohrschrauber 12 V mit 2 Akkus' },
    ]);
  });

  it('kombiniert Produkt aus einem Item und GPSR aus einem anderen', async () => {
    const db = await freshDb();
    let itemCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        return json({
          itemSummaries: [summary('v1|1|0', 'www.ebay.de'), summary('v1|2|0', 'www.ebay.de'), summary('v1|3|0', 'www.ebay.de')],
        });
      }
      itemCalls++;
      const itemId = decodeURIComponent(u.split('/item/')[1].split('?')[0]);
      if (itemId === 'v1|1|0') return json(productOnlyItem(itemId));
      return json(gpsrOnlyItem(itemId));
    }));

    const r = await lookupByEan(db, settings, '316');
    expect(r.product?.title).toContain('Bosch');
    expect(r.gpsr?.sourceItemId).toBe('v1|2|0');
    expect(itemCalls).toBe(2); // Item 3 nicht mehr nötig
  });

  it('keine Treffer → leeres Ergebnis ohne Item-Abrufe', async () => {
    const db = await freshDb();
    const fetchMock = vi.fn(async (_url: unknown) => json({ total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await lookupByEan(db, settings, '316');
    expect(r.product).toBeNull();
    expect(r.gpsr).toBeNull();
    expect(r.matches).toEqual([]);
    // gtin=-Filter und Stichwort-Fallback, danach nichts mehr zu holen
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([u]) => String(u).includes('/item_summary/search'))).toBe(true);
  });

  it('prüft höchstens 5 Items und überspringt Einzelfehler', async () => {
    const db = await freshDb();
    let itemCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        return json({ itemSummaries: Array.from({ length: 8 }, (_, i) => summary(`v1|${i}|0`, 'www.ebay.de')) });
      }
      itemCalls++;
      if (itemCalls === 1) return json({ errors: [{ message: 'weg' }] }, 404);
      return json({ itemId: 'x', title: 'weder Produkt noch GPSR' });
    }));
    const r = await lookupByEan(db, settings, '316');
    expect(r.product).toBeNull();
    expect(itemCalls).toBe(5);
  });

  it('sammelt mehrere unterschiedliche Katalogtreffer als matches', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        return json({ itemSummaries: [summary('v1|1|0', 'www.ebay.de'), summary('v1|2|0', 'www.ebay.de')] });
      }
      const itemId = decodeURIComponent(u.split('/item/')[1].split('?')[0]);
      const base = productOnlyItem(itemId) as Record<string, unknown>;
      if (itemId === 'v1|2|0') {
        return json({ ...base, epid: '999', product: { ...(base.product as object), title: 'Set-Variante' } });
      }
      return json(base);
    }));
    const r = await lookupByEan(db, settings, '316');
    // kein GPSR vorhanden → Sweep läuft weiter und sammelt beide Treffer
    expect(r.matches.map((m) => m.epid)).toEqual(['27000723598', '999']);
    expect(r.product?.epid).toBe('27000723598'); // erster Treffer bleibt das Produkt
  });

  it('fällt auf die Stichwortsuche zurück, wenn der gtin=-Filter nichts liefert', async () => {
    const db = await freshDb();
    const searched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        searched.push(u.includes('gtin=') ? 'gtin' : 'q');
        if (u.includes('gtin=')) return json({ total: 0 });
        expect(u).toContain('q=3165140776649');
        return json({ itemSummaries: [summary('v1|200|0', 'www.ebay.de')] });
      }
      return json({ ...(browseItem as Record<string, unknown>), itemId: 'v1|200|0', gtin: '3165140776649' });
    }));

    const r = await lookupByEan(db, settings, '3165140776649');
    expect(searched).toEqual(['gtin', 'q']);
    expect(r.product?.title).toContain('Bosch Professional');
    expect(r.matches.map((m) => m.ref)).toEqual(['v1|200|0']);
  });

  it('übernimmt aus der Stichwortsuche nur Items, welche die EAN wirklich tragen', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        if (u.includes('gtin=')) return json({ total: 0 });
        return json({ itemSummaries: [summary('v1|1|0', 'www.ebay.de'), summary('v1|2|0', 'www.ebay.de')] });
      }
      const itemId = decodeURIComponent(u.split('/item/')[1].split('?')[0]);
      // v1|1|0 nennt die Zahl nur im Titel (Fehltreffer), v1|2|0 trägt sie als EAN-Aspekt.
      if (itemId === 'v1|1|0') return json({ ...(browseItem as Record<string, unknown>), itemId, gtin: '9999999999999' });
      return json({
        ...(browseItem as Record<string, unknown>),
        itemId,
        localizedAspects: [{ type: 'STRING', name: 'EAN', value: '3165140776649' }],
      });
    }));

    const r = await lookupByEan(db, settings, '3165140776649');
    expect(r.matches.map((m) => m.ref)).toEqual(['v1|2|0']);
    expect(r.gpsr?.sourceItemId).toBe('v1|2|0');
  });

  it('erkennt die EAN auch, wenn der Aspekt sie als Array führt', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        if (u.includes('gtin=')) return json({ total: 0 });
        return json({ itemSummaries: [summary('v1|3|0', 'www.ebay.de')] });
      }
      return json({
        ...(browseItem as Record<string, unknown>),
        itemId: 'v1|3|0',
        localizedAspects: [{ type: 'STRING', name: 'EAN', value: ['3165140776649'] }],
      });
    }));

    const r = await lookupByEan(db, settings, '3165140776649');
    expect(r.matches.map((m) => m.ref)).toEqual(['v1|3|0']);
  });

  it('sucht nicht per Stichwort, wenn der gtin=-Filter bereits Treffer liefert', async () => {
    const db = await freshDb();
    const searched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        searched.push(u.includes('gtin=') ? 'gtin' : 'q');
        return json({ itemSummaries: [summary('v1|200|0', 'www.ebay.de')] });
      }
      return json({ ...(browseItem as Record<string, unknown>), itemId: 'v1|200|0' });
    }));

    const r = await lookupByEan(db, settings, '3165140776649');
    expect(searched).toEqual(['gtin']); // kein Fallback nötig
    expect(r.product?.title).toContain('Bosch Professional');
  });
});

describe('fetchItemByRef', () => {
  it('lädt ein Item und extrahiert Katalogdaten + GPSR', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      expect(String(url)).toContain(`/buy/browse/v1/item/${encodeURIComponent('v1|200|0')}?fieldgroups=PRODUCT`);
      return json(browseItem);
    }));
    const r = await fetchItemByRef(db, settings, 'v1|200|0');
    expect(r.product?.title).toContain('Bosch Professional');
    expect(r.gpsr?.manufacturer.companyName).toContain('Bosch');
  });

  it('liefert die Bilder des Listings getrennt von den Katalogbildern mit', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async () => json(browseItem)));
    const r = await fetchItemByRef(db, settings, 'v1|200|0');
    expect(r.listingImages).toEqual(['https://i.ebayimg.com/images/g/SELLERPHOTO/s-l1600.jpg']);
    // Die Katalogextraktion bleibt davon unberührt.
    expect(r.product?.imageUrls.join()).not.toContain('SELLERPHOTO');
  });

  it('Item ohne Katalogbezug → Fakten des Angebots statt null, GPSR bleibt nutzbar', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async () => json(gpsrOnlyItem('v1|1|0'))));
    const r = await fetchItemByRef(db, settings, 'v1|1|0');
    expect(r.product).toMatchObject({ origin: 'listing', title: '', imageUrls: [], categoryId: '71283' });
    expect(r.product?.aspects).toEqual({ Marke: ['Bosch'], Farbe: ['Blau'] });
    expect(r.gpsr?.manufacturer.companyName).toContain('Bosch');
  });

  it('liefert die GTIN aus dem gtin-Feld', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...(browseItem as Record<string, unknown>), gtin: '3165140776649' })));
    expect((await fetchItemByRef(db, settings, 'v1|200|0')).gtins).toEqual(['3165140776649']);
  });

  it('liefert die GTIN aus einem EAN-Aspekt — als String wie als Array', async () => {
    const db = await freshDb();
    const withAspect = (value: unknown) => ({
      ...(browseItem as Record<string, unknown>),
      gtin: 'Nicht zutreffend',
      localizedAspects: [{ name: 'Marke', value: 'Bosch' }, { name: 'EAN', value }],
    });

    vi.stubGlobal('fetch', vi.fn(async () => json(withAspect('3165140776649'))));
    expect((await fetchItemByRef(db, settings, 'v1|200|0')).gtins).toEqual(['3165140776649']);

    vi.stubGlobal('fetch', vi.fn(async () => json(withAspect(['3165140776649']))));
    expect((await fetchItemByRef(db, settings, 'v1|200|0')).gtins).toEqual(['3165140776649']);
  });

  it('ohne echte Nummer bleibt die GTIN leer', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async () => json({
      ...(browseItem as Record<string, unknown>),
      gtin: 'Nicht zutreffend',
      localizedAspects: [{ name: 'EAN', value: 'keine Angabe' }],
    })));
    expect((await fetchItemByRef(db, settings, 'v1|200|0')).gtins).toEqual([]);
  });
});

describe('fetchItemByLegacyId', () => {
  it('lädt ein Einzel-Listing über get_item_by_legacy_id', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      expect(u).toContain('get_item_by_legacy_id?legacy_item_id=404770748596&fieldgroups=PRODUCT');
      return json({ ...(browseItem as Record<string, unknown>), itemId: 'v1|404770748596|0' });
    }));
    const r = await fetchItemByLegacyId(db, settings, '404770748596');
    expect(r.ref).toBe('v1|404770748596|0');
    expect(r.product?.title).toContain('Bosch Professional');
    expect(r.gpsr?.manufacturer.companyName).toContain('Bosch');
  });

  it('fällt bei Variantenlistings auf die Item-Gruppe zurück', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('get_item_by_legacy_id')) {
        return json({ errors: [{ message: 'This is an item group' }] }, 400);
      }
      expect(u).toContain('get_items_by_item_group?item_group_id=287195459612');
      return json({
        items: [
          gpsrOnlyItem('v1|287195459612|1'),
          { ...(productOnlyItem('v1|287195459612|2') as Record<string, unknown>) },
        ],
      });
    }));
    const r = await fetchItemByLegacyId(db, settings, '287195459612');
    expect(r.product?.title).toContain('Bosch Professional');
    expect(r.gpsr?.manufacturer.companyName).toContain('Bosch');
    expect(r.ref).toBe('v1|287195459612|2');
  });

  it('Angebot ohne Katalogbezug → Fakten des Angebots, erst nach der ePID-Suche', async () => {
    const db = await freshDb();
    const searched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        searched.push(u);
        return json({ total: 0 }); // zur GTIN gibt es keine ePID
      }
      return json({ ...gpsrOnlyItem('v1|404770748596|0'), gtin: '3165140776649' });
    }));

    const r = await fetchItemByLegacyId(db, settings, '404770748596');
    expect(searched.some((u) => u.includes('gtin=3165140776649'))).toBe(true);
    expect(r.product).toMatchObject({ origin: 'listing', title: '' });
    expect(r.product?.categoryId).toBe('71283');
    expect(r.listingImages).toEqual(['https://i.ebayimg.com/images/g/SELLERPHOTO/s-l1600.jpg']);
  });

  it('findet die ePID zur GTIN → Katalogbezug schlägt die Angebotsfakten', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/item_summary/search')) {
        return json({ itemSummaries: [{ itemId: 'v1|404770748596|0', epid: '27000723598' }] });
      }
      return json({ ...gpsrOnlyItem('v1|404770748596|0'), gtin: '3165140776649' });
    }));

    const r = await fetchItemByLegacyId(db, settings, '404770748596');
    expect(r.product).toMatchObject({ origin: 'catalog', epid: '27000723598' });
  });

  it('Variantenlisting ohne Katalogbezug → Fakten und Bilder der ersten Variante', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('get_item_by_legacy_id')) {
        return json({ errors: [{ message: 'This is an item group' }] }, 400);
      }
      return json({
        items: [
          { ...(gpsrOnlyItem('v1|287195459612|1') as Record<string, unknown>),
            image: { imageUrl: 'https://i.ebayimg.com/variante-eins.jpg' } },
          gpsrOnlyItem('v1|287195459612|2'),
        ],
      });
    }));

    const r = await fetchItemByLegacyId(db, settings, '287195459612');
    expect(r.ref).toBe('v1|287195459612|1');
    expect(r.product).toMatchObject({ origin: 'listing', categoryId: '71283' });
    expect(r.listingImages).toEqual(['https://i.ebayimg.com/variante-eins.jpg']);
    expect(r.gpsr?.manufacturer.companyName).toContain('Bosch');
  });

  it('wirft den Originalfehler, wenn auch die Gruppe nichts liefert', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('get_item_by_legacy_id')) return json({ errors: [{ message: 'Artikel wurde beendet' }] }, 404);
      return json({ errors: [{ message: 'gibts nicht' }] }, 404);
    }));
    await expect(fetchItemByLegacyId(db, settings, '111111111111')).rejects.toThrow(/beendet/);
  });
});

describe('searchListings', () => {
  it('sucht per Stichwort und mappt die Treffer inkl. epid-Kennzeichnung', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      expect(u).toContain('/item_summary/search?q=stabilo%20point%2088');
      expect(u).toContain('limit=24');
      return json({
        itemSummaries: [
          {
            itemId: 'v1|1|0',
            title: 'STABILO point 88 25er Box',
            price: { value: '19.99', currency: 'EUR' },
            image: { imageUrl: 'https://i.ebayimg.com/a.jpg' },
            epid: '555',
            itemWebUrl: 'https://www.ebay.de/itm/1',
            condition: 'Neu',
          },
          {
            itemId: 'v1|2|0',
            title: 'Fineliner ohne Katalog',
            thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/thumb.jpg' }],
          },
        ],
      });
    }));

    const results = await searchListings(db, settings, 'stabilo point 88');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ref: 'v1|1|0', epid: '555', price: '19.99', currency: 'EUR' });
    expect(results[1].epid).toBeUndefined();
    expect(results[1].imageUrl).toBe('https://i.ebayimg.com/thumb.jpg');
  });

  it('keine Treffer → leeres Array', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async () => json({ total: 0 })));
    expect(await searchListings(db, settings, 'xyz')).toEqual([]);
  });

  it('reine Ziffernfolge → EAN-Suche über den gtin=-Filter', async () => {
    const db = await freshDb();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return json({ itemSummaries: [{ itemId: 'v1|1|0', title: 'Bosch GSR 12V-15', epid: '77' }] });
    }));

    const results = await searchListings(db, settings, '3165140776649');
    expect(results).toHaveLength(1);
    expect(calls.filter((c) => c.includes('item_summary/search'))).toHaveLength(1);
    expect(calls.some((c) => c.includes('gtin=3165140776649'))).toBe(true);
  });

  it('EAN ohne gtin=-Treffer → Stichwort-Fallback (eBays Katalog-GTINs sind lückenhaft)', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('gtin=')) return json({ total: 0 });
      expect(u).toContain('q=3165140776649');
      return json({ itemSummaries: [{ itemId: 'v1|9|0', title: 'Bosch GSR 12V-15' }] });
    }));

    const results = await searchListings(db, settings, '3165140776649');
    expect(results.map((r) => r.ref)).toEqual(['v1|9|0']);
  });
});

describe('fetchItemByLegacyId — Bilder', () => {
  it('liefert die Listing-Bilder der eingefügten eBay-URL mit', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async () => json(browseItem)));
    const r = await fetchItemByLegacyId(db, settings, '110588014268');
    expect(r.listingImages).toEqual(['https://i.ebayimg.com/images/g/SELLERPHOTO/s-l1600.jpg']);
  });

  it('nimmt bei Varianten die Bilder der Variante, die auch die Produktdaten liefert', async () => {
    const db = await freshDb();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('get_item_by_legacy_id')) {
        return json({ errors: [{ message: 'This is an item group' }] }, 400);
      }
      return json({
        items: [
          // Erste Variante: nur GPSR, ihre Bilder dürfen NICHT gewinnen.
          { ...(gpsrOnlyItem('v1|287195459612|1') as Record<string, unknown>),
            image: { imageUrl: 'https://i.ebayimg.com/FALSCH.jpg' } },
          // Zweite Variante liefert die Produktdaten — von hier kommen die Bilder.
          { ...(productOnlyItem('v1|287195459612|2') as Record<string, unknown>),
            image: { imageUrl: 'https://i.ebayimg.com/RICHTIG-haupt.jpg' },
            additionalImages: [{ imageUrl: 'https://i.ebayimg.com/RICHTIG-zwei.jpg' }] },
        ],
      });
    }));

    const r = await fetchItemByLegacyId(db, settings, '287195459612');

    expect(r.ref).toBe('v1|287195459612|2');
    expect(r.listingImages).toEqual([
      'https://i.ebayimg.com/RICHTIG-haupt.jpg',
      'https://i.ebayimg.com/RICHTIG-zwei.jpg',
    ]);
  });
});
