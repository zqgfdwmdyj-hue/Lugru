import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {createAttempt, updateAttempt, getAttempt} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { Settings } from '@/lib/ebay/types';
import type { InventoryApi } from '@/lib/ebay/ebay/inventory';
import { publishAttempt } from '@/lib/ebay/pipeline/publish';

const settings: Settings = {
  env: 'sandbox',
  fulfillmentPolicyId: 'F1',
  paymentPolicyId: 'P1',
  returnPolicyId: 'R1',
  merchantLocationKey: 'lugru-main',
};

async function draftAttempt(db: Db) {
  const a = await createAttempt(db, { ean: '316514', price: 10, quantity: 1, condition: 'NEW' });
  return (await updateAttempt(db, a.id, {
    status: 'draft',
    title: 'T',
    description: 'D',
    imageUrls: ['https://x/1.jpg'],
    aspects: {},
    categoryId: '123',
  }))!;
}

function mockInv(overrides: Partial<InventoryApi> = {}): InventoryApi {
  return {
    putInventoryItem: vi.fn(async () => {}),
    createOffer: vi.fn(async () => 'OFFER-1'),
    updateOffer: vi.fn(async () => {}),
    publishOffer: vi.fn(async () => 'LISTING-9'),
    ...overrides,
  };
}

/** Bilder-Upload im Test: liefert für jeden Dateinamen eine EPS-URL zurück. */
const upload = async (name: string) => `https://eps.ebay.com/${name}`;

describe('publishAttempt', () => {
  // Der Download der Originalbilder darf im Test nicht ins Netz gehen.
  beforeEach(async () => vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } }))));
  afterEach(async () => vi.unstubAllGlobals());

  it('happy path: put → createOffer → publish, Status published', async () => {
    const db = openMemoryDb();
    const a = await draftAttempt(db);
    const inv = mockInv();

    const result = await publishAttempt(db, inv, settings, a.id, upload);

    expect(inv.putInventoryItem).toHaveBeenCalledWith(`LG-316514-${a.id}`, expect.anything());
    expect(inv.createOffer).toHaveBeenCalled();
    expect(inv.updateOffer).not.toHaveBeenCalled();
    expect(inv.publishOffer).toHaveBeenCalledWith('OFFER-1');
    expect(result.status).toBe('published');
    expect(result.listingId).toBe('LISTING-9');
    expect(result.sku).toBe(`LG-316514-${a.id}`);
    expect(result.offerId).toBe('OFFER-1');
    expect(result.errorMessage).toBeUndefined();
  });

  it('Retry mit vorhandener offerId nutzt updateOffer', async () => {
    const db = openMemoryDb();
    const a = await draftAttempt(db);
    await updateAttempt(db, a.id, { offerId: 'OFFER-EXISTING', sku: `LG-316514-${a.id}`, status: 'publish_failed' });
    const inv = mockInv();

    const result = await publishAttempt(db, inv, settings, a.id, upload);
    expect(inv.createOffer).not.toHaveBeenCalled();
    expect(inv.updateOffer).toHaveBeenCalledWith('OFFER-EXISTING', expect.anything());
    expect(result.status).toBe('published');
  });

  it('eBay-Fehler → publish_failed mit Meldung, offerId bleibt', async () => {
    const db = openMemoryDb();
    const a = await draftAttempt(db);
    const inv = mockInv({ publishOffer: vi.fn(async () => { throw new Error('Pflicht-Aspekt fehlt'); }) });

    const result = await publishAttempt(db, inv, settings, a.id, upload);
    expect(result.status).toBe('publish_failed');
    expect(result.errorMessage).toContain('Pflicht-Aspekt fehlt');
    expect(result.offerId).toBe('OFFER-1');
    expect((await getAttempt(db, a.id))?.status).toBe('publish_failed');
  });

  it('blockiert Status no_images', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, { ean: '1', price: 1, quantity: 1, condition: 'NEW' });
    await updateAttempt(db, a.id, { status: 'no_images' });
    await expect(publishAttempt(db, mockInv(), settings, a.id, upload)).rejects.toThrow(/Bild/);
  });

  it('blockiert bei fehlenden Policies mit Hinweis auf Einstellungen', async () => {
    const db = openMemoryDb();
    const a = await draftAttempt(db);
    await expect(publishAttempt(db, mockInv(), { env: 'sandbox' }, a.id, upload)).rejects.toThrow(/Einstellungen/);
    expect((await getAttempt(db, a.id))?.status).toBe('draft'); // nichts kaputtgemacht
  });

  it('bereits veröffentlichte Versuche werden nicht erneut veröffentlicht', async () => {
    const db = openMemoryDb();
    const a = await draftAttempt(db);
    await updateAttempt(db, a.id, { status: 'published', listingId: 'L1' });
    await expect(publishAttempt(db, mockInv(), settings, a.id, upload)).rejects.toThrow(/bereits veröffentlicht/);
  });
});

