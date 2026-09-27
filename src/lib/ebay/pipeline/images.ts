import type { Db } from '../db/db';
import { getAttempt, updateAttempt } from '../db/db';
import type { ListingAttempt } from '../types';

export const MAX_IMAGES = 12;

async function loadEditable(db: Db, id: number): Promise<ListingAttempt> {
  const attempt = await getAttempt(db, id);
  if (!attempt) throw new Error(`Listing-Versuch ${id} nicht gefunden.`);
  if (attempt.status === 'published') throw new Error('Veröffentlichte Listings können nicht mehr geändert werden.');
  return attempt;
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Nach Bildänderungen Status/Fehler neu bewerten (no_images-Blocker setzen oder aufheben). */
function statusPatch(attempt: ListingAttempt, imageUrls: string[]): Partial<ListingAttempt> {
  if (imageUrls.length > 0 && attempt.status === 'no_images') {
    return { imageUrls, status: 'draft', errorMessage: undefined };
  }
  if (imageUrls.length === 0 && attempt.status === 'draft' && !attempt.epid) {
    return {
      imageUrls,
      status: 'no_images',
      errorMessage: 'Ohne Bild und ohne Katalogreferenz (ePID) kann nicht veröffentlicht werden.',
    };
  }
  return { imageUrls };
}

export async function addImages(db: Db, id: number, urls: string[]): Promise<ListingAttempt> {
  const attempt = await loadEditable(db, id);
  for (const url of urls) {
    if (!isHttpUrl(url)) throw new Error(`Ungültige Bild-URL: ${url.slice(0, 80)}`);
  }
  const merged = [...(attempt.imageUrls ?? [])];
  for (const url of urls) if (!merged.includes(url)) merged.push(url);
  if (merged.length > MAX_IMAGES) throw new Error(`Höchstens ${MAX_IMAGES} Bilder pro Listing (eBay-Limit).`);
  return (await updateAttempt(db, id, statusPatch(attempt, merged)))!;
}

export async function removeImage(db: Db, id: number, url: string): Promise<ListingAttempt> {
  const attempt = await loadEditable(db, id);
  const remaining = (attempt.imageUrls ?? []).filter((u) => u !== url);
  return (await updateAttempt(db, id, statusPatch(attempt, remaining)))!;
}
