import type { Db } from '../db/db';
import { articleKey } from './articles';
import { createAttempt, getAttempt, updateAttempt } from '../db/db';
import type { CatalogMatch, CatalogProduct, Condition, EanLookupResult, Gpsr, ListingAttempt } from '../types';
import { buildDescription } from './describe';
import { isRealGtin, sameGtin } from './gtin';
import { MAX_IMAGES } from './images';
import { buildFactTitle, truncateTitle } from './title';

/** Produktdatenquelle als Interface — hier kann später z.B. Keepa einsteigen. */
export interface CollectSources {
  lookupByEan(ean: string): Promise<EanLookupResult>;
  fetchItemByRef(
    ref: string,
    epidHint?: string
  ): Promise<{ product: CatalogProduct | null; gpsr: Gpsr | null; gtins?: string[]; listingImages?: string[] }>;
}

export const GPSR_WARNING =
  'GPSR-Daten (Hersteller / EU-verantwortliche Person) wurden in keinem bestehenden Listing gefunden. ' +
  'eBay kann die Veröffentlichung ablehnen, wenn die Kategorie diese Angaben verlangt.';

export const EPID_ADOPTION_INFO =
  'Dieses Listing nutzt eine eBay-Katalogreferenz (ePID): Produktbilder und ggf. weitere Produktdaten ' +
  'ergänzt eBay beim Veröffentlichen automatisch aus dem Katalog.';

/** Weder Katalog noch Angebotsfakten — dann ist am Treffer wirklich nichts zu holen. */
export const NO_ITEM_DATA_ERROR =
  'Zu diesem Treffer liefert eBay keine Artikeldaten — bitte einen anderen Treffer wählen.';

export const NO_CATALOG_INFO =
  'Dieses Angebot hat keinen Katalogbezug (kein Katalogeintrag, keine ePID). Artikelmerkmale, Kategorie und ' +
  'Bilder stammen deshalb aus dem Angebot selbst, der Titel aus dessen Merkmalen — bitte vor dem ' +
  'Veröffentlichen prüfen und bei Bedarf anpassen.';

/** Label im Treffer-Umschalter, wenn weder Katalog- noch Fakten-Titel etwas hergeben. */
const UNTITLED_MATCH = 'Angebot ohne Titel';

export const TITLE_MISSING_WARNING =
  'Es konnte kein Titel aus den Produktdaten erzeugt werden — bitte in der Vorschau einen Titel eingeben.';

/**
 * Die EAN-Suche fällt still auf die Stichwortsuche zurück, wenn eBays
 * Katalog-GTINs nichts hergeben — dann kann ein gewählter Treffer eine ganz
 * andere Nummer tragen. Die gesuchte EAN darf ihn nicht überschreiben: Sie
 * würde zum Artikelschlüssel und ginge als `product.ean` an eBay.
 */
export function eanMismatchError(searched: string, found: string[]): string {
  const carried = found.length === 1 ? `die EAN ${found[0]}` : `die Nummern ${found.join(', ')}`;
  return (
    `Der gewählte Treffer trägt ${carried}, gesucht war ${searched}. ` +
    'Bitte einen Treffer mit der gesuchten EAN wählen — oder nach dem Produkttitel suchen, ' +
    'dann übernimmt das Tool die EAN aus dem Angebot.'
  );
}

/** Der vom Nutzer gewählte Suchtreffer plus seine Verkaufsdaten. */
export interface SelectionInput {
  /** Item-ID des gewählten Listings (aus der Suche). */
  ref: string;
  /** ePID aus dem Such-Summary — getItem gibt sie an normale Keysets nicht heraus. */
  epid?: string;
  /** EAN, falls danach gesucht wurde; sonst wird sie aus dem Listing gelesen. */
  ean?: string;
  price: number;
  quantity: number;
  condition: Condition;
  /** Gekaufte Einheiten — unabhängig von der Angebots-Stückzahl. */
  purchasedUnits?: number;
  /** Einkaufspreis pro Stück. */
  purchasePrice?: number;
  purchaseSource?: string;
  /** Angedachter Verkaufspreis; `price` ist damit bereits vorbelegt. */
  targetPrice?: number;
}

/**
 * Legt den Entwurf aus einem gewählten Suchtreffer an (Workflow: suchen →
 * Listing wählen → Preis, Menge, Zustand). Erst laden, dann speichern: ein
 * Treffer, der gar keine Daten liefert, hinterlässt so keine Karteileiche im
 * Verlauf.
 *
 * Katalogdaten sind dabei die Kür, nicht die Pflicht: Kennt eBays Katalog das
 * Produkt nicht, trägt das Angebot selbst die Fakten bei (siehe
 * `extractListingFacts` in pipeline/browseMap.ts) — der Entwurf entsteht
 * trotzdem, mit einem Hinweis in der Vorschau.
 */
