import { describe, expect, it, vi, afterEach } from 'vitest';
import {getSetting, saveToken} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { Settings } from '@/lib/ebay/types';
import { LOCATION_KEY, saveLocation } from '@/lib/ebay/setup/location';

const settings: Settings = { env: 'sandbox', clientId: 'id', clientSecret: 'sec' };

afterEach(async () => vi.unstubAllGlobals());

async function db() {
  const d = openMemoryDb();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  await saveToken(d, 'sandbox', 'user', {
    accessToken: 'tok', accessExpiresAt: expires, refreshToken: 'r', refreshExpiresAt: expires,
  });
  return d;
}

function ok() {
  return vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('saveLocation', () => {
  it('legt den Standort bei eBay an und merkt ihn lokal', async () => {
    vi.stubGlobal('fetch', ok());
    const d = await db();

    await saveLocation(d, settings, { addressLine1: 'Hauptstr. 1', city: 'Köln', postalCode: '50667' });

    expect(await getSetting(d, 'sandbox.merchantLocationKey')).toBe(LOCATION_KEY);
    expect(await getSetting(d, 'sandbox.locAddressLine1')).toBe('Hauptstr. 1');
    expect(await getSetting(d, 'sandbox.locCity')).toBe('Köln');
    expect(await getSetting(d, 'sandbox.locPostalCode')).toBe('50667');
  });

  it('schickt Deutschland als Land mit', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);

    await saveLocation(await db(), settings, { addressLine1: 'Hauptstr. 1', city: 'Köln', postalCode: '50667' });

    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(body.location.address.country).toBe('DE');
  });

  it('aktualisiert die Adresse, wenn der Standort bei eBay schon existiert', async () => {
    // eBay antwortet auf CreateInventoryLocation mit 409, sobald der Schlüssel
    // vergeben ist. Ohne Folgeaufruf behielte das Angebot die alte Anschrift.
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).endsWith('/update_location_details')
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ errors: [{ errorId: 25002, message: 'existiert bereits' }] }), {
            status: 409, headers: { 'content-type': 'application/json' },
          }));
    vi.stubGlobal('fetch', fetchMock);
    const d = await db();

    await saveLocation(d, settings, { addressLine1: 'Neue Str. 9', city: 'Bonn', postalCode: '53111' });

    const update = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/update_location_details'));
    expect(update, 'update_location_details wurde nicht aufgerufen').toBeDefined();
    expect(JSON.parse(String(update![1]?.body)).location.address).toMatchObject({
      addressLine1: 'Neue Str. 9', city: 'Bonn', postalCode: '53111', country: 'DE',
    });
    expect(await getSetting(d, 'sandbox.locAddressLine1')).toBe('Neue Str. 9');
  });

  it('schreibt nichts, wenn auch die Aktualisierung scheitert', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ errors: [{ errorId: 25002, message: 'kaputt' }] }), {
        status: String(url).endsWith('/update_location_details') ? 400 : 409,
        headers: { 'content-type': 'application/json' },
      })));
    const d = await db();

    await expect(saveLocation(d, settings, { addressLine1: 'X', city: 'Y', postalCode: '1' })).rejects.toThrow();
    expect(await getSetting(d, 'sandbox.locAddressLine1')).toBeNull();
  });

  it('schreibt nichts, wenn eBay den Standort ablehnt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ errors: [{ errorId: 25001, message: 'Kaputt' }] }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )));
    const d = await db();

    await expect(saveLocation(d, settings, { addressLine1: 'X', city: 'Y', postalCode: '1' })).rejects.toThrow();
    expect(await getSetting(d, 'sandbox.merchantLocationKey')).toBeNull();
  });
});

describe('saveLocation — Standort existiert schon', () => {
  it('aktualisiert statt abzubrechen, wenn eBay „already exists" mit HTTP 400 meldet', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(JSON.stringify({ errors: [{ errorId: 25803, message: 'merchantLocationKey already exists.' }] }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 204 });
    }));
    const d = await db();
    await saveLocation(d, settings, { addressLine1: 'Hauptstr. 1', city: 'Köln', postalCode: '50667' });
    expect(calls[1]).toContain(`/location/${LOCATION_KEY}/update_location_details`);
    expect(await getSetting(d, 'sandbox.merchantLocationKey')).toBe(LOCATION_KEY);
  });

  it('bricht bei anderen Fehlern weiterhin ab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ errorId: 25002, message: 'Ungültige PLZ' }] }), { status: 400, headers: { 'content-type': 'application/json' } })));
    await expect(saveLocation(await db(), settings, { addressLine1: 'A', city: 'B', postalCode: 'x' })).rejects.toThrow(/Ungültige PLZ/);
  });
});
