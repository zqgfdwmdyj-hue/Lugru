import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {saveToken} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { Settings } from '@/lib/ebay/types';
import { makeInventoryApi } from '@/lib/ebay/ebay/inventory';

const settings: Settings = { env: 'sandbox', clientId: 'id', clientSecret: 'sec' };

beforeEach(async () => vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; }));
afterEach(async () => vi.unstubAllGlobals());

async function db() {
  const d = openMemoryDb();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  await saveToken(d, 'sandbox', 'user', {
    accessToken: 'tok', accessExpiresAt: expires, refreshToken: 'r', refreshExpiresAt: expires,
  });
  return d;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** eBay, wenn zur SKU schon ein Angebot existiert. */
const alreadyExists = { errors: [{ errorId: 25002, message: 'Preisangebot-Entität existiert bereits.' }] };

describe('createOffer — Wiederaufnahme eines bereits angelegten Angebots', () => {
  it('übernimmt die vorhandene offerId, statt am Duplikat zu scheitern', async () => {
    const fetchMock = vi.fn(async (url: unknown, init: RequestInit | undefined) => {
      if (init?.method === 'POST') return json(alreadyExists, 400);
      expect(String(url)).toContain('offer?sku=SKU-1');
      return json({ total: 1, offers: [{ offerId: 'OFFER-VORHANDEN', status: 'UNPUBLISHED' }] }, 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const offerId = await makeInventoryApi(await db(), settings).createOffer({ sku: 'SKU-1' });

    expect(offerId).toBe('OFFER-VORHANDEN');
  });

  it('meldet den Originalfehler, wenn zur SKU doch kein Angebot auffindbar ist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: RequestInit | undefined) =>
      init?.method === 'POST' ? json(alreadyExists, 400) : json({ total: 0, offers: [] }, 200)
    ));
    await expect(makeInventoryApi(await db(), settings).createOffer({ sku: 'SKU-1' })).rejects.toThrow(/existiert bereits/);
  });

  it('lässt andere 400er unangetastet — kein Nachschlagen, kein Verschlucken', async () => {
    const fetchMock = vi.fn(async () => json({ errors: [{ errorId: 25709, message: 'Pflichtfeld fehlt.' }] }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeInventoryApi(await db(), settings).createOffer({ sku: 'SKU-1' })).rejects.toThrow(/Pflichtfeld fehlt/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('der Normalfall bleibt unberührt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ offerId: 'OFFER-NEU' }, 201)));
    expect(await makeInventoryApi(await db(), settings).createOffer({ sku: 'SKU-1' })).toBe('OFFER-NEU');
  });
});
