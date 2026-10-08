import type { Db } from '../db/db';
import type { Settings } from '../types';
import { mapTaxonomyAspects, type CategoryAspect } from '../pipeline/aspects';
import { getAppAccessToken } from './auth';
import { ACCEPT_LANGUAGE, apiBase, MARKETPLACE } from './config';
import { ebayFetch } from './http';

/** Kategoriebaum von eBay.de. */
const TREE_ID = '77';
const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; aspects: CategoryAspect[] }>();

/**
 * Artikelmerkmale einer Kategorie (Pflicht, empfohlen, erlaubte Werte) über die
 * Taxonomy API. Ändern sich selten — 12 Stunden im Speicher.
 */
export async function getCategoryAspects(db: Db, settings: Settings, categoryId: string): Promise<CategoryAspect[]> {
  const key = `${settings.env}:${categoryId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.aspects;
  const base = apiBase(settings.env);
  const json = await ebayFetch(
    `${base}/commerce/taxonomy/v1/category_tree/${TREE_ID}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    {
      headers: {
        Authorization: `Bearer ${await getAppAccessToken(db, settings)}`,
        'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
        Accept: 'application/json',
        'Accept-Language': ACCEPT_LANGUAGE,
      },
    }
  );
  const aspects = mapTaxonomyAspects(json);
  cache.set(key, { at: Date.now(), aspects });
  return aspects;
}
