/**
 * Produktbilder von Amazon über die Keepa-API (https://keepa.com/#!api).
 *
 * Keepa führt die Amazon-Produktdaten samt Bildern und liefert sie per EAN
 * oder ASIN — ein offizieller, bezahlter Weg statt Amazon-Seiten auszulesen
 * (das verbieten Amazons Nutzungsbedingungen, und der Bot-Schutz macht es
 * unzuverlässig). Eine Abfrage kostet ein Keepa-Token.
 */

const API = 'https://api.keepa.com/product';
/** Keepa-Kennung für amazon.de. */
const DOMAIN_DE = 3;
const IMAGE_BASE = 'https://m.media-amazon.com/images/I/';
const TIMEOUT_MS = 15_000;

export interface KeepaImages {
  asin?: string;
  title?: string;
  /** Bilder in voller Größe, in Amazons Reihenfolge (Hauptbild zuerst). */
  images: string[];
  amazonUrl?: string;
  /** Verbleibende Keepa-Tokens — zur Info in der Oberfläche. */
  tokensLeft?: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** ASIN: 10 Zeichen, beginnt bei Nicht-Büchern mit „B0". Bücher nutzen die ISBN-10. */
export function isAsin(code: string): boolean {
  return /^B0[A-Z0-9]{8}$/i.test(code) || /^\d{9}[\dX]$/i.test(code);
}

/** Bilddateinamen aus einem Keepa-Produkt — neues Format `images[]` oder altes `imagesCSV`. */
export function imageUrlsFromProduct(product: Record<string, unknown>): string[] {
  const names: string[] = [];
  const images = product.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      const i = img as { l?: unknown; m?: unknown };
      const name = typeof i?.l === 'string' ? i.l : typeof i?.m === 'string' ? i.m : undefined;
      if (name) names.push(name);
    }
  }
  if (names.length === 0 && typeof product.imagesCSV === 'string') {
    names.push(...product.imagesCSV.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return [...new Set(names)].map((n) => (n.startsWith('http') ? n : IMAGE_BASE + n));
}

function keepaError(status: number, json: unknown): Error {
  const e = (json as { error?: { type?: string; message?: string } })?.error;
  if (status === 401 || /invalid.*key|access.?denied/i.test(e?.message ?? '')) {
    return new Error('Der Keepa-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.');
  }
  if (status === 402 || status === 429 || /token/i.test(e?.type ?? '')) {
    return new Error('Keine Keepa-Tokens mehr übrig — bitte kurz warten (Tokens laden sich wieder auf) oder den Keepa-Tarif erhöhen.');
  }
  return new Error(`Keepa meldet einen Fehler: ${e?.message ?? `HTTP ${status}`}`);
}

/** Sucht das Produkt bei Keepa (amazon.de) per EAN oder ASIN und liefert seine Bilder. */
export async function lookupKeepaImages(
  code: string,
  apiKey: string | undefined,
  fetchFn: FetchLike = fetch
): Promise<KeepaImages> {
  if (!apiKey) throw new Error('Für Amazon-Bilder fehlt der Keepa-API-Schlüssel. Bitte in den Einstellungen unter „Bildquellen" eintragen.');
  const clean = code.replace(/[\s-]/g, '').toUpperCase();
  if (clean === '') throw new Error('Für Amazon-Bilder bitte EAN oder ASIN angeben.');
  if (!isAsin(clean) && !/^\d{8,14}$/.test(clean)) throw new Error('Das ist weder eine EAN (8–14 Ziffern) noch eine ASIN.');

  const param = isAsin(clean) ? 'asin' : 'code';
  // history=0: ohne Preishistorie ist die Antwort klein, gebraucht werden nur Stammdaten.
  const url = `${API}?key=${encodeURIComponent(apiKey)}&domain=${DOMAIN_DE}&${param}=${clean}&history=0`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  let json: Record<string, unknown> | null;
  try {
    res = await fetchFn(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new Error(aborted ? 'Keepa antwortet nicht (Zeitüberschreitung).' : `Keepa nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || json?.error) throw keepaError(res.status, json);

  const tokensLeft = typeof json?.tokensLeft === 'number' ? json.tokensLeft : undefined;
  const products = (json?.products as Record<string, unknown>[] | undefined) ?? [];
  // Eine EAN kann auf mehrere ASINs zeigen (Varianten, Bundles) — die erste mit Bildern zählt.
  const product = products.find((p) => imageUrlsFromProduct(p).length > 0) ?? products[0];
  if (!product) return { images: [], tokensLeft };

  const asin = typeof product.asin === 'string' ? product.asin : undefined;
  return {
    asin,
    title: typeof product.title === 'string' ? product.title : undefined,
    images: imageUrlsFromProduct(product),
    amazonUrl: asin ? `https://www.amazon.de/dp/${asin}` : undefined,
    tokensLeft,
  };
}
