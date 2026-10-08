import type { Condition, Env, ListingAttempt, Settings } from '../types';

/*
 * Datenzugriff des eBay-Tools. Im bisherigen Tool eine SQLite-Datei, hier eine Schnittstelle
 * mit zwei Umsetzungen: Postgres je Mandant (db/pg.ts) und im Speicher für die Tests
 * (db/memory.ts). Die Funktionen unten haben dieselben Namen wie im bisherigen Tool,
 * sind aber asynchron.
 */

export interface StoredToken {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
}

/** Eine Zeile der Listing-Versuche, wie sie gespeichert wird (JSON-Felder als Objekte). */
export interface AttemptRow {
  id: number;
  ean: string;
  price: number;
  quantity: number;
  condition: string;
  status: string;
  epid: string | null;
  catalog_matches: unknown;
  sku: string | null;
  offer_id: string | null;
  listing_id: string | null;
  title: string | null;
  description: string | null;
  image_urls: unknown;
  aspects: unknown;
  category_id: string | null;
  gpsr: unknown;
  warnings: unknown;
  error_message: string | null;
  purchased_units: number | null;
  purchase_price: number | null;
  purchase_source: string | null;
  target_price: number | null;
  article_key: string | null;
  purchase_price_basis: string | null;
  fulfillment_policy_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: number;
  env: string;
  number: string;
  year: number;
  seq: number;
  kind: string;
  order_id: string;
  cancels_id: number | null;
  cancelled_by_id: number | null;
  data: unknown;
  created_at: string;
  emailed_at: string | null;
  email_to: string | null;
  email_error: string | null;
}

export interface Db {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getToken(env: Env, type: 'app' | 'user'): Promise<StoredToken | null>;
  saveToken(env: Env, type: 'app' | 'user', token: StoredToken): Promise<void>;

  insertAttempt(row: Omit<AttemptRow, 'id'>): Promise<number>;
  updateAttempt(id: number, columns: Partial<AttemptRow>): Promise<void>;
  getAttempt(id: number): Promise<AttemptRow | null>;
  /** Neueste zuerst. */
  listAttempts(): Promise<AttemptRow[]>;

  listInvoices(): Promise<InvoiceRow[]>;
  getInvoice(id: number): Promise<InvoiceRow | null>;
  maxInvoiceSeq(year: number): Promise<number | null>;
  insertInvoice(row: Omit<InvoiceRow, 'id'>): Promise<number>;
  updateInvoice(id: number, columns: Partial<Pick<InvoiceRow, 'cancelled_by_id' | 'emailed_at' | 'email_to' | 'email_error'>>): Promise<void>;

  recordIdealoPrice(productKey: string, day: string, price: number): Promise<void>;
  idealoHistory(productKey: string): Promise<{ day: string; price: number }[]>;

  /**
   * Führt `fn` in einer Transaktion aus. `lock` serialisiert gleichzeitige Aufrufe mit
   * demselben Schlüssel (z. B. die Vergabe der Rechnungsnummer).
   */
  transaction<T>(fn: (db: Db) => Promise<T>, lock?: string): Promise<T>;
}

// --- Settings ---

export function getSetting(db: Db, key: string): Promise<string | null> {
  return db.getSetting(key);
}

export function setSetting(db: Db, key: string, value: string): Promise<void> {
  return db.setSetting(key, value);
}

const ENV_SETTING_KEYS = [
  'clientId',
  'clientSecret',
  'ruName',
  'fulfillmentPolicyId',
  'paymentPolicyId',
  'returnPolicyId',
  'merchantLocationKey',
] as const;

/**
 * Gebühren und USt-Satz sind eine Tatsache des Geschäfts, kein
 * Environment-Detail — und die Sandbox berechnet ohnehin keine Gebühren.
 * Deshalb bewusst ohne env-Präfix; sie speisen die Gewinnrechnung.
 */
const GLOBAL_NUMBER_KEYS = [
  'vatPercentage',
  'feePercent',
  'feeFixed',
  'feeFixedAbove',
  'feeFixedThreshold',
  'shippingAssumption',
] as const;

export async function getSettings(db: Db): Promise<Settings> {
  const env = ((await getSetting(db, 'env')) as Env | null) ?? 'sandbox';
  const s: Settings = { env };
  for (const key of ENV_SETTING_KEYS) {
    const value = await getSetting(db, `${env}.${key}`);
    if (value === null || value === '') continue;
    s[key] = value;
  }
  for (const key of GLOBAL_NUMBER_KEYS) {
    const value = await getSetting(db, key);
    if (value === null || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num)) s[key] = num;
  }
  const keepa = await getSetting(db, 'keepaApiKey');
  if (keepa) s.keepaApiKey = keepa;
  const rates = await getSetting(db, 'feeCategoryRates');
  if (rates) {
    try {
      const parsed = JSON.parse(rates) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        s.feeCategoryRates = parsed as Record<string, number>;
      }
    } catch {
      // Kaputtes JSON darf die Einstellungen nicht unbrauchbar machen.
    }
  }
  return s;
}

// --- OAuth-Tokens ---

export function saveToken(db: Db, env: Env, type: 'app' | 'user', token: StoredToken): Promise<void> {
  return db.saveToken(env, type, token);
}

