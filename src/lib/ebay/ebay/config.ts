import type { Env } from '../types';

export const MARKETPLACE = 'EBAY_DE';
export const CONTENT_LANGUAGE = 'de-DE';

/**
 * Muss bei jedem eBay-Call mitgeschickt werden: fehlt der Header, setzt
 * Node/undici von sich aus `accept-language: *` — und eBays Inventory API
 * lehnt das mit HTTP 400 (errorId 25709, „Ungültiger Wert für header
 * Accept-Language") ab.
 */
export const ACCEPT_LANGUAGE = 'de-DE';

export const SCOPES_APP = ['https://api.ebay.com/oauth/api_scope'];
/**
 * Scopes der Verbindungen von vor der Rechnungsstellung. Deren Refresh-Token
 * deckt das Lesen von Bestellungen nicht ab — eBay lehnt einen Refresh mit
 * mehr Scopes als zugestimmt ab. Siehe refreshUserToken.
 */
export const SCOPES_USER_LEGACY = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
];
/** Verbindungen des bisherigen Tools: Bestellungen nur lesen (Rechnungen). */
export const SCOPES_USER_READONLY = [
  ...SCOPES_USER_LEGACY,
  // Bestellungen lesen — für die Rechnungsstellung.
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
];
/**
 * Seller-System: Bestellungen lesen und bearbeiten — für Rechnungen, den Bestellabruf in
 * „Aufträge" und das Zurückmelden der Sendungsnummer.
 */
export const SCOPES_USER = [...SCOPES_USER_LEGACY, 'https://api.ebay.com/oauth/api_scope/sell.fulfillment'];
/**
 * Verkehrsdaten der Angebote (Einblendungen, Aufrufe, Käufe) für „Angebote prüfen". Nur lesend und
 * optional: ältere Verbindungen ohne diese Zustimmung laufen weiter, nur ohne Verkehrsdaten.
 */
export const SCOPE_ANALYTICS = 'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly';
/**
 * Neue eBay-Listing-API (GraphQL, ersetzt Trading GetItem/GetMyeBaySelling/ReviseFixedPriceItem/
 * ReviseInventoryStatus). Optional wie die Verkehrsdaten: ältere Verbindungen ohne diese Zustimmung laufen
 * über die Trading API weiter, bis einmal neu verbunden wird.
 */
export const SCOPE_LISTING = 'https://api.ebay.com/oauth/api_scope/sell.listing';

/** eBay GraphQL (Listing API). Tests leiten über EBAY_GRAPHQL_URL auf einen Mock um. */
export function graphqlUrl(env: Env): string {
  if (process.env.EBAY_GRAPHQL_URL) return process.env.EBAY_GRAPHQL_URL;
  return env === 'production' ? 'https://graphqlapi.ebay.com/graphql' : 'https://graphqlapi.sandbox.ebay.com/graphql';
}

/** Media API (Bilder zu eBay hochladen). In der Sandbox nicht verfügbar – dort bleibt der alte Weg. */
export function mediaBase(env: Env): string | null {
  if (process.env.EBAY_MEDIA_URL) return process.env.EBAY_MEDIA_URL;
  return env === 'production' ? 'https://apim.ebay.com/commerce/media/v1_beta' : null;
}

export function apiBase(env: Env): string {
  // Nur für Tests: eBay-Aufrufe auf einen Mock umleiten. In Betrieb nicht gesetzt.
  if (process.env.EBAY_API_BASE_URL) return process.env.EBAY_API_BASE_URL;
  return env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
}

export function consentBase(env: Env): string {
  return env === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
}

export function listingUrl(env: Env, listingId: string): string {
  const host = env === 'production' ? 'www.ebay.de' : 'sandbox.ebay.de';
  return `https://${host}/itm/${listingId}`;
}
