import { describe, it, expect } from 'vitest';
import {
  getSetting,
  setSetting,
  getSettings,
  saveToken,
  getToken,
  createAttempt,
  updateAttempt,
  getAttempt,
  listAttempts,
  listUnconfirmedPurchases,
} from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';

describe('settings', () => {
  it('roundtrip: set, get, overwrite', async () => {
    const db = openMemoryDb();
    expect(await getSetting(db, 'foo')).toBeNull();
    await setSetting(db, 'foo', 'bar');
    expect(await getSetting(db, 'foo')).toBe('bar');
    await setSetting(db, 'foo', 'baz');
    expect(await getSetting(db, 'foo')).toBe('baz');
  });

  it('getSettings resolves env-prefixed keys, default env sandbox', async () => {
    const db = openMemoryDb();
    expect((await getSettings(db)).env).toBe('sandbox');

    await setSetting(db, 'sandbox.clientId', 'sb-id');
    await setSetting(db, 'sandbox.fulfillmentPolicyId', 'F1');

    const s = await getSettings(db);
    expect(s.clientId).toBe('sb-id');
    expect(s.fulfillmentPolicyId).toBe('F1');
    expect(s.clientSecret).toBeUndefined();

    await setSetting(db, 'env', 'production');
    const p = await getSettings(db);
    expect(p.env).toBe('production');
    expect(p.clientId).toBeUndefined();
  });
});

describe('oauth tokens', () => {
  it('save and get per env and type, overwrite works', async () => {
    const db = openMemoryDb();
    expect(await getToken(db, 'sandbox', 'app')).toBeNull();

    await saveToken(db, 'sandbox', 'app', {
      accessToken: 'a1',
      accessExpiresAt: '2026-08-30T12:00:00.000Z',
    });
    expect((await getToken(db, 'sandbox', 'app'))?.accessToken).toBe('a1');
    expect(await getToken(db, 'sandbox', 'user')).toBeNull();
    expect(await getToken(db, 'production', 'app')).toBeNull();

    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'u1',
      accessExpiresAt: '2026-08-30T12:00:00.000Z',
      refreshToken: 'r1',
      refreshExpiresAt: '2028-02-01T00:00:00.000Z',
    });
    const u = await getToken(db, 'sandbox', 'user');
    expect(u?.refreshToken).toBe('r1');

    await saveToken(db, 'sandbox', 'app', {
      accessToken: 'a2',
      accessExpiresAt: '2026-08-30T14:00:00.000Z',
    });
    expect((await getToken(db, 'sandbox', 'app'))?.accessToken).toBe('a2');
  });
});

describe('listing attempts', () => {
  it('create → update → get roundtrip with JSON fields', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, { ean: '4006381333931', price: 19.99, quantity: 1, condition: 'NEW' });
    expect(a.id).toBeGreaterThan(0);
    expect(a.status).toBe('draft');
    expect(a.ean).toBe('4006381333931');

    const gpsr = {
      manufacturer: { companyName: 'ACME GmbH', addressLine1: 'Weg 1', city: 'Berlin', postalCode: '10115', country: 'DE', email: 'info@acme.de' },
      responsiblePersons: [{ companyName: 'ACME EU', city: 'Wien' }],
      sourceItemId: 'v1|123|0',
    };
    await updateAttempt(db, a.id, {
      status: 'draft',
      title: 'Testartikel',
      imageUrls: ['https://i.ebayimg.com/1.jpg'],
      aspects: { Marke: ['ACME'] },
      gpsr,
      warnings: ['w1'],
      catalogMatches: [{ ref: 'v1|9|0', epid: 'E1', title: 'Testartikel' }],
    });

    const got = await getAttempt(db, a.id);
    expect(got?.title).toBe('Testartikel');
    expect(got?.imageUrls).toEqual(['https://i.ebayimg.com/1.jpg']);
    expect(got?.aspects).toEqual({ Marke: ['ACME'] });
    expect(got?.gpsr).toEqual(gpsr);
    expect(got?.warnings).toEqual(['w1']);
    expect(got?.catalogMatches?.[0].epid).toBe('E1');
  });

  it('update of price and errorMessage, unknown id returns null', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, { ean: '1', price: 5, quantity: 2, condition: 'USED_GOOD' });
    await updateAttempt(db, a.id, { price: 7.5, status: 'publish_failed', errorMessage: 'Kaputt' });
    const got = await getAttempt(db, a.id);
    expect(got?.price).toBe(7.5);
    expect(got?.status).toBe('publish_failed');
    expect(got?.errorMessage).toBe('Kaputt');
    expect(await getAttempt(db, 99999)).toBeNull();
  });

  it('listAttempts returns newest first', async () => {
    const db = openMemoryDb();
    const a1 = await createAttempt(db, { ean: '111', price: 1, quantity: 1, condition: 'NEW' });
    const a2 = await createAttempt(db, { ean: '222', price: 2, quantity: 1, condition: 'NEW' });
    const list = await listAttempts(db);
    expect(list.map((x) => x.id)).toEqual([a2.id, a1.id]);
  });
});