describe('Bilder werden beim Veröffentlichen zu eBay kopiert', () => {
  // Der Download der Originalbilder darf im Test nicht ins Netz gehen.
  beforeEach(async () => vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } }))));
  afterEach(async () => vi.unstubAllGlobals());

  async function draftWithImages(db: Db, urls: string[]) {
    const a = await createAttempt(db, { ean: '316514', price: 10, quantity: 1, condition: 'NEW' });
    return (await updateAttempt(db, a.id, {
      status: 'draft',
      title: 'T',
      description: 'D',
      imageUrls: urls,
      aspects: {},
      categoryId: '123',
    }))!;
  }

  it('das Listing bekommt die eigenen EPS-Kopien, nicht die fremden URLs', async () => {
    const db = openMemoryDb();
    const a = await draftWithImages(db, ['https://i.ebayimg.com/fremd1.jpg', 'https://i.ebayimg.com/fremd2.jpg']);
    const inv = mockInv();
    const upload = vi.fn(async (name: string) => `https://eps.ebay.com/eigen-${name}`);

    const result = await publishAttempt(db, inv, settings, a.id, upload);

    expect(result.status).toBe('published');
    const payload = (inv.putInventoryItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(payload.product.imageUrls).toEqual([
      'https://eps.ebay.com/eigen-fremd1.jpg',
      'https://eps.ebay.com/eigen-fremd2.jpg',
    ]);
    expect(payload.product.imageUrls.join()).not.toContain('i.ebayimg.com');
  });

  it('speichert die EPS-URLs erst nach erfolgreichem Publish', async () => {
    const db = openMemoryDb();
    const a = await draftWithImages(db, ['https://i.ebayimg.com/fremd1.jpg']);
    await publishAttempt(db, mockInv(), settings, a.id, async (name) => `https://eps.ebay.com/eigen-${name}`);
    expect((await getAttempt(db, a.id))!.imageUrls).toEqual(['https://eps.ebay.com/eigen-fremd1.jpg']);
  });

  it('scheitert der Publish, bleiben die Original-URLs für den Retry stehen', async () => {
    const db = openMemoryDb();
    const a = await draftWithImages(db, ['https://i.ebayimg.com/fremd1.jpg']);
    const inv = mockInv({ publishOffer: vi.fn(async () => { throw new Error('eBay sagt nein'); }) });

    const result = await publishAttempt(db, inv, settings, a.id, async (name) => `https://eps.ebay.com/eigen-${name}`);

    expect(result.status).toBe('publish_failed');
    expect((await getAttempt(db, a.id))!.imageUrls).toEqual(['https://i.ebayimg.com/fremd1.jpg']);
  });

  it('ein nicht kopierbares Bild bricht ab und nennt die URL', async () => {
    const db = openMemoryDb();
    const a = await draftWithImages(db, ['https://i.ebayimg.com/kaputt.jpg']);
    const inv = mockInv();

    const result = await publishAttempt(db, inv, settings, a.id, async () => {
      throw new Error('zu klein');
    });

    expect(result.status).toBe('publish_failed');
    expect(result.errorMessage).toMatch(/kaputt\.jpg/);
    expect(inv.publishOffer).not.toHaveBeenCalled();
  });
});
