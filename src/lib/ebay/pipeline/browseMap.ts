import type { CatalogProduct } from '../types';

interface RawImage {
  imageUrl?: string;
}

/**
 * Merkmale des Angebots: bevorzugt die Aspektgruppen des Katalogs, sonst die
 * `localizedAspects` des Listings. Beides sind Fakten (Marke, Farbe, Modell) —
 * keine Verkäufertexte.
 */
function extractAspects(src: Record<string, unknown>, product?: Record<string, unknown>): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const groups = product?.aspectGroups as
    | { aspects?: { localizedName?: string; localizedValues?: string[] }[] }[]
    | undefined;
  for (const group of groups ?? []) {
    for (const a of group.aspects ?? []) {
      if (a?.localizedName && Array.isArray(a.localizedValues) && a.localizedValues.length > 0) {
        aspects[a.localizedName] = a.localizedValues;
      }
    }
  }
  if (Object.keys(aspects).length === 0) {
    const localized = src.localizedAspects as { name?: string; value?: string }[] | undefined;
    for (const a of localized ?? []) {
      if (!a?.name || typeof a.value !== 'string' || a.value === '') continue;
      (aspects[a.name] ??= []).push(a.value);
    }
  }
  return aspects;
}

function extractCategoryId(src: Record<string, unknown>): string | undefined {
  const leafCategories = src.leafCategoryIds as string[] | undefined;
  return (
    (typeof src.categoryId === 'string' && src.categoryId) ||
    (Array.isArray(leafCategories) && typeof leafCategories[0] === 'string' && leafCategories[0]) ||
    undefined
  );
}

function extractBrand(src: Record<string, unknown>, product?: Record<string, unknown>): string | undefined {
  return (
    (product && typeof product.brand === 'string' && product.brand) ||
    (typeof src.brand === 'string' && src.brand) ||
    undefined
  );
}

/**
 * Extrahiert die Katalog-/Faktendaten aus einem Browse-Item.
 *
 * Zwei Qualitätsstufen:
 * 1. Voll: product-Block vorhanden (Katalogtitel, Stockfotos, Aspekte).
 * 2. Referenz: nur eine ePID (aus dem Such-Summary als `epidHint`, da getItem
 *    sie an normale Keysets nicht ausliefert) plus Fakten des Listings
 *    (localizedAspects, brand, categoryId). Titel/Bilder bleiben leer —
 *    eBay ergänzt sie beim Veröffentlichen aus dem Katalog (ePID-Referenz).
 *
 * Verkäufer-Inhalte (item.title, item.image, item.description) werden nie
 * übernommen. Ohne product-Block UND ohne ePID: null (kein Katalogbezug) —
 * dieser Fall gehört `extractListingFacts`.
 */
export function extractCatalogProduct(item: unknown, epidHint?: string): CatalogProduct | null {
  if (typeof item !== 'object' || item === null) return null;
  const src = item as Record<string, unknown>;
  const rawProduct = src.product as Record<string, unknown> | undefined;
  const product =
    rawProduct && typeof rawProduct.title === 'string' && rawProduct.title.trim() !== '' ? rawProduct : undefined;

  const epid =
    (typeof src.epid === 'string' && src.epid !== '' && src.epid) ||
    (typeof epidHint === 'string' && epidHint !== '' && epidHint) ||
    undefined;
  if (!product && !epid) return null;

  const imageUrls: string[] = [];
  const main = (product?.image as RawImage | undefined)?.imageUrl;
  if (main) imageUrls.push(main);
  for (const img of (product?.additionalImages as RawImage[] | undefined) ?? []) {
    if (img?.imageUrl && !imageUrls.includes(img.imageUrl)) imageUrls.push(img.imageUrl);
  }

  const description =
    product && typeof product.description === 'string' && product.description.trim() !== ''
      ? product.description
      : undefined;

  return {
    origin: 'catalog',
    epid,
    title: product ? (product.title as string) : '',
    description,
    imageUrls,
    aspects: extractAspects(src, product),
    brand: extractBrand(src, product),
    categoryId: extractCategoryId(src),
  };
}

/**
 * Dritte Qualitätsstufe: das Angebot hat weder product-Block noch ePID —
 * eBays Katalog kennt das Produkt nicht (bei vielen Artikeln der Normalfall).
 * Übernommen werden dann die Fakten des Angebots selbst: Artikelmerkmale,
 * Marke und Kategorie.
 *
 * Wie in `extractCatalogProduct` bleiben Verkäufer-Texte außen vor: Titel und
 * Beschreibung entstehen später aus diesen Fakten (`buildFactTitle`,
 * `buildDescription`) oder werden in der Vorschau eingegeben. Die Fotos des
 * Angebots kommen wie gehabt getrennt über `extractListingImages` — die
 * Rechtefrage entscheidet der Nutzer pro Artikel.
 */
export function extractListingFacts(item: unknown): CatalogProduct | null {
  if (typeof item !== 'object' || item === null) return null;
  const src = item as Record<string, unknown>;
  return {
    origin: 'listing',
    title: '',
    imageUrls: [],
    aspects: extractAspects(src),
    brand: extractBrand(src),
    categoryId: extractCategoryId(src),
  };
}

/**
 * Bilder des Listings selbst (Fotos des Verkäufers).
 *
 * Bewusst getrennt von extractCatalogProduct: die Katalogextraktion garantiert,
 * dass niemals Verkäufer-Inhalte einfließen. Wer diese Bilder nutzt, entscheidet
 * die Rechtefrage pro Artikel selbst — deshalb eine eigene, explizite Funktion.
 */
export function extractListingImages(item: unknown): string[] {
  if (typeof item !== 'object' || item === null) return [];
  const src = item as Record<string, unknown>;
  const urls: string[] = [];
  const main = (src.image as RawImage | undefined)?.imageUrl;
  if (main) urls.push(main);
  for (const img of (src.additionalImages as RawImage[] | undefined) ?? []) {
    if (img?.imageUrl && !urls.includes(img.imageUrl)) urls.push(img.imageUrl);
  }
  return urls;
}
