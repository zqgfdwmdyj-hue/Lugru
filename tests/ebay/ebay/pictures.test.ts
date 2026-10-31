import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveToken } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import { buildUploadXml, mediaUploadFile, parseUploadResponse, uploadPictureToEps, urlToEps } from '@/lib/ebay/ebay/pictures';
import type { Settings } from '@/lib/ebay/types';

describe('buildUploadXml', () => {
  it('baut den Request mit escaptem Dateinamen', () => {
    const xml = buildUploadXml('Foto <1> & Co.jpg');
    expect(xml).toContain('<PictureName>Foto &lt;1&gt; &amp; Co.jpg</PictureName>');
    expect(xml).toContain('UploadSiteHostedPicturesRequest');
  });
});

describe('parseUploadResponse', () => {
  it('liefert die FullURL aus einer Erfolgsantwort (inkl. &amp;-Decoding)', () => {
    const xml = `<?xml version="1.0"?><UploadSiteHostedPicturesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <SiteHostedPictureDetails>
        <FullURL>https://i.ebayimg.com/00/s/ABC/z/xyz/$_1.JPG?set_id=2&amp;foo=1</FullURL>
      </SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>`;
    expect(parseUploadResponse(xml)).toBe('https://i.ebayimg.com/00/s/ABC/z/xyz/$_1.JPG?set_id=2&foo=1');
  });

  it('wirft mit der eBay-Fehlermeldung bei Failure', () => {
    const xml = `<UploadSiteHostedPicturesResponse><Ack>Failure</Ack>
      <Errors><ShortMessage>Bild zu groß</ShortMessage><LongMessage>Das Bild überschreitet 12 MB.</LongMessage></Errors>
      </UploadSiteHostedPicturesResponse>`;
    expect(() => parseUploadResponse(xml)).toThrow(/12 MB/);
  });

  it('wirft verständlich bei unerwarteter Antwort', () => {
    expect(() => parseUploadResponse('<html>Gateway Timeout</html>')).toThrow(/Bild-Upload/);
  });
});

describe('Bild-Upload über die neue Media API', () => {
  const prod: Settings = { env: 'production', clientId: 'c', clientSecret: 's', ruName: 'r' };
  async function connected() {
    const db = openMemoryDb();
    await saveToken(db, 'production', 'user', { accessToken: 'user-tok', accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(), refreshToken: 'rt' });
    return db;
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('lädt die Datei hoch und holt die Adresse über die Bild-ID', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).endsWith('/image/create_image_from_file')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer user-tok');
        expect((init?.body as FormData).get('image')).toBeInstanceOf(Blob);
        return new Response(null, { status: 201, headers: { location: 'https://apim.ebay.com/commerce/media/v1_beta/image/BILD-1' } });
      }
      return new Response(JSON.stringify({ imageUrl: 'https://i.ebayimg.example/neu.jpg' }), { status: 200 });
    }));
    expect(await uploadPictureToEps(await connected(), prod, 'foto.jpg', Buffer.from('bild'))).toBe('https://i.ebayimg.example/neu.jpg');
    expect(calls).toEqual(['POST https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file', 'GET https://apim.ebay.com/commerce/media/v1_beta/image/BILD-1']);
  });

  it('fällt bei Ablehnung auf UploadSiteHostedPictures zurück', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      calls.push(String(url));
      if (String(url).includes('/commerce/media/')) return new Response(JSON.stringify({ errors: [{ longMessage: 'Zugriff verweigert' }] }), { status: 403 });
      return new Response('<UploadSiteHostedPicturesResponse><Ack>Success</Ack><SiteHostedPictureDetails><FullURL>https://i.ebayimg.example/alt.jpg</FullURL></SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>', { status: 200 });
    }));
    expect(await uploadPictureToEps(await connected(), prod, 'foto.jpg', Buffer.from('bild'))).toBe('https://i.ebayimg.example/alt.jpg');
    expect(calls[1]).toBe('https://api.ebay.com/ws/api.dll');
  });

  it('Sandbox und Notbremse: gleich der bisherige Weg; Fremd-Adressen nur mit https', async () => {
    const db = await connected();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await mediaUploadFile(db, { ...prod, env: 'sandbox' }, 'f.jpg', Buffer.from('x'))).toBeNull();
    expect(await urlToEps(db, prod, 'http://bilder.example/1.jpg')).toBeNull();
    vi.stubEnv('EBAY_TRADING_ONLY', '1');
    expect(await mediaUploadFile(db, prod, 'f.jpg', Buffer.from('x'))).toBeNull();
    expect(await urlToEps(db, prod, 'https://bilder.example/1.jpg')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('übernimmt ein Bild von einer https-Adresse', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_url');
      expect(JSON.parse(String(init?.body))).toEqual({ imageUrl: 'https://bilder.example/1.jpg' });
      return new Response(JSON.stringify({ imageUrl: 'https://i.ebayimg.example/von-url.jpg' }), { status: 201 });
    }));
    expect(await urlToEps(await connected(), prod, 'https://bilder.example/1.jpg')).toBe('https://i.ebayimg.example/von-url.jpg');
  });
});
