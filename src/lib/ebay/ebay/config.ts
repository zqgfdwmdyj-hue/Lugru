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

export function apiBase(env: Env): string {
  return env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
}

export function consentBase(env: Env): string {
  return env === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
}

export function listingUrl(env: Env, listingId: string): string {
  const host = env === 'production' ? 'www.ebay.de' : 'sandbox.ebay.de';
  return `https://${host}/itm/${listingId}`;
}
