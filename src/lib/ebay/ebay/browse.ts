import type { Db } from '../db/db';
import type { CatalogMatch, CatalogProduct, EanLookupResult, Settings } from '../types';
import { extractCatalogProduct, extractListingFacts, extractListingImages } from '../pipeline/browseMap';
import { extractGpsr } from '../pipeline/gpsr';
import { extractGtins, isRealGtin, itemCarriesGtin } from '../pipeline/gtin';
import { getAppAccessToken } from './auth';
import { ACCEPT_LANGUAGE, apiBase, MARKETPLACE } from './config';
import { ebayFetch } from './http';

const MAX_ITEM_LOOKUPS = 5;

interface ItemSummary {
  itemId?: string;
  itemWebUrl?: string;
  epid?: string;
}

async function headers(db: Db, settings: Settings): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAppAccessToken(db, settings)}`,
    'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    Accept: 'application/json',
    'Accept-Language': ACCEPT_LANGUAGE,
  };
}

async function getItem(db: Db, settings: Settings, itemId: string): Promise<unknown> {
  return ebayFetch(
    `${apiBase(settings.env)}/buy/browse/v1/item/${encodeURIComponent(itemId)}?fieldgroups=PRODUCT`,
    { headers: await headers(db, settings) }
  );
}

/**
 * Recherchiert eine EAN über aktive eBay-Listings (Browse API):
 * Katalogdaten (product-Block, inkl. Stockfotos und ePID) und GPSR-Angaben
 * (Hersteller / EU-verantwortliche Person) in einem Sweep. ebay.de-Listings
 * zuerst, höchstens MAX_ITEM_LOOKUPS Einzelabrufe, früher Abbruch sobald
 * Produkt und GPSR gefunden sind.
 *
 * Zwei Suchwege: Der gtin=-Filter der Browse API greift nur auf gepflegte
 * Katalog-GTINs und liefert für viele EANs nichts, obwohl aktive Listings die
 * Nummer im gtin-Feld führen. Bleibt er leer, wird — wie die Website-Suche —
 * per Stichwort gesucht; solche Treffer gelten aber erst, wenn das Item die
 * EAN nachweislich trägt (siehe itemCarriesGtin).
 */
export async function lookupByEan(db: Db, settings: Settings, ean: string): Promise<EanLookupResult> {
  const h = await headers(db, settings);
  const search = async (param: string): Promise<ItemSummary[]> => {
    const result = (await ebayFetch(
      `${apiBase(settings.env)}/buy/browse/v1/item_summary/search?${param}&limit=20`,
      { headers: h }
    )) as { itemSummaries?: ItemSummary[] } | null;
    return (result?.itemSummaries ?? []).filter((s) => typeof s.itemId === 'string');
  };

  let summaries = await search(`gtin=${encodeURIComponent(ean)}`);
  let needsGtinCheck = false;
  if (summaries.length === 0) {
    summaries = await search(`q=${encodeURIComponent(ean)}`);
    needsGtinCheck = true;
  }

  const germanFirst = [
    ...summaries.filter((s) => s.itemWebUrl?.includes('ebay.de')),
    ...summaries.filter((s) => !s.itemWebUrl?.includes('ebay.de')),
  ].slice(0, MAX_ITEM_LOOKUPS);

  const matches: CatalogMatch[] = [];
  let product: CatalogProduct | null = null;
  let gpsr: EanLookupResult['gpsr'] = null;

  for (const summary of germanFirst) {
    if (product && gpsr) break;
    let item: unknown;
    try {
      item = await getItem(db, settings, summary.itemId!);
    } catch {
      continue; // Einzelnes Item nicht abrufbar (beendet, regional gesperrt …) — weiter.
    }

    // Stichwort-Treffer können die Zahl bloß im Text führen — nur echte EAN-Träger zählen.
    if (needsGtinCheck && !itemCarriesGtin(item, ean)) continue;

    // Die ePID liefert nur das Such-Summary — getItem gibt sie an normale Keysets nicht heraus.
    const extracted = extractCatalogProduct(item, summary.epid);
    if (extracted) {
      const isDuplicate = matches.some((m) => (m.epid && m.epid === extracted.epid) || m.ref === summary.itemId);
      if (!isDuplicate) {
        matches.push({ ref: summary.itemId!, epid: extracted.epid, title: extracted.title });
      }
      if (!product) product = extracted;
    }
    if (!gpsr) gpsr = extractGpsr(item);
  }

  return { matches, product, gpsr };
}

/**
 * Lädt Katalogdaten + GPSR eines konkreten Browse-Items (gewählter Suchtreffer
 * / Treffer-Wechsel). Die ePID kommt als Hint aus dem Such-Summary mit; die
 * GTINs des Items liefern die EAN nach, wenn nach Produkttitel statt nach EAN
 * gesucht wurde — und decken auf, wenn ein Stichwort-Treffer eine andere EAN
 * trägt als die gesuchte.
 *
 * Kennt der Katalog das Produkt nicht, treten die Fakten des Angebots an seine
 * Stelle (`extractListingFacts`) — übernommen wird der Treffer trotzdem.
 */
export async function fetchItemByRef(
  db: Db,
  settings: Settings,
  itemId: string,
  epidHint?: string
): Promise<{
  product: CatalogProduct | null;
  gpsr: ReturnType<typeof extractGpsr>;
  gtins: string[];
  listingImages: string[];
}> {
  const item = await getItem(db, settings, itemId);
  return {
    product: extractCatalogProduct(item, epidHint) ?? extractListingFacts(item),
    gpsr: extractGpsr(item),
    gtins: extractGtins(item),
    listingImages: extractListingImages(item),
  };
}

export interface FetchedItem {
  ref: string;
  product: CatalogProduct | null;
  gpsr: ReturnType<typeof extractGpsr>;
  listingImages: string[];
}

/**
 * Lädt ein Listing über die Artikelnummer aus einer eingefügten eBay-URL.
 * Variantenlistings (get_item_by_legacy_id schlägt fehl) werden über die
 * Item-Gruppe aufgelöst: Produktdaten und GPSR aus den Varianten zusammengesucht.
 */
export async function fetchItemByLegacyId(db: Db, settings: Settings, legacyId: string): Promise<FetchedItem> {
  const h = await headers(db, settings);
  try {
    const item = (await ebayFetch(
      `${apiBase(settings.env)}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(legacyId)}&fieldgroups=PRODUCT`,
      { headers: h }
    )) as Record<string, unknown>;
    const ref = typeof item?.itemId === 'string' ? item.itemId : `v1|${legacyId}|0`;
    let product = extractCatalogProduct(item);
    // getItem liefert keine ePID — über die GTIN des Items im Such-Summary nachschlagen.
    if (!product && isRealGtin(item?.gtin)) {
      const epidHint = await findEpidByGtin(db, settings, String(item.gtin), ref);
      if (epidHint) product = extractCatalogProduct(item, epidHint);
    }
    // Erst nach diesem Versuch: ohne jeden Katalogbezug zählen die Fakten des Angebots.
    product ??= extractListingFacts(item);
    return { ref, product, gpsr: extractGpsr(item), listingImages: extractListingImages(item) };
  } catch (err) {
    // Variantenlisting? Über die Item-Gruppe versuchen; sonst Originalfehler werfen.
    const group = (await ebayFetch(
      `${apiBase(settings.env)}/buy/browse/v1/item/get_items_by_item_group?item_group_id=${encodeURIComponent(legacyId)}`,
      { headers: h }
    ).catch(() => null)) as { items?: Record<string, unknown>[] } | null;
    const items = group?.items ?? [];
    if (items.length === 0) throw err;

    let product: CatalogProduct | null = null;
    let gpsr: ReturnType<typeof extractGpsr> = null;
    let ref = `v1|${legacyId}|0`;
    // Bilder aus derselben Variante, die auch die Produktdaten liefert.
    let listingImages: string[] = [];
    for (const item of items) {
      const extracted = extractCatalogProduct(item);
      if (extracted && !product) {
        product = extracted;
        listingImages = extractListingImages(item);
        if (typeof item.itemId === 'string') ref = item.itemId;
      }
      if (!gpsr) gpsr = extractGpsr(item);
      if (product && gpsr) break;
    }
    if (!product) {
      const first = items[0];
      if (isRealGtin(first?.gtin)) {
        const epidHint = await findEpidByGtin(db, settings, String(first.gtin), String(first.itemId ?? ''));
        if (epidHint) product = extractCatalogProduct(first, epidHint);
      }
      // Keine Variante mit Katalogbezug — die Fakten der ersten Variante.
      product ??= extractListingFacts(first);
      listingImages = extractListingImages(first);
      if (typeof first.itemId === 'string') ref = first.itemId;
    }
    return { ref, product, gpsr, listingImages };
  }
}

/** Sucht die ePID zu einer GTIN über die Such-Summaries (bevorzugt das Item selbst). */
async function findEpidByGtin(db: Db, settings: Settings, gtin: string, preferItemId: string): Promise<string | undefined> {
  const result = (await ebayFetch(
    `${apiBase(settings.env)}/buy/browse/v1/item_summary/search?gtin=${encodeURIComponent(gtin)}&limit=10`,
    { headers: await headers(db, settings) }
  ).catch(() => null)) as { itemSummaries?: ItemSummary[] } | null;
  const summaries = result?.itemSummaries ?? [];
  const own = summaries.find((s) => s.itemId === preferItemId && s.epid);
  return own?.epid ?? summaries.find((s) => s.epid)?.epid;
}

export interface ListingSearchResult {
  ref: string;
  title: string;
  price?: string;
  currency?: string;
  imageUrl?: string;
  epid?: string;
  itemWebUrl?: string;
  condition?: string;
  /**
   * Blattkategorie des Treffers. Nur für die Gebührenschätzung in Schritt 3 —
   * verbindlich wird die Kategorie erst beim Anlegen aus dem vollen Item.
   */
  categoryId?: string;
}

/**
 * Sucht aktive ebay.de-Listings für die Trefferauswahl — Einstieg des Workflows.
 * Reine Ziffernfolgen gelten als EAN und laufen zuerst über den gtin=-Filter;
 * bleibt er leer (eBays Katalog-GTINs sind lückenhaft), wird wie bei der
 * Website-Suche per Stichwort gesucht. Alles andere ist direkt ein Stichwort.
 */
export async function searchListings(db: Db, settings: Settings, query: string): Promise<ListingSearchResult[]> {
  const q = query.trim();
  const h = await headers(db, settings);

  const run = async (param: string): Promise<ListingSearchResult[]> => {
    const url = `${apiBase(settings.env)}/buy/browse/v1/item_summary/search?${param}&limit=24`;
    const result = (await ebayFetch(url, { headers: h })) as { itemSummaries?: Record<string, unknown>[] } | null;
    return (result?.itemSummaries ?? []).filter((s) => typeof s.itemId === 'string').map(toResult);
  };

  if (/^\d{8,14}$/.test(q)) {
    const byGtin = await run(`gtin=${encodeURIComponent(q)}`);
    if (byGtin.length > 0) return byGtin;
  }
  return run(`q=${encodeURIComponent(q)}`);
}

function toResult(s: Record<string, unknown>): ListingSearchResult {
  return {
    ref: s.itemId as string,
    title: String(s.title ?? ''),
    price: (s.price as { value?: string } | undefined)?.value,
    currency: (s.price as { currency?: string } | undefined)?.currency,
    imageUrl:
      (s.image as { imageUrl?: string } | undefined)?.imageUrl ??
      (s.thumbnailImages as { imageUrl?: string }[] | undefined)?.[0]?.imageUrl,
    epid: typeof s.epid === 'string' && s.epid !== '' ? s.epid : undefined,
    itemWebUrl: typeof s.itemWebUrl === 'string' ? s.itemWebUrl : undefined,
    condition: typeof s.condition === 'string' ? s.condition : undefined,
    categoryId: leafCategoryId(s),
  };
}

/**
 * Dieselbe Vorrangfolge wie in `extractCatalogProduct` (pipeline/browseMap.ts),
 * damit die Schätzung in Schritt 3 und der Wert nach dem Anlegen übereinstimmen.
 */
export function leafCategoryId(s: Record<string, unknown>): string | undefined {
  const leaves = s.leafCategoryIds as unknown;
  if (Array.isArray(leaves) && typeof leaves[0] === 'string' && leaves[0] !== '') return leaves[0];
  const categories = s.categories as { categoryId?: unknown }[] | undefined;
  const first = Array.isArray(categories) ? categories[0]?.categoryId : undefined;
  return typeof first === 'string' && first !== '' ? first : undefined;
}
