import { describe, it, expect } from 'vitest';
import { extractGpsr } from '@/lib/ebay/pipeline/gpsr';
import browseItem from './fixtures/browse-item.json';

describe('extractGpsr', () => {
  it('extrahiert Hersteller + verantwortliche Person aus einem Browse-Item', () => {
    const gpsr = extractGpsr(browseItem);
    expect(gpsr).not.toBeNull();
    expect(gpsr?.manufacturer.companyName).toBe('Robert Bosch Power Tools GmbH');
    expect(gpsr?.manufacturer.city).toBe('Leinfelden-Echterdingen');
    expect(gpsr?.manufacturer.email).toBe('service.werkzeuge@bosch.de');
    expect(gpsr?.responsiblePersons).toHaveLength(1);
    expect(gpsr?.responsiblePersons[0].country).toBe('DE');
    expect(gpsr?.sourceItemId).toBe('v1|110588014268|0');
  });

  it('liest die Felder auch unter item.regulatory', () => {
    const item = {
      itemId: 'v1|42|0',
      regulatory: {
        manufacturer: { companyName: 'ACME GmbH', addressLine1: 'Weg 1', city: 'Berlin' },
        responsiblePersons: [{ companyName: 'ACME EU', city: 'Wien' }],
      },
    };
    const gpsr = extractGpsr(item);
    expect(gpsr?.manufacturer.companyName).toBe('ACME GmbH');
    expect(gpsr?.responsiblePersons[0].companyName).toBe('ACME EU');
    expect(gpsr?.sourceItemId).toBe('v1|42|0');
  });

  it('gibt null zurück, wenn kein Hersteller vorhanden ist', () => {
    expect(extractGpsr({ itemId: 'v1|1|0', title: 'x' })).toBeNull();
  });

  it('gibt null zurück, wenn der Hersteller keine Adresse hat', () => {
    const item = { itemId: 'v1|2|0', manufacturer: { companyName: 'Nur Name GmbH' } };
    expect(extractGpsr(item)).toBeNull();
  });

  it('gibt null zurück, wenn der Hersteller keinen Namen hat', () => {
    const item = { itemId: 'v1|3|0', manufacturer: { addressLine1: 'Weg 1', city: 'Berlin' } };
    expect(extractGpsr(item)).toBeNull();
  });

  it('fehlende responsiblePersons ergeben ein leeres Array', () => {
    const item = {
      itemId: 'v1|4|0',
      manufacturer: { companyName: 'ACME GmbH', city: 'Berlin' },
    };
    const gpsr = extractGpsr(item);
    expect(gpsr?.responsiblePersons).toEqual([]);
  });

  it('unbekannte Felder werden nicht übernommen', () => {
    const gpsr = extractGpsr(browseItem);
    expect(Object.keys(gpsr!.manufacturer).every((k) =>
      ['companyName', 'addressLine1', 'addressLine2', 'city', 'postalCode', 'country', 'email', 'phone', 'contactUrl'].includes(k)
    )).toBe(true);
  });
});
