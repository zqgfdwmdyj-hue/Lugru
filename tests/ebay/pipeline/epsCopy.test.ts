import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImagesToEps } from '@/lib/ebay/pipeline/epsCopy';

afterEach(() => vi.unstubAllGlobals());

function bin(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'image/jpeg' } });
}

function withHeaders(body: string, headers: Record<string, string>) {
  return new Response(body, { status: 200, headers });
}

describe('copyImagesToEps', () => {
  it('lädt jedes Bild und ersetzt die URL durch die eigene EPS-Kopie', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bin('bytes')));
    const upload = vi.fn(async (_name: string, data: Buffer) => `https://eps.ebay.com/${data.toString()}-${_name}`);

    const out = await copyImagesToEps(['https://i.ebayimg.com/a.jpg', 'https://i.ebayimg.com/b.jpg'], upload);

    expect(out).toEqual(['https://eps.ebay.com/bytes-a.jpg', 'https://eps.ebay.com/bytes-b.jpg']);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('reicht die Bytes des Downloads unverändert an den Upload weiter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bin('JPEGDATA')));
    let seen: Buffer | undefined;
    await copyImagesToEps(['https://i.ebayimg.com/a.jpg'], async (_n, d) => {
      seen = d;
      return 'https://eps.ebay.com/1.jpg';
    });
    expect(seen?.toString()).toBe('JPEGDATA');
  });

  it('bricht mit Nennung der URL ab, wenn ein Bild nicht ladbar ist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bin('nope', 404)));
    await expect(
      copyImagesToEps(['https://i.ebayimg.com/kaputt.jpg'], async () => 'x')
    ).rejects.toThrow(/kaputt\.jpg/);
  });

  it('bricht mit Nennung der URL ab, wenn eBay den Upload ablehnt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => bin('bytes')));
    await expect(
      copyImagesToEps(['https://i.ebayimg.com/abgelehnt.jpg'], async () => {
        throw new Error('Bild-Upload abgelehnt: zu klein');
      })
    ).rejects.toThrow(/abgelehnt\.jpg.*zu klein/s);
  });

  it('macht ohne Bilder gar nichts', async () => {
    const upload = vi.fn();
    expect(await copyImagesToEps([], upload)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('weist eine Antwort ab, die gar kein Bild ist (z.B. HTML-Fehlerseite mit HTTP 200)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => withHeaders('<html>Not found</html>', { 'content-type': 'text/html' })));
    await expect(
      copyImagesToEps(['https://i.ebayimg.com/html.jpg'], async () => 'x')
    ).rejects.toThrow(/html\.jpg.*text\/html/s);
  });

  it('lässt ein Bild ohne content-type-Header durch', async () => {
    // Binary-Body statt String: nur so bleibt der Header wirklich leer.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]))));
    expect(await copyImagesToEps(['https://i.ebayimg.com/a.jpg'], async () => 'https://eps/1.jpg')).toEqual([
      'https://eps/1.jpg',
    ]);
  });

  it('weist ein Bild ab, das eBays Größenlimit überschreitet', async () => {
    const zuGross = 'x'.repeat(12 * 1024 * 1024 + 1);
    vi.stubGlobal('fetch', vi.fn(async () => withHeaders(zuGross, { 'content-type': 'image/jpeg' })));
    await expect(
      copyImagesToEps(['https://i.ebayimg.com/riesig.jpg'], async () => 'x')
    ).rejects.toThrow(/riesig\.jpg.*zu groß/s);
  });
});
