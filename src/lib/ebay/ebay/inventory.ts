import type { Db } from '../db/db';
import type { Settings } from '../types';
import { getUserAccessToken } from './auth';
import { ACCEPT_LANGUAGE, apiBase, CONTENT_LANGUAGE, MARKETPLACE } from './config';
import { ebayFetch, EbayHttpError } from './http';

/** eBay: „Preisangebot-Entität existiert bereits." */
const OFFER_ALREADY_EXISTS = 25002;

/** Sucht das vorhandene Angebot zu einer SKU; null, wenn es keins gibt. */
async function findOfferBySku(db: Db, settings: Settings, sku: string): Promise<string | null> {
  const res = (await ebayFetch(
    `${apiBase(settings.env)}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
    { headers: await headers(db, settings) }
  ).catch(() => null)) as { offers?: { offerId?: string }[] } | null;
  return res?.offers?.[0]?.offerId ?? null;
}

export interface InventoryApi {
  putInventoryItem(sku: string, payload: unknown): Promise<void>;
  createOffer(payload: unknown): Promise<string>;
  updateOffer(offerId: string, payload: unknown): Promise<void>;
  publishOffer(offerId: string): Promise<string>;
}

async function headers(db: Db, settings: Settings): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getUserAccessToken(db, settings)}`,
    'Content-Type': 'application/json',
    'Content-Language': CONTENT_LANGUAGE,
    'Accept-Language': ACCEPT_LANGUAGE,
    'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    Accept: 'application/json',
  };
}

export function makeInventoryApi(db: Db, settings: Settings): InventoryApi {
  const base = () => `${apiBase(settings.env)}/sell/inventory/v1`;
  return {
    async putInventoryItem(sku, payload) {
      await ebayFetch(`${base()}/inventory_item/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        headers: await headers(db, settings),
        body: JSON.stringify(payload),
      });
    },
    async createOffer(payload) {
      try {
        const res = (await ebayFetch(`${base()}/offer`, {
          method: 'POST',
          headers: await headers(db, settings),
          body: JSON.stringify(payload),
        })) as { offerId?: string } | null;
        if (!res?.offerId) throw new Error('eBay hat keine offerId zurückgegeben.');
        return res.offerId;
      } catch (err) {
        // 25002: zur SKU gibt es schon ein Angebot. Passiert, wenn ein
        // vorheriger Versuch bei eBay ankam, die Antwort uns aber nicht
        // erreichte (Netzabbruch oder 5xx mit Retry). Dann das vorhandene
        // Angebot übernehmen, statt den Entwurf dauerhaft zu blockieren.
        const sku = (payload as { sku?: string } | null)?.sku;
        if (!(err instanceof EbayHttpError) || !err.has(OFFER_ALREADY_EXISTS) || !sku) throw err;
        const existing = await findOfferBySku(db, settings, sku);
        if (!existing) throw err;
        return existing;
      }
    },
    async updateOffer(offerId, payload) {
      await ebayFetch(`${base()}/offer/${encodeURIComponent(offerId)}`, {
        method: 'PUT',
        headers: await headers(db, settings),
        body: JSON.stringify(payload),
      });
    },
    async publishOffer(offerId) {
      const res = (await ebayFetch(`${base()}/offer/${encodeURIComponent(offerId)}/publish`, {
        method: 'POST',
        headers: await headers(db, settings),
        body: JSON.stringify({}),
      })) as { listingId?: string } | null;
      if (!res?.listingId) throw new Error('eBay hat keine listingId zurückgegeben.');
      return res.listingId;
    },
  };
}

export interface LocationAddress {
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
}

const LOCATION_NAME = 'LuGru Standardstandort';

/**
 * Legt die Inventory-Location an — oder aktualisiert ihre Adresse, wenn sie
 * schon existiert (409).
 *
 * Den 409 nur zu schlucken wäre falsch: das Tool würde die neue Anschrift lokal
 * speichern und „Gespeichert." melden, während eBay weiter die alte am Angebot
 * zeigt. Adressfelder sind bei Warehouse-Standorten beliebig oft änderbar,
 * `update_location_details` antwortet mit 204 ohne Inhalt.
 */
/**
 * „Standort gibt es schon": eBay meldet das je nach Fall als HTTP 409 oder als
 * 400 mit errorId 25803 („merchantLocationKey already exists"). Der Standort
 * gehört zum Verkäuferkonto, nicht zum Keyset — nach einem Keyset-Wechsel
 * existiert er daher oft schon.
 */
export function locationExists(err: unknown): boolean {
  if (!(err instanceof EbayHttpError)) return false;
  return err.status === 409 || err.has(25803) || /already exists/i.test(err.message);
}

export async function upsertLocation(db: Db, settings: Settings, key: string, address: LocationAddress): Promise<void> {
  const url = `${apiBase(settings.env)}/sell/inventory/v1/location/${encodeURIComponent(key)}`;
  try {
    await ebayFetch(url, {
      method: 'POST',
      headers: await headers(db, settings),
      body: JSON.stringify({
        location: { address },
        name: LOCATION_NAME,
        merchantLocationStatus: 'ENABLED',
        locationTypes: ['WAREHOUSE'],
      }),
    });
  } catch (err) {
    if (!locationExists(err)) throw err;
    await ebayFetch(`${url}/update_location_details`, {
      method: 'POST',
      headers: await headers(db, settings),
      body: JSON.stringify({ location: { address }, name: LOCATION_NAME }),
    });
  }
}