export function getToken(db: Db, env: Env, type: 'app' | 'user'): Promise<StoredToken | null> {
  return db.getToken(env, type);
}

// --- Listing-Versuche ---

const arr = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

export function rowToAttempt(row: AttemptRow): ListingAttempt {
  return {
    id: Number(row.id),
    ean: row.ean,
    price: Number(row.price),
    quantity: Number(row.quantity),
    condition: row.condition as ListingAttempt['condition'],
    status: row.status as ListingAttempt['status'],
    epid: row.epid ?? undefined,
    catalogMatches: arr(row.catalog_matches),
    sku: row.sku ?? undefined,
    offerId: row.offer_id ?? undefined,
    listingId: row.listing_id ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    imageUrls: arr(row.image_urls),
    aspects: arr(row.aspects),
    categoryId: row.category_id ?? undefined,
    gpsr: (row.gpsr as ListingAttempt['gpsr']) ?? null,
    warnings: arr(row.warnings),
    errorMessage: row.error_message ?? undefined,
    purchasedUnits: row.purchased_units ?? undefined,
    purchasePrice: row.purchase_price === null ? undefined : Number(row.purchase_price),
    purchaseSource: row.purchase_source ?? undefined,
    targetPrice: row.target_price === null ? undefined : Number(row.target_price),
    articleKey: row.article_key ?? undefined,
    purchasePriceBasis: row.purchase_price_basis === 'net' ? 'net' : undefined,
    fulfillmentPolicyId: row.fulfillment_policy_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createAttempt(
  db: Db,
  input: {
    ean: string;
    price: number;
    quantity: number;
    condition: Condition;
    purchasedUnits?: number;
    purchasePrice?: number;
    purchaseSource?: string;
    targetPrice?: number;
  }
): Promise<ListingAttempt> {
  const now = new Date().toISOString();
  const id = await db.insertAttempt({
    ean: input.ean,
    price: input.price,
    quantity: input.quantity,
    condition: input.condition,
    status: 'draft',
    epid: null,
    catalog_matches: null,
    sku: null,
    offer_id: null,
    listing_id: null,
    title: null,
    description: null,
    image_urls: null,
    aspects: null,
    category_id: null,
    gpsr: null,
    warnings: null,
    error_message: null,
    purchased_units: input.purchasedUnits ?? null,
    purchase_price: input.purchasePrice ?? null,
    // Alles, was der heutige Code schreibt, ist netto — siehe purchaseUnitNet.
    purchase_price_basis: input.purchasePrice === undefined ? null : 'net',
    purchase_source: input.purchaseSource ?? null,
    target_price: input.targetPrice ?? null,
    article_key: null,
    fulfillment_policy_id: null,
    created_at: now,
    updated_at: now,
  });
  return (await getAttempt(db, id))!;
}

const PATCH_COLUMNS: Record<string, keyof AttemptRow> = {
  ean: 'ean',
  price: 'price',
  quantity: 'quantity',
  condition: 'condition',
  status: 'status',
  epid: 'epid',
  catalogMatches: 'catalog_matches',
  sku: 'sku',
  offerId: 'offer_id',
  listingId: 'listing_id',
  title: 'title',
  description: 'description',
  imageUrls: 'image_urls',
  aspects: 'aspects',
  categoryId: 'category_id',
  gpsr: 'gpsr',
  warnings: 'warnings',
  errorMessage: 'error_message',
  purchasedUnits: 'purchased_units',
  purchasePrice: 'purchase_price',
  purchaseSource: 'purchase_source',
  targetPrice: 'target_price',
  articleKey: 'article_key',
  purchasePriceBasis: 'purchase_price_basis',
  fulfillmentPolicyId: 'fulfillment_policy_id',
};

export async function updateAttempt(db: Db, id: number, input: Partial<ListingAttempt>): Promise<ListingAttempt | null> {
  // Ein neu gespeicherter Einkaufspreis ist netto; ein gelöschter hat keine Basis mehr.
  // Wer die Basis ausdrücklich mitgibt (Bestätigung des Altbestands), behält sie.
  const patch: Partial<ListingAttempt> =
    'purchasePrice' in input && !('purchasePriceBasis' in input)
      ? { ...input, purchasePriceBasis: input.purchasePrice == null ? undefined : 'net' }
      : input;
  const columns: Partial<AttemptRow> = {};
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    if (!(key in patch)) continue;
    const raw = (patch as Record<string, unknown>)[key];
    (columns as Record<string, unknown>)[column] = raw === undefined ? null : raw;
  }
  columns.updated_at = new Date().toISOString();
  await db.updateAttempt(id, columns);
  return getAttempt(db, id);
}

export async function getAttempt(db: Db, id: number): Promise<ListingAttempt | null> {
  if (!Number.isInteger(id)) return null;
  const row = await db.getAttempt(id);
  return row ? rowToAttempt(row) : null;
}

export async function listAttempts(db: Db): Promise<ListingAttempt[]> {
  return (await db.listAttempts()).map(rowToAttempt);
}

/** Versuche mit Einkaufspreis aus der Zeit vor der Netto-Umstellung — noch ohne bestätigte Basis. */
export async function listUnconfirmedPurchases(db: Db): Promise<ListingAttempt[]> {
  return (await listAttempts(db))
    .filter((a) => a.purchasePrice !== undefined && a.purchasePriceBasis === undefined)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