export async function collectFromSelection(
  db: Db,
  sources: CollectSources,
  input: SelectionInput
): Promise<ListingAttempt> {
  const item = await sources.fetchItemByRef(input.ref, input.epid);
  if (!item.product) throw new Error(NO_ITEM_DATA_ERROR);

  const searched = (input.ean ?? '').trim();
  const carried = (item.gtins ?? []).filter(isRealGtin);
  if (searched !== '' && carried.length > 0 && !carried.some((g) => sameGtin(g, searched))) {
    throw new Error(eanMismatchError(searched, carried));
  }
  const ean = searched !== '' ? searched : (carried[0] ?? '');
  // GPSR fehlt im gewählten Listing oft — mit der EAN über die übrigen Angebote nachschlagen.
  let gpsr = item.gpsr;
  if (!gpsr && ean !== '') {
    gpsr = await sources
      .lookupByEan(ean)
      .then((r) => r.gpsr)
      .catch(() => null);
  }

  const attempt = await createAttempt(db, {
    ean,
    price: input.price,
    quantity: input.quantity,
    condition: input.condition,
    purchasedUnits: input.purchasedUnits,
    purchasePrice: input.purchasePrice,
    purchaseSource: input.purchaseSource,
    targetPrice: input.targetPrice,
  });
  return await applyProduct(db, attempt.id, {
    ref: input.ref,
    product: item.product,
    gpsr,
    listingImages: item.listingImages,
    articleKey: articleKey({ ean, epid: item.product.epid, id: attempt.id }),
  });
}

/**
 * Übernimmt einen konkreten Treffer (Katalogtreffer-Wechsel oder Fund aus der
 * Artikelsuche). Vorhandenes GPSR bleibt; fehlt es, wird es aus dem gewählten
 * Item übernommen.
 */
export async function recollectWithMatch(
  db: Db,
  sources: CollectSources,
  id: number,
  ref: string,
  epidHint?: string
): Promise<ListingAttempt> {
  const attempt = await getAttempt(db, id);
  if (!attempt) throw new Error(`Listing-Versuch ${id} nicht gefunden.`);
  const item = await sources.fetchItemByRef(ref, epidHint);
  return await mergeFetchedItem(db, id, attempt, ref, item);
}

/** Übernimmt ein bereits geladenes Item (z.B. aus einer eingefügten eBay-URL) in den Entwurf. */
export async function applyFetchedItem(
  db: Db,
  id: number,
  data: { ref: string; product: CatalogProduct | null; gpsr: Gpsr | null; listingImages?: string[] }
): Promise<ListingAttempt> {
  const attempt = await getAttempt(db, id);
  if (!attempt) throw new Error(`Listing-Versuch ${id} nicht gefunden.`);
  return await mergeFetchedItem(db, id, attempt, data.ref, data);
}

async function mergeFetchedItem(
  db: Db,
  id: number,
  attempt: ListingAttempt,
  ref: string,
  item: { product: CatalogProduct | null; gpsr: Gpsr | null; listingImages?: string[] }
): Promise<ListingAttempt> {
  if (!item.product) throw new Error(NO_ITEM_DATA_ERROR);
  return await applyProduct(db, id, {
    ref,
    previousMatches: attempt.catalogMatches,
    product: item.product,
    gpsr: attempt.gpsr ?? item.gpsr,
    listingImages: item.listingImages,
  });
}

async function applyProduct(
  db: Db,
  id: number,
  data: {
    /** Der übernommene Treffer; er wird zum aktuellen Eintrag in `catalogMatches`. */
    ref: string;
    /** Bisherige Treffer des Entwurfs — beim Anlegen leer. */
    previousMatches?: CatalogMatch[];
    product: CatalogProduct;
    gpsr: Gpsr | null;
    listingImages?: string[];
    /** Nur beim Anlegen gesetzt; ein Treffer-Wechsel darf den Artikel nicht verschieben. */
    articleKey?: string;
  }
): Promise<ListingAttempt> {
  const { product, gpsr } = data;
  // Katalogbilder zuerst — das erste Bild wird auf eBay zum Galeriebild.
  const imageUrls: string[] = [];
  for (const url of [...product.imageUrls, ...(data.listingImages ?? [])]) {
    if (!imageUrls.includes(url) && imageUrls.length < MAX_IMAGES) imageUrls.push(url);
  }
  const title = product.title ? truncateTitle(product.title) : buildFactTitle(product.brand, product.aspects);
  // Ohne eigene Bilder ist das Listing nur mit ePID-Referenz möglich (eBay ergänzt die Katalogbilder).
  const blocked = imageUrls.length === 0 && !product.epid;
  // Im Umschalter steht der Katalogtitel; ohne ihn der erzeugte Fakten-Titel.
  const matches = [
    ...(data.previousMatches ?? []).filter((m) => m.ref !== data.ref),
    { ref: data.ref, epid: product.epid, title: product.title || title || UNTITLED_MATCH },
  ];

  const warnings: string[] = [];
  if (product.origin === 'listing') warnings.push(NO_CATALOG_INFO);
  if (!gpsr) warnings.push(GPSR_WARNING);
  if (!blocked && imageUrls.length === 0) warnings.push(EPID_ADOPTION_INFO);
  if (!blocked && title === '') warnings.push(TITLE_MISSING_WARNING);

  return (await updateAttempt(db, id, {
    status: blocked ? 'no_images' : 'draft',
    errorMessage: blocked
      ? 'Für dieses Listing sind weder Bilder noch eine Katalogreferenz (ePID) verfügbar. eBay verlangt mindestens ein Bild — bitte eigene Fotos hochladen oder einen anderen Treffer wählen.'
      : undefined,
    epid: product.epid,
    catalogMatches: matches,
    title,
    description: buildDescription(title, product.aspects, product.description),
    imageUrls,
    aspects: product.aspects,
    categoryId: product.categoryId,
    gpsr,
    warnings,
    ...(data.articleKey === undefined ? {} : { articleKey: data.articleKey }),
  }))!;
}
