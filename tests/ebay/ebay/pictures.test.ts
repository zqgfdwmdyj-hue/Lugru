import { describe, expect, it } from 'vitest';
import { buildUploadXml, parseUploadResponse } from '@/lib/ebay/ebay/pictures';

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
