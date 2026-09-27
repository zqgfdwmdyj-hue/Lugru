import { describe, expect, it } from 'vitest';
import { summarizeFulfillmentPolicy } from '@/lib/ebay/ebay/account';

describe('summarizeFulfillmentPolicy', () => {
  it('nimmt die erste Inlands-Versandart nach sortOrder', () => {
    expect(summarizeFulfillmentPolicy({
      fulfillmentPolicyId: '123', name: 'DHL Paket', handlingTime: { value: 1, unit: 'DAY' },
      shippingOptions: [
        { optionType: 'INTERNATIONAL', shippingServices: [{ shippingCost: { value: '15.00' } }] },
        { optionType: 'DOMESTIC', shippingServices: [
          { sortOrder: 2, shippingServiceCode: 'DE_DHLExpress', shippingCost: { value: '9.90' } },
          { sortOrder: 1, shippingServiceCode: 'DE_DHLPaket', shippingCost: { value: '4.99' } },
        ] },
      ],
    })).toEqual({ id: '123', name: 'DHL Paket', handlingDays: 1, service: 'DE_DHLPaket', cost: 4.99 });
  });

  it('erkennt kostenlosen Versand', () => {
    expect(summarizeFulfillmentPolicy({
      fulfillmentPolicyId: '9', name: 'Gratis',
      shippingOptions: [{ optionType: 'DOMESTIC', shippingServices: [{ freeShipping: true, shippingServiceCode: 'DE_Hermes' }] }],
    })).toMatchObject({ freeShipping: true, cost: 0 });
  });

  it('kommt ohne Versandarten aus', () => {
    expect(summarizeFulfillmentPolicy({ fulfillmentPolicyId: '1', name: 'Abholung' })).toEqual({ id: '1', name: 'Abholung' });
  });
});
