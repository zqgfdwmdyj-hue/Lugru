import type { Db } from '../db/db';
import { setSetting } from '../db/db';
import { upsertLocation, type LocationAddress } from '../ebay/inventory';
import type { Settings } from '../types';

/** Schlüssel des einen Standorts, den das Tool bei eBay führt. */
export const LOCATION_KEY = 'lugru-main';

export interface LocationInput {
  addressLine1: string;
  city: string;
  postalCode: string;
}

/**
 * Legt den Artikelstandort bei eBay an und merkt die Adresse lokal.
 * Weboberfläche und Setup-CLI rufen beide hier hinein, damit beide Wege
 * denselben Standortschlüssel schreiben.
 */
export async function saveLocation(db: Db, settings: Settings, input: LocationInput): Promise<void> {
  const address: LocationAddress = {
    addressLine1: input.addressLine1,
    city: input.city,
    postalCode: input.postalCode,
    country: 'DE',
  };
  await upsertLocation(db, settings, LOCATION_KEY, address);

  const env = settings.env;
  await setSetting(db, `${env}.merchantLocationKey`, LOCATION_KEY);
  await setSetting(db, `${env}.locAddressLine1`, input.addressLine1);
  await setSetting(db, `${env}.locCity`, input.city);
  await setSetting(db, `${env}.locPostalCode`, input.postalCode);
}
