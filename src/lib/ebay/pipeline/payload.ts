import type { CompanyContact, ListingAttempt, Settings } from '../types';

/** Payload für PUT /sell/inventory/v1/inventory_item/{sku} */
export function buildInventoryItemPayload(a: ListingAttempt): unknown {
  const product: Record<string, unknown> = {
    title: a.title,
    description: a.description,
    aspects: a.aspects ?? {},
  };
  // Ohne EAN-Suche (Treffer per Produkttitel gewählt) bleibt das Feld leer — dann weglassen.
  if (a.ean) product.ean = [a.ean];
  // Ohne eigene Bilder das Feld weglassen — bei ePID-Referenz ergänzt eBay die Katalogbilder.
  if ((a.imageUrls ?? []).length > 0) product.imageUrls = a.imageUrls;
  if (a.epid) product.epid = a.epid;

  return {
    product,
    condition: a.condition,
    availability: { shipToLocationAvailability: { quantity: a.quantity } },
  };
}

function stripEmpty(contact: CompanyContact): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(contact)) {
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

/** Payload für POST /sell/inventory/v1/offer bzw. PUT …/offer/{offerId} */
export function buildOfferPayload(a: ListingAttempt, s: Settings): unknown {
  const offer: Record<string, unknown> = {
    sku: a.sku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity: a.quantity,
    categoryId: a.categoryId,
    listingDescription: a.description,
    pricingSummary: { price: { value: a.price.toFixed(2), currency: 'EUR' } },
    listingPolicies: {
      // Ein am Angebot gewähltes Versandprofil geht vor dem Standard aus den Einstellungen.
      fulfillmentPolicyId: a.fulfillmentPolicyId ?? s.fulfillmentPolicyId,
      paymentPolicyId: s.paymentPolicyId,
      returnPolicyId: s.returnPolicyId,
    },
    merchantLocationKey: s.merchantLocationKey,
  };

  if (s.vatPercentage !== undefined) {
    offer.tax = { vatPercentage: s.vatPercentage, applyTax: true };
  }

  if (a.gpsr) {
    const regulatory: Record<string, unknown> = { manufacturer: stripEmpty(a.gpsr.manufacturer) };
    if (a.gpsr.responsiblePersons.length > 0) {
      regulatory.responsiblePersons = a.gpsr.responsiblePersons.map((p) => ({
        ...stripEmpty(p),
        types: ['EU_RESPONSIBLE_PERSON'],
      }));
    }
    offer.regulatory = regulatory;
  }

  return offer;
}
