import type { CompanyContact, Gpsr } from '../types';

const CONTACT_FIELDS: (keyof CompanyContact)[] = [
  'companyName',
  'addressLine1',
  'addressLine2',
  'city',
  'postalCode',
  'country',
  'email',
  'phone',
  'contactUrl',
];

function mapContact(raw: unknown): CompanyContact | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const contact: CompanyContact = {};
  for (const field of CONTACT_FIELDS) {
    const value = src[field];
    if (typeof value === 'string' && value.trim() !== '') contact[field] = value.trim();
  }
  return Object.keys(contact).length > 0 ? contact : null;
}

/**
 * Extrahiert GPSR-Angaben (Hersteller + EU-verantwortliche Personen) aus einem
 * Browse-API-Item. Die Felder liegen je nach API-Version top-level oder unter
 * `regulatory`. Ein Hersteller zählt nur mit Name + mindestens einem Adressteil.
 */
export function extractGpsr(item: unknown): Gpsr | null {
  if (typeof item !== 'object' || item === null) return null;
  const src = item as Record<string, unknown>;
  const regulatory = (src.regulatory ?? {}) as Record<string, unknown>;

  const manufacturer = mapContact(src.manufacturer ?? regulatory.manufacturer);
  if (!manufacturer) return null;
  if (!manufacturer.companyName || !(manufacturer.addressLine1 || manufacturer.city)) return null;

  const rawPersons = (src.responsiblePersons ?? regulatory.responsiblePersons ?? []) as unknown[];
  const responsiblePersons = Array.isArray(rawPersons)
    ? rawPersons.map(mapContact).filter((c): c is CompanyContact => c !== null)
    : [];

  return {
    manufacturer,
    responsiblePersons,
    sourceItemId: typeof src.itemId === 'string' ? src.itemId : '',
  };
}
