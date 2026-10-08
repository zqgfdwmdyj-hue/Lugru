import type { Db } from '../db/db';
import type { Settings } from '../types';
import { getUserAccessToken } from './auth';
import { ACCEPT_LANGUAGE, apiBase } from './config';

function escXml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function buildUploadXml(pictureName: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">' +
    '<WarningLevel>High</WarningLevel>' +
    `<PictureName>${escXml(pictureName)}</PictureName>` +
    '<PictureSet>Standard</PictureSet>' +
    '<ExtensionInDays>30</ExtensionInDays>' +
    '</UploadSiteHostedPicturesRequest>'
  );
}

export function parseUploadResponse(xml: string): string {
  const fullUrl = xml.match(/<FullURL>([^<]+)<\/FullURL>/)?.[1];
  if (fullUrl) return fullUrl.replaceAll('&amp;', '&');
  const message =
    xml.match(/<LongMessage>([^<]+)<\/LongMessage>/)?.[1] ?? xml.match(/<ShortMessage>([^<]+)<\/ShortMessage>/)?.[1];
  throw new Error(message ? `Bild-Upload abgelehnt: ${message}` : 'Bild-Upload fehlgeschlagen: unerwartete Antwort von eBay.');
}

function tradingApiUrl(settings: Settings): string {
  return `${apiBase(settings.env)}/ws/api.dll`;
}

/**
 * Lädt ein Bild zu eBay Picture Services (EPS) hoch und liefert die eBay-Bild-URL.
 * Nutzt den Trading-API-Call UploadSiteHostedPictures mit dem OAuth-User-Token
 * (IAF-Header) — der einzige eBay-Weg, eigene Dateien für Inventory-Listings zu hosten.
 */
export async function uploadPictureToEps(db: Db, settings: Settings, filename: string, data: Buffer): Promise<string> {
  const token = await getUserAccessToken(db, settings);
  const form = new FormData();
  form.append('XML Payload', buildUploadXml(filename));
  form.append('file', new Blob([new Uint8Array(data)]), filename);

  const res = await fetch(tradingApiUrl(settings), {
    method: 'POST',
    headers: {
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
      'X-EBAY-API-CALL-NAME': 'UploadSiteHostedPictures',
      'X-EBAY-API-SITEID': '77',
      'X-EBAY-API-IAF-TOKEN': token,
      'Accept-Language': ACCEPT_LANGUAGE,
    },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bild-Upload fehlgeschlagen (HTTP ${res.status}).`);
  return parseUploadResponse(text);
}
