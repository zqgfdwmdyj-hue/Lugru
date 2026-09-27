import { describe, expect, it } from 'vitest';
import {createAttempt, updateAttempt} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import { addImages, removeImage } from '@/lib/ebay/pipeline/images';

async function baseAttempt(db: Db, patch: Parameters<typeof updateAttempt>[2] = {}) {
  const a = await createAttempt(db, { ean: '4006381333931', price: 9.99, quantity: 1, condition: 'NEW' });
  return (await updateAttempt(db, a.id, { status: 'draft', title: 'T', imageUrls: [], ...patch }))!;
}

describe('addImages', () => {
  it('hängt Bilder an und dedupliziert', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { imageUrls: ['https://eps.ebay.com/1.jpg'] });
    const r = await addImages(db, a.id, ['https://eps.ebay.com/2.jpg', 'https://eps.ebay.com/1.jpg']);
    expect(r.imageUrls).toEqual(['https://eps.ebay.com/1.jpg', 'https://eps.ebay.com/2.jpg']);
  });

  it('hebt den no_images-Blocker auf', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { status: 'no_images', errorMessage: 'kein Bild' });
    const r = await addImages(db, a.id, ['https://eps.ebay.com/1.jpg']);
    expect(r.status).toBe('draft');
    expect(r.errorMessage).toBeUndefined();
  });

  it('lehnt Nicht-HTTP(S)-URLs ab', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db);
    await expect(addImages(db, a.id, ['ftp://x/1.jpg'])).rejects.toThrow(/Bild-URL/);
    await expect(addImages(db, a.id, ['kein link'])).rejects.toThrow(/Bild-URL/);
  });

  it('höchstens 12 Bilder (eBay-Limit)', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { imageUrls: Array.from({ length: 11 }, (_, i) => `https://x/${i}.jpg`) });
    await expect(addImages(db, a.id, ['https://x/a.jpg', 'https://x/b.jpg'])).rejects.toThrow(/12/);
  });

  it('veröffentlichte Listings sind unveränderlich', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { status: 'published' });
    await expect(addImages(db, a.id, ['https://x/1.jpg'])).rejects.toThrow(/veröffentlicht/i);
  });
});

describe('removeImage', () => {
  it('entfernt genau die eine URL', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { imageUrls: ['https://x/1.jpg', 'https://x/2.jpg'] });
    const r = await removeImage(db, a.id, 'https://x/1.jpg');
    expect(r.imageUrls).toEqual(['https://x/2.jpg']);
    expect(r.status).toBe('draft');
  });

  it('letztes Bild entfernt ohne ePID → zurück zu no_images', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { imageUrls: ['https://x/1.jpg'], epid: undefined });
    const r = await removeImage(db, a.id, 'https://x/1.jpg');
    expect(r.status).toBe('no_images');
  });

  it('letztes Bild entfernt mit ePID → bleibt draft (Katalogreferenz)', async () => {
    const db = openMemoryDb();
    const a = await baseAttempt(db, { imageUrls: ['https://x/1.jpg'], epid: '123' });
    const r = await removeImage(db, a.id, 'https://x/1.jpg');
    expect(r.status).toBe('draft');
  });
});
