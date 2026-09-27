import { afterEach, describe, expect, it, vi } from 'vitest';
import {saveToken} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { Settings } from '@/lib/ebay/types';
import { makeInventoryApi } from '@/lib/ebay/ebay/inventory';
import { searchListings } from '@/lib/ebay/ebay/browse';
import { uploadPictureToEps } from '@/lib/ebay/ebay/pictures';

/**
 * Node/undici setzt ungefragt `accept-language: *`, wenn der Header fehlt.
 * eBays Inventory API lehnt das mit HTTP 400 (errorId 25709) ab. Jeder Client
 * muss den Header deshalb selbst setzen.
 */
const settings: Settings = { env: 'sandbox', clientId: 'id', clientSecret: 'sec' };

afterEach(async () => vi.unstubAllGlobals());

async function dbWithTokens() {
  const db = openMemoryDb();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  await saveToken(db, 'sandbox', 'app', { accessToken: 'app-tok', accessExpiresAt: expires });
  // Ohne refreshToken wirft getUserAccessToken NOT_CONNECTED, bevor ein fetch passiert.
  await saveToken(db, 'sandbox', 'user', {
    accessToken: 'user-tok',
    accessExpiresAt: expires,
    refreshToken: 'refresh-tok',
    refreshExpiresAt: expires,
  });
  return db;
}

/** Fängt die Header des letzten fetch-Aufrufs ab. */
function captureHeaders(response: Response) {
  const seen: Record<string, string>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    seen.push((init?.headers ?? {}) as Record<string, string>);
    return response.clone();
  }));
  return seen;
}

describe('Accept-Language wird explizit gesetzt', () => {
  it('Inventory API (der Call, der ohne den Header 400 wirft)', async () => {
    const db = await dbWithTokens();
    const seen = captureHeaders(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await makeInventoryApi(db, settings).putInventoryItem('SKU-1', {});
    expect(seen[0]['Accept-Language']).toBe('de-DE');
  });

  it('Browse API', async () => {
    const db = await dbWithTokens();
    const seen = captureHeaders(
      new Response('{"itemSummaries":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    await searchListings(db, settings, 'Bohrschrauber');
    expect(seen[0]['Accept-Language']).toBe('de-DE');
  });

  it('Trading API beim Bild-Upload', async () => {
    const db = await dbWithTokens();
    const seen = captureHeaders(new Response('<FullURL>https://eps/1.jpg</FullURL>', { status: 200 }));
    await uploadPictureToEps(db, settings, 'a.jpg', Buffer.from([0xff, 0xd8]));
    expect(seen[0]['Accept-Language']).toBe('de-DE');
  });
});
