import type { CompanyContact, Condition, AttemptStatus, ListingAttempt, Settings } from '@/lib/ebay/types';

export interface ParsedSource {
  text: string;
  url?: string;
  merchant: string;
}

export interface Profit {
  salePrice: number;
  /** Im Verkaufspreis enthaltene Umsatzsteuer; fehlt ohne hinterlegten Satz. */
  vat?: number;
  purchasePrice: number;
  fee: number;
  shipping: number;
  profit: number;
  profitPercent: number;
}

export type Attempt = ListingAttempt & {
  listingUrl?: string;
  /** Geschätzte eBay-Gebühr für diesen Verkaufspreis. */
  fee?: number;
  feePercent?: number;
  /** false = für die Kategorie ist kein Satz hinterlegt. */
  feeMatched?: boolean;
  /** Angesetzte eigene Versandkosten je Verkauf. */
  shipping?: number;
  /** Hinterlegter USt-Satz; ohne ihn ist keine Brutto-Eingabe möglich. */
  vatPercentage?: number;
  profit?: Profit | null;
  source?: ParsedSource | null;
};

export interface Article {
  key: string;
  ean?: string;
  epid?: string;
  title?: string;
  imageUrl?: string;
  purchasedUnits: number;
  purchaseValue: number;
  avgPurchasePrice?: number;
  merchants: string[];
  avgProfit?: number;
  listingCount: number;
  publishedCount: number;
  lastPrice?: number;
  firstAt: string;
  lastAt: string;
}

export interface ArticleDetail {
  article: Article;
  attempts: Attempt[];
}

export type { CompanyContact, Condition, AttemptStatus };

export const CONDITION_LABELS: Record<Condition, string> = {
  NEW: 'Neu',
  NEW_OTHER: 'Neu: Sonstige',
  USED_VERY_GOOD: 'Gebraucht – sehr gut',
  USED_GOOD: 'Gebraucht – gut',
  USED_ACCEPTABLE: 'Gebraucht – akzeptabel',
};

export const STATUS_LABELS: Record<AttemptStatus, string> = {
  draft: 'Entwurf',
  no_catalog_match: 'Kein Katalogtreffer',
  no_images: 'Keine Bilder',
  published: 'Veröffentlicht',
  publish_failed: 'Fehlgeschlagen',
};

export interface SearchResult {
  ref: string;
  title: string;
  price?: string;
  currency?: string;
  imageUrl?: string;
  epid?: string;
  itemWebUrl?: string;
  condition?: string;
  /** Blattkategorie — speist die Gebührenschätzung schon in Schritt 3. */
  categoryId?: string;
}

/** Reine Ziffernfolgen gelten in der Suche als EAN (Spiegel der Server-Logik). */
export function looksLikeEan(input: string): boolean {
  return /^\d{8,14}$/.test(input.trim());
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ebay${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Serverfehler (HTTP ${res.status})`);
  return json;
}

export function formatPrice(p: number, currency = 'EUR'): string {
  // Echtes Minuszeichen statt Bindestrich — so sehen Kostenzeilen und negativer Gewinn gleich aus.
  return p.toLocaleString('de-DE', { style: 'currency', currency }).replace(/^-/, '−');
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
}

/**
 * Betrag aus deutscher Eingabe: Komma ist das Dezimalzeichen, Punkte sind
 * Tausenderpunkte („1.234,56"). Ohne Komma gilt ein einzelner Punkt mit ein
 * oder zwei Nachkommastellen als Dezimalpunkt („19.99"), sonst als
 * Tausenderpunkt — „1.200" ist 1200, nicht 1,20. Tausenderpunkte müssen
 * Dreiergruppen trennen; „1.2.3" ist ein Tippfehler und bleibt undefined,
 * genau wie leere Eingaben und Unsinn — der Aufrufer entscheidet, statt
 * still NaN zu senden.
 */
export function parseAmount(input: string): number | undefined {
  const clean = input.trim().replace(/\s/g, '').replace(/[.,]$/, '');
  if (clean === '') return undefined;
  const comma = clean.indexOf(',');
  let integer = comma === -1 ? clean : clean.slice(0, comma);
  let fraction = comma === -1 ? '' : clean.slice(comma + 1);
  if (comma === -1 && /^-?\d+\.\d{1,2}$/.test(clean)) {
    [integer, fraction] = clean.split('.');
  } else if (integer.includes('.')) {
    if (!/^-?\d{1,3}(\.\d{3})+$/.test(integer)) return undefined;
    integer = integer.replace(/\./g, '');
  }
  if (!/^-?\d+$/.test(integer) || !/^\d*$/.test(fraction)) return undefined;
  const n = Number(fraction === '' ? integer : `${integer}.${fraction}`);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Die Gebühren-Einstellungen, wie `GET /settings` sie liefert. Reicht als
 * Eingabe für resolveFeeRate/estimateFee aus dem Server-Pipeline-Modul.
 */
export type FeeSettings = Pick<
  Settings,
  | 'feePercent' | 'feeFixed' | 'feeFixedAbove' | 'feeFixedThreshold'
  | 'feeCategoryRates' | 'shippingAssumption' | 'vatPercentage'
> & { env: Settings['env'] };
