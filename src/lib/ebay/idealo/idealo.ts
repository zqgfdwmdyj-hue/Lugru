/**
 * Preisvergleich über idealo.de. idealo bietet keine öffentliche API — gelesen
 * wird, was die Webseite jedem Browser ausliefert: die Suche (bei eindeutiger
 * EAN leitet idealo direkt auf die Produktseite weiter), die schema.org-Daten
 * der Produktseite (günstigster Preis, Anzahl Angebote) und die Daten des
 * Preisverlaufs-Diagramms.
 *
 * Das ist bewusst „best effort": idealo kann Anfragen ablehnen (Bot-Schutz)
 * oder das Seitenformat ändern. Dann liefert die Funktion trotzdem die Links,
 * damit der Vergleich mit einem Klick im Browser möglich bleibt.
 */

const BASE = 'https://www.idealo.de';
const CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9',
};

export interface PricePoint {
  /** ISO-Datum (YYYY-MM-DD). */
  date: string;
  price: number;
}

export interface IdealoResult {
  /** `ok`: Daten gefunden · `not_found`: kein Produkt · `blocked`: idealo hat abgelehnt · `error`: sonstiger Fehler */
  status: 'ok' | 'not_found' | 'blocked' | 'error';
  /** Suche bei idealo — funktioniert immer im Browser. */
  searchUrl: string;
  productUrl?: string;
  productId?: string;
  name?: string;
  lowPrice?: number;
  highPrice?: number;
  offerCount?: number;
  cheapestShop?: string;
  history?: PricePoint[];
  /** `idealo`: Verlauf von idealo · `own`: eigene Aufzeichnung des Tools aus früheren Abrufen */
  historySource?: 'idealo' | 'own';
  message?: string;
  fetchedAt: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function idealoSearchUrl(query: string): string {
  return `${BASE}/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(query)}`;
}

const PRODUCT_PATH = /\/preisvergleich\/OffersOfProduct\/(\d+)_[^"'?#\s<>]*\.html/;

/** Produkt-ID und -URL aus einer idealo-URL oder dem ersten Produktlink einer Suchseite. */
export function findProductLink(urlOrHtml: string): { id: string; url: string } | null {
  const m = urlOrHtml.match(PRODUCT_PATH);
  if (!m) return null;
  return { id: m[1], url: `${BASE}${m[0]}` };
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  // „1.234,56" wie „1234.56" — idealo nutzt im JSON-LD mal das eine, mal das andere.
  const clean = v.trim().replace(/[^\d.,]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalized);
  return normalized !== '' && Number.isFinite(n) ? n : undefined;
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const graph = (parsed as { '@graph'?: unknown[] })?.['@graph'];
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (Array.isArray(graph)) out.push(...graph);
      else out.push(parsed);
    } catch {
      // Ein kaputter Block darf die übrigen nicht verhindern.
    }
  }
  return out;
}

