import { describe, expect, it } from 'vitest';
import type { ListingAttempt, Settings } from '@/lib/ebay/types';
import { buildInventoryItemPayload, buildOfferPayload } from '@/lib/ebay/pipeline/payload';

const attempt: ListingAttempt = {
  id: 7,
  ean: '3165140776649',
  price: 89.9,
  quantity: 2,
  condition: 'NEW',
  status: 'draft',
  epid: 'E1',
  sku: 'LG-3165140776649-7',
  title: 'Bosch GSR 12V-15',
  description: '<h2>Bosch GSR 12V-15</h2>',
  imageUrls: ['https://i.ebayimg.com/1.jpg'],
  aspects: { Marke: ['Bosch'] },
  categoryId: '71283',
  gpsr: {
    manufacturer: { companyName: 'Bosch GmbH', addressLine1: 'Weg 1', city: 'Stuttgart', postalCode: '70000', country: 'DE', email: 'a@b.de' },
    responsiblePersons: [{ companyName: 'Bosch EU', city: 'Stuttgart', country: 'DE' }],
    sourceItemId: 'v1|1|0',
  },
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
};

const settings: Settings = {
  env: 'sandbox',
  fulfillmentPolicyId: 'F1',
  paymentPolicyId: 'P1',
  returnPolicyId: 'R1',
  merchantLocationKey: 'lugru-main',
  vatPercentage: 19,
};

describe('buildInventoryItemPayload', () => {
  it('baut Produkt, Zustand und Menge', () => {
    const p = buildInventoryItemPayload(attempt) as Record<string, any>;
    expect(p.product.title).toBe('Bosch GSR 12V-15');
    expect(p.product.ean).toEqual(['3165140776649']);
    expect(p.product.epid).toBe('E1');
    expect(p.product.imageUrls).toEqual(['https://i.ebayimg.com/1.jpg']);
    expect(p.product.aspects).toEqual({ Marke: ['Bosch'] });
    expect(p.condition).toBe('NEW');
    expect(p.availability.shipToLocationAvailability.quantity).toBe(2);
  });

  it('lässt epid weg, wenn nicht vorhanden', () => {
    const p = buildInventoryItemPayload({ ...attempt, epid: undefined }) as Record<string, any>;
    expect('epid' in p.product).toBe(false);
  });

  it('lässt imageUrls weg, wenn leer (ePID-Referenz: eBay ergänzt Katalogbilder)', () => {
    const p = buildInventoryItemPayload({ ...attempt, imageUrls: [] }) as Record<string, any>;
    expect('imageUrls' in p.product).toBe(false);
    expect(p.product.epid).toBe('E1');
  });
});

describe('buildOfferPayload', () => {
  it('nimmt ein am Angebot gewähltes Versandprofil vor dem Standard', () => {
    const o = buildOfferPayload({ ...attempt, fulfillmentPolicyId: 'F-EXPRESS' }, settings) as Record<string, any>;
    expect(o.listingPolicies.fulfillmentPolicyId).toBe('F-EXPRESS');
  });

  it('baut Offer mit Preisformat, Policies, USt und GPSR', () => {
    const o = buildOfferPayload(attempt, settings) as Record<string, any>;
    expect(o.sku).toBe('LG-3165140776649-7');
    expect(o.marketplaceId).toBe('EBAY_DE');
    expect(o.format).toBe('FIXED_PRICE');
    expect(o.availableQuantity).toBe(2);
    expect(o.categoryId).toBe('71283');
    expect(o.pricingSummary.price).toEqual({ value: '89.90', currency: 'EUR' });
    expect(o.listingPolicies).toEqual({ fulfillmentPolicyId: 'F1', paymentPolicyId: 'P1', returnPolicyId: 'R1' });
    expect(o.merchantLocationKey).toBe('lugru-main');
    expect(o.tax).toEqual({ vatPercentage: 19, applyTax: true });
    expect(o.regulatory.manufacturer.companyName).toBe('Bosch GmbH');
    expect(o.regulatory.manufacturer.sourceItemId).toBeUndefined();
    expect(o.regulatory.responsiblePersons[0].types).toEqual(['EU_RESPONSIBLE_PERSON']);
  });

  it('ohne GPSR/USt fehlen die Container', () => {
    const o = buildOfferPayload({ ...attempt, gpsr: null }, { ...settings, vatPercentage: undefined }) as Record<string, any>;
    expect('regulatory' in o).toBe(false);
    expect('tax' in o).toBe(false);
  });

  it('ohne responsiblePersons bleibt nur der Hersteller', () => {
    const o = buildOfferPayload(
      { ...attempt, gpsr: { ...attempt.gpsr!, responsiblePersons: [] } },
      settings
    ) as Record<string, any>;
    expect(o.regulatory.manufacturer).toBeTruthy();
    expect('responsiblePersons' in o.regulatory).toBe(false);
  });
});
