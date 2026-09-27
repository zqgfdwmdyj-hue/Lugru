import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ebayFetch, EbayHttpError } from '@/lib/ebay/ebay/http';

// Der Retry pausiert echte 2s. Die Pause selbst ist nicht Gegenstand dieser
// Tests, also feuert setTimeout hier sofort — sonst läuft die Datei ~8s.
beforeEach(() => vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; }));
afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** eBays Sammelfehler für eigene Aussetzer. */
const systemError = { errors: [{ errorId: 25001, message: 'Ein Systemfehler ist aufgetreten.' }] };

describe('ebayFetch — transiente Fehler', () => {
  it('wiederholt einen 500er und liefert das Ergebnis des zweiten Versuchs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(systemError, 500))
      .mockResolvedValueOnce(json({ offerId: 'OFFER-1' }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await ebayFetch('https://api.ebay.com/x', { headers: {} });

    expect(result).toEqual({ offerId: 'OFFER-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gibt nach erschöpften Versuchen die eBay-Meldung weiter, nicht „HTTP 500“', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(systemError, 500)));
    await expect(ebayFetch('https://api.ebay.com/x', { headers: {} })).rejects.toThrow(/Systemfehler/);
  });

  it('wiederholt einen 503er ebenfalls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ebayFetch('https://api.ebay.com/x', { headers: {} })).toEqual({ ok: true });
  });

  it('wiederholt einen 400er NICHT — der Payload wird beim zweiten Mal nicht besser', async () => {
    const fetchMock = vi.fn(async () => json({ errors: [{ message: 'Pflichtfeld fehlt' }] }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(ebayFetch('https://api.ebay.com/x', { headers: {} })).rejects.toThrow(/Pflichtfeld fehlt/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('behält den bestehenden 429-Retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ebayFetch('https://api.ebay.com/x', { headers: {} })).toEqual({ ok: true });
  });

  it('wirft EbayHttpError mit dem Status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'nope' }] }, 400)));
    await expect(ebayFetch('https://api.ebay.com/x', { headers: {} })).rejects.toBeInstanceOf(EbayHttpError);
  });
});