function isType(node: unknown, type: string): node is Record<string, unknown> {
  const t = (node as { '@type'?: unknown })?.['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

/** Günstigster Preis, Preisspanne, Anzahl Angebote und — wenn angegeben — der günstigste Shop. */
export function parseProductPage(html: string): Pick<
  IdealoResult, 'name' | 'lowPrice' | 'highPrice' | 'offerCount' | 'cheapestShop'
> {
  const product = jsonLdBlocks(html).find((n) => isType(n, 'Product'));
  const out: ReturnType<typeof parseProductPage> = {};
  if (!product) return out;
  if (typeof product.name === 'string') out.name = product.name;

  const offersRaw = product.offers;
  const offerNodes = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
  const single: { price: number; shop?: string }[] = [];

  for (const node of offerNodes) {
    if (isType(node, 'AggregateOffer')) {
      out.lowPrice = toNumber(node.lowPrice) ?? out.lowPrice;
      out.highPrice = toNumber(node.highPrice) ?? out.highPrice;
      out.offerCount = toNumber(node.offerCount) ?? out.offerCount;
      const inner = node.offers;
      for (const o of Array.isArray(inner) ? inner : inner ? [inner] : []) collectOffer(o, single);
    } else {
      collectOffer(node, single);
    }
  }

  if (single.length > 0) {
    single.sort((a, b) => a.price - b.price);
    if (out.lowPrice === undefined) out.lowPrice = single[0].price;
    if (out.highPrice === undefined) out.highPrice = single[single.length - 1].price;
    if (out.offerCount === undefined) out.offerCount = single.length;
    out.cheapestShop = single.find((o) => o.shop && o.price === out.lowPrice)?.shop ?? single[0].shop;
  }
  return out;
}

function collectOffer(node: unknown, into: { price: number; shop?: string }[]): void {
  const o = node as Record<string, unknown>;
  const price = toNumber(o?.price);
  if (price === undefined) return;
  const seller = o.seller as { name?: unknown } | undefined;
  const shop = typeof seller?.name === 'string' ? seller.name : undefined;
  into.push({ price, shop });
}

/**
 * Preisverlauf aus der Diagramm-Schnittstelle. Das Format ist nicht
 * dokumentiert — akzeptiert werden `{data: [{x, y}]}` und `[[zeit, preis]]`,
 * Zeit als Millisekunden, Sekunden oder Datums-Text.
 */
export function parsePriceHistory(json: unknown): PricePoint[] {
  const list = Array.isArray(json)
    ? json
    : ((json as { data?: unknown })?.data as unknown[] | undefined) ??
      ((json as { priceHistory?: unknown })?.priceHistory as unknown[] | undefined) ??
      [];
  if (!Array.isArray(list)) return [];

  const points: PricePoint[] = [];
  for (const entry of list) {
    let rawTime: unknown;
    let rawPrice: unknown;
    if (Array.isArray(entry)) [rawTime, rawPrice] = entry;
    else if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      rawTime = e.x ?? e.date ?? e.timestamp;
      rawPrice = e.y ?? e.price ?? e.value;
    }
    const price = toNumber(rawPrice);
    const date = toIsoDate(rawTime);
    if (price !== undefined && price > 0 && date) points.push({ date, price });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  // Ein Punkt je Tag: bei mehreren gilt der niedrigste — das ist der Bestpreis dieses Tages.
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date, Math.min(p.price, byDay.get(p.date) ?? Infinity));
  return [...byDay].map(([date, price]) => ({ date, price }));
}

function toIsoDate(v: unknown): string | undefined {
  let d: Date | undefined;
  if (typeof v === 'number') d = new Date(v < 1e11 ? v * 1000 : v);
  else if (typeof v === 'string' && v.trim() !== '') d = new Date(/^\d+$/.test(v) ? Number(v) : v);
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

function isBlocked(res: Response, body: string): boolean {
  if (res.status === 403 || res.status === 429) return true;
  return /captcha|Zugriff verweigert|access denied/i.test(body) && !PRODUCT_PATH.test(body);
}

async function get(
  fetchFn: FetchLike,
  url: string,
  accept?: string,
  extra: Record<string, string> = {}
): Promise<{ res: Response; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      headers: { ...HEADERS, ...(accept ? { Accept: accept } : {}), ...extra },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return { res, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Preisverlauf wie ihn die Produktseite im Browser nachlädt: mit der
 * Produktseite als Herkunft und als XHR. Liefert der lange Zeitraum nichts,
 * wird der kürzere versucht — idealo hat den Jahreszeitraum nicht für jedes
 * Produkt.
 */
async function fetchHistory(fetchFn: FetchLike, link: { id: string; url: string }): Promise<PricePoint[]> {
  for (const period of ['P1Y', 'P6M', 'P3M']) {
    try {
      const chart = await get(fetchFn, `${BASE}/offerpage/pricechart/api/${link.id}?period=${period}`, 'application/json, text/plain, */*', {
        Referer: link.url,
        'X-Requested-With': 'XMLHttpRequest',
      });
      if (!chart.res.ok) continue;
      const points = parsePriceHistory(JSON.parse(chart.body));
      if (points.length > 0) return points;
    } catch {
      // Nächsten Zeitraum versuchen; ohne Verlauf bleibt der aktuelle Preis trotzdem nützlich.
    }
  }
  return [];
}

const cache = new Map<string, { at: number; result: IdealoResult }>();

/** Nur für Tests. */
export function clearIdealoCache(): void {
  cache.clear();
}

/**
 * Sucht das Produkt bei idealo — per EAN, sonst per Titel — und liest
 * günstigsten Preis und Preisverlauf. Ergebnisse werden 30 Minuten
 * zwischengespeichert, damit wiederholtes Öffnen der Vorschau idealo nicht
 * ständig anfragt (und so den Bot-Schutz auslöst).
 */
export async function lookupIdealo(
  query: { ean?: string; title?: string },
  fetchFn: FetchLike = fetch
): Promise<IdealoResult> {
  const q = (query.ean ?? '').trim() || (query.title ?? '').trim();
  if (q === '') throw new Error('Für den Preisvergleich fehlt EAN oder Titel.');
  const searchUrl = idealoSearchUrl(q);

  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const result = await fetchIdealo(q, searchUrl, fetchFn);
  // Ablehnungen und Fehler nicht zwischenspeichern — ein neuer Versuch kann klappen.
  if (result.status === 'ok' || result.status === 'not_found') cache.set(q, { at: Date.now(), result });
  return result;
}

async function fetchIdealo(q: string, searchUrl: string, fetchFn: FetchLike): Promise<IdealoResult> {
  const base = { searchUrl, fetchedAt: new Date().toISOString() };
  try {
    const search = await get(fetchFn, searchUrl);
    if (isBlocked(search.res, search.body)) {
      return { ...base, status: 'blocked', message: 'idealo hat die automatische Abfrage abgelehnt — über den Link im Browser öffnen.' };
    }
    if (!search.res.ok) return { ...base, status: 'error', message: `idealo antwortet mit HTTP ${search.res.status}.` };

    // Eindeutige EAN: idealo leitet direkt auf die Produktseite weiter.
    const link = findProductLink(search.res.url) ?? findProductLink(search.body);
    if (!link) return { ...base, status: 'not_found', message: `Kein Produkt zu „${q}" bei idealo gefunden.` };

    const page = findProductLink(search.res.url) ? search : await get(fetchFn, link.url);
    if (isBlocked(page.res, page.body)) {
      return {
        ...base, status: 'blocked', productUrl: link.url, productId: link.id,
        message: 'idealo hat die automatische Abfrage abgelehnt — über den Link im Browser öffnen.',
      };
    }
    const facts = page.res.ok ? parseProductPage(page.body) : {};

    const history = await fetchHistory(fetchFn, link);

    return { ...base, status: 'ok', productUrl: link.url, productId: link.id, ...facts, history };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ...base, status: 'error', message: aborted ? 'idealo antwortet nicht (Zeitüberschreitung).' : `idealo nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` };
  }
}
