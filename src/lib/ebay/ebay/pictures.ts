import type { Db } from '../db/db';
import type { Settings } from '../types';
import { getUserAccessToken } from './auth';
import { ACCEPT_LANGUAGE, apiBase, mediaBase } from './config';

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

/** Antwort der Media API: Bild-Adresse direkt oder über die Bild-ID aus dem Location-Header (getImage). */
async function mediaImageUrl(base: string, token: string, res: Response): Promise<string> {
  const text = await res.text();
  if (res.status !== 201 && !res.ok) {
    let msg = '';
    try {
      msg = ((JSON.parse(text).errors ?? []) as { longMessage?: string; message?: string }[]).map((e) => e.longMessage ?? e.message).filter(Boolean).join('; ');
    } catch {
      // keine JSON-Antwort
    }
    throw new Error(`Media API → HTTP ${res.status}${msg ? ` (${msg})` : ''}`);
  }
  try {
    const direct = text ? (JSON.parse(text) as { imageUrl?: string }).imageUrl : undefined;
    if (direct) return direct;
  } catch {
    // leerer oder kein JSON-Rumpf – dann über getImage
  }
  const id = (res.headers.get('location') ?? '').split('/').filter(Boolean).pop();
  if (!id) throw new Error('Media API: keine Bild-ID in der Antwort.');
  const r = await fetch(`${base}/image/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const img = (await r.json().catch(() => ({}))) as { imageUrl?: string };
  if (!r.ok || !img.imageUrl) throw new Error(`Media API getImage → HTTP ${r.status}`);
  return img.imageUrl;
}

/** Neu: Datei über die Media API (createImageFromFile). null = in dieser Umgebung nicht verfügbar. */
export async function mediaUploadFile(db: Db, settings: Settings, filename: string, data: Buffer): Promise<string | null> {
  const base = mediaBase(settings.env);
  if (!base || process.env.EBAY_TRADING_ONLY === '1') return null;
  const token = await getUserAccessToken(db, settings);
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(data)]), filename);
  const res = await fetch(`${base}/image/create_image_from_file`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': ACCEPT_LANGUAGE }, body: form });
  return mediaImageUrl(base, token, res);
}

/** Neu: Bild von einer https-Adresse über die Media API (createImageFromUrl). null = nicht verfügbar. */
export async function urlToEps(db: Db, settings: Settings, imageUrl: string): Promise<string | null> {
  const base = mediaBase(settings.env);
  if (!base || process.env.EBAY_TRADING_ONLY === '1' || !imageUrl.startsWith('https://')) return null;
  const token = await getUserAccessToken(db, settings);
  const res = await fetch(`${base}/image/create_image_from_url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': ACCEPT_LANGUAGE },
    body: JSON.stringify({ imageUrl }),
  });
  return mediaImageUrl(base, token, res);
}

/**
 * Lädt ein Bild zu eBay Picture Services (EPS) hoch und liefert die eBay-Bild-URL. Zuerst über die neue
 * Media API; ist sie nicht verfügbar oder lehnt ab, wie bisher über den Trading-Aufruf UploadSiteHostedPictures.
 */
export async function uploadPictureToEps(db: Db, settings: Settings, filename: string, data: Buffer): Promise<string> {
  try {
    const url = await mediaUploadFile(db, settings, filename, data);
    if (url) return url;
  } catch (e) {
    console.warn(`[eBay] Bild-Upload: Media API fehlgeschlagen, nutze Trading API – ${e instanceof Error ? e.message : e}`);
  }
  return tradingUpload(db, settings, filename, data);
}

/** Bisheriger Weg: Trading-Aufruf UploadSiteHostedPictures mit dem OAuth-User-Token (IAF-Header). */
async function tradingUpload(db: Db, settings: Settings, filename: string, data: Buffer): Promise<string> {
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