describe('Einkaufsdaten', () => {
  it('speichert und liest die Einkaufsfelder', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, {
      ean: '4006381333931',
      price: 25,
      quantity: 3,
      condition: 'NEW',
      purchasedUnits: 10,
      purchasePrice: 8.5,
      purchaseSource: 'https://metro.de/x',
      targetPrice: 25,
    });
    expect(a.purchasedUnits).toBe(10);
    expect(a.purchasePrice).toBe(8.5);
    expect(a.purchaseSource).toBe('https://metro.de/x');
    expect(a.targetPrice).toBe(25);

    const reloaded = (await getAttempt(db, a.id))!;
    expect(reloaded.purchasedUnits).toBe(10);
  });

  it('lässt die Einkaufsfelder weg, wenn nichts angegeben wurde', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, { ean: '123', price: 5, quantity: 1, condition: 'NEW' });
    expect(a.purchasedUnits).toBeUndefined();
    expect(a.purchasePrice).toBeUndefined();
    expect(a.purchaseSource).toBeUndefined();
    expect(a.targetPrice).toBeUndefined();
    expect(a.articleKey).toBeUndefined();
  });

  it('patcht Einkaufsfelder und articleKey', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, { ean: '123', price: 5, quantity: 1, condition: 'NEW' });
    const patched = (await updateAttempt(db, a.id, {
      purchasedUnits: 4,
      purchasePrice: 2.25,
      articleKey: 'ean:123',
    }))!;
    expect(patched.purchasedUnits).toBe(4);
    expect(patched.purchasePrice).toBe(2.25);
    expect(patched.articleKey).toBe('ean:123');
  });
});

describe('Basis des Einkaufspreises', () => {
  it('markiert jeden neu gespeicherten Einkaufspreis als netto', async () => {
    const db = openMemoryDb();
    const a = await createAttempt(db, { ean: '1', price: 25, quantity: 1, condition: 'NEW', purchasePrice: 8 });
    expect(a.purchasePriceBasis).toBe('net');
    const b = await createAttempt(db, { ean: '2', price: 25, quantity: 1, condition: 'NEW' });
    expect(b.purchasePriceBasis).toBeUndefined();
    expect((await updateAttempt(db, b.id, { purchasePrice: 9 }))!.purchasePriceBasis).toBe('net');
    // Gelöschter Preis → keine Basis mehr.
    expect((await updateAttempt(db, b.id, { purchasePrice: undefined }))!.purchasePriceBasis).toBeUndefined();
  });

  it('listet den Altbestand ohne Basis und lässt ihn nach der Bestätigung verschwinden', async () => {
    const db = openMemoryDb();
    const legacy = await createAttempt(db, { ean: '1', price: 25, quantity: 1, condition: 'NEW', purchasePrice: 12.05 });
    // So sieht eine Zeile aus der Zeit vor der Umstellung aus: Preis da, Basis leer.
    await db.updateAttempt(legacy.id, { purchase_price_basis: null });
    await createAttempt(db, { ean: '2', price: 25, quantity: 1, condition: 'NEW', purchasePrice: 5 });
    await createAttempt(db, { ean: '3', price: 25, quantity: 1, condition: 'NEW' });

    expect((await listUnconfirmedPurchases(db)).map((a) => a.id)).toEqual([legacy.id]);
    expect((await getAttempt(db, legacy.id))!.purchasePriceBasis).toBeUndefined();

    // Eine ausdrückliche Basis überschreibt die Automatik — der Preis bleibt.
    const confirmed = (await updateAttempt(db, legacy.id, { purchasePriceBasis: 'net' }))!;
    expect(confirmed.purchasePrice).toBe(12.05);
    expect(confirmed.purchasePriceBasis).toBe('net');
    expect(await listUnconfirmedPurchases(db)).toEqual([]);
  });
});

describe('USt-Satz', () => {
  it('gilt global — ein Umschalten der Umgebung ändert die Gewinnrechnung nicht', async () => {
    const db = openMemoryDb();
    await setSetting(db, 'vatPercentage', '19');
    expect((await getSettings(db)).vatPercentage).toBe(19);
    await setSetting(db, 'env', 'production');
    expect((await getSettings(db)).vatPercentage).toBe(19);
  });

  it('ignoriert Unsinn statt NaN zu liefern', async () => {
    const db = openMemoryDb();
    await setSetting(db, 'vatPercentage', 'abc');
    expect((await getSettings(db)).vatPercentage).toBeUndefined();
  });

});

describe('Gebühreneinstellungen', () => {
  it('liest Gebühren ohne env-Präfix und unabhängig vom Environment', async () => {
    const db = openMemoryDb();
    await setSetting(db, 'feePercent', '11');
    await setSetting(db, 'feeFixed', '0.35');
    await setSetting(db, 'shippingAssumption', '4.5');
    await setSetting(db, 'feeCategoryRates', '{"15032":9}');

    const sandbox = await getSettings(db);
    expect(sandbox.feePercent).toBe(11);
    expect(sandbox.feeFixed).toBe(0.35);
    expect(sandbox.shippingAssumption).toBe(4.5);
    expect(sandbox.feeCategoryRates).toEqual({ '15032': 9 });

    await setSetting(db, 'env', 'production');
    expect((await getSettings(db)).feePercent).toBe(11);
  });

  it('lässt Gebührenfelder weg, wenn nichts gesetzt ist', async () => {
    const s = await getSettings(openMemoryDb());
    expect(s.feePercent).toBeUndefined();
    expect(s.feeCategoryRates).toBeUndefined();
  });

  it('ignoriert kaputtes JSON in feeCategoryRates', async () => {
    const db = openMemoryDb();
    await setSetting(db, 'feeCategoryRates', 'nicht json');
    expect((await getSettings(db)).feeCategoryRates).toBeUndefined();
  });
});
