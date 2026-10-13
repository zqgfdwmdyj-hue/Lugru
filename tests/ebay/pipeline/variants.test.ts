import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAttempt, getAttempt, updateAttempt, type Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import type { InventoryApi } from '@/lib/ebay/ebay/inventory';
import { publishAttempt } from '@/lib/ebay/pipeline/publish';
import {
  buildGroupPayload, buildVariantItemPayload, buildVariantOfferPayload, normalizeVariants, suggestVariantValue,
  variantListings, variantTitle, variantTotals, variationAspectCheck, variationProblems,
} from '@/lib/ebay/pipeline/variants';
import type { ListingAttempt, Settings } from '@/lib/ebay/types';

// Mehrfachangebote (Varianten). Fiktive Produkte und Preise.

const settings: Settings = { env: 'sandbox', fulfillmentPolicyId: 'F1', paymentPolicyId: 'P1', returnPolicyId: 'R1', merchantLocationKey: 'lugru-main', vatPercentage: 19 };

const base = { id: 7, variants: undefined } as Pick<ListingAttempt, 'id' | 'variants'>;
const items = [
  { value: 'Kirsche', ean: '4000000000017', price: 2.49, quantity: 10, imageUrl: 'https://img.example/kirsche.jpg', purchasePrice: 0.9 },
  { value: 'Blaue Himbeere', price: '2,99'.replace(',', '.'), quantity: 0 },
];

describe('Varianten prüfen und SKUs vergeben', () => {
  it('säubert und vergibt laufende SKUs', () => {
    const v = normalizeVariants({ name: ' Sorte ', items }, base)!;
    expect(v.name).toBe('Sorte');
    expect(v.items).toEqual([
      { value: 'Kirsche', sku: 'LG-7-V1', ean: '4000000000017', price: 2.49, quantity: 10, imageUrl: 'https://img.example/kirsche.jpg', purchasePrice: 0.9 },
      { value: 'Blaue Himbeere', sku: 'LG-7-V2', price: 2.99, quantity: 0 },
    ]);
  });
  it('behält SKU und Offer vorhandener Varianten, vergibt entfernte SKUs nicht neu', () => {
    const prev = { id: 7, variants: { name: 'Sorte', items: [
      { value: 'Kirsche', sku: 'LG-7-V1', price: 2.49, quantity: 1, offerId: 'O-1' },
      { value: 'Apfel', sku: 'LG-7-V2', price: 2.49, quantity: 1, offerId: 'O-2' },
    ] } };
    const v = normalizeVariants({ name: 'Sorte', items: [{ sku: 'LG-7-V1', value: 'Kirsche', price: 3, quantity: 2 }, { value: 'Cola', price: 3, quantity: 1 }] }, prev)!;
    expect(v.items.map((i) => [i.sku, i.offerId])).toEqual([['LG-7-V1', 'O-1'], ['LG-7-V3', undefined]]);
  });
  it('lehnt Ungültiges mit klarer Meldung ab', () => {
    expect(() => normalizeVariants({ name: '', items }, base)).toThrow(/Variantenmerkmal/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [] }, base)).toThrow(/Mindestens eine Variante/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [{ value: '', price: 1, quantity: 1 }] }, base)).toThrow(/Variante 1: bitte einen Wert/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [{ value: 'Kirsche', price: 1 }, { value: 'kirsche', price: 1 }] }, base)).toThrow(/doppelt/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [{ value: 'Kirsche', price: 0 }] }, base)).toThrow(/Kirsche: bitte einen gültigen Preis/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [{ value: 'Kirsche', price: 1, quantity: 1.5 }] }, base)).toThrow(/ganze Zahl/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [{ value: 'Kirsche', price: 1, ean: '12ab' }] }, base)).toThrow(/EAN/);
    expect(() => normalizeVariants({ name: 'Sorte', items: [{ value: 'Kirsche', price: 1, imageUrl: 'ftp://x' }] }, base)).toThrow(/Bild-Link/);
    expect(normalizeVariants(null, base)).toBeUndefined();
  });
  it('Gesamtpreis = günstigste Variante, Menge = Summe; fürs Veröffentlichen ≥ 2 Varianten mit Menge', () => {
    const v = normalizeVariants({ name: 'Sorte', items }, base)!;
    expect(variantTotals(v)).toEqual({ price: 2.49, quantity: 10 });
    expect(variationProblems({ variants: { name: 'Sorte', items: [v.items[0]] } } as ListingAttempt)).toEqual(['Ein Angebot mit Varianten braucht mindestens 2 Varianten.']);
    expect(variationProblems({ variants: { name: 'Sorte', items: v.items.map((i) => ({ ...i, quantity: 0 })) } } as ListingAttempt)).toEqual(['Mindestens eine Variante braucht eine Menge über 0.']);
  });
});

const attempt = (): ListingAttempt => ({
  id: 7, ean: '', price: 2.49, quantity: 10, condition: 'NEW', status: 'draft', createdAt: '', updatedAt: '',
  sku: 'LG-7-G', title: 'Testbonbons Kaubonbons 15 g', description: '<p>Lecker</p>', categoryId: '123',
  imageUrls: ['https://eps/a.jpg', 'https://eps/b.jpg'],
  aspects: { Marke: ['Testbonbons'], Sorte: ['Kirsche'], Produktart: ['Kaubonbon'] },
  variants: normalizeVariants({ name: 'Sorte', items }, base),
});

describe('eBay-Payloads für Mehrfachangebote', () => {
  it('Gruppe: gemeinsame Merkmale ohne Variantenmerkmal, Werte und Bild je Sorte', () => {
    expect(buildGroupPayload(attempt(), ['https://eps/a.jpg'])).toEqual({
      title: 'Testbonbons Kaubonbons 15 g',
      description: '<p>Lecker</p>',
      imageUrls: ['https://eps/a.jpg'],
      aspects: { Marke: ['Testbonbons'], Produktart: ['Kaubonbon'] },
      variantSKUs: ['LG-7-V1', 'LG-7-V2'],
      variesBy: { aspectsImageVariesBy: ['Sorte'], specifications: [{ name: 'Sorte', values: ['Kirsche', 'Blaue Himbeere'] }] },
    });
  });
  it('Variante: eigenes Merkmal, EAN, Bild (sonst die gemeinsamen) und Menge', () => {
    const a = attempt();
    expect(buildVariantItemPayload(a, a.variants!.items[0], ['https://eps/a.jpg'])).toMatchObject({
      product: { aspects: { Marke: ['Testbonbons'], Produktart: ['Kaubonbon'], Sorte: ['Kirsche'] }, ean: ['4000000000017'], imageUrls: ['https://img.example/kirsche.jpg'] },
      availability: { shipToLocationAvailability: { quantity: 10 } },
    });
    const second = buildVariantItemPayload(a, a.variants!.items[1], ['https://eps/a.jpg']) as { product: Record<string, unknown> };
    expect(second.product.imageUrls).toEqual(['https://eps/a.jpg']);
    expect(second.product.ean).toBeUndefined();
  });
  it('Offer je Variante: eigener Preis, eigene Menge, keine eigene Beschreibung', () => {
    const a = attempt();
    const o = buildVariantOfferPayload(a, a.variants!.items[1], settings) as Record<string, unknown>;
    expect(o).toMatchObject({ sku: 'LG-7-V2', availableQuantity: 0, pricingSummary: { price: { value: '2.99', currency: 'EUR' } }, categoryId: '123', tax: { vatPercentage: 19 } });
    expect(o.listingDescription).toBeUndefined();
  });
  it('Merkmalsprüfung: Variantenmerkmal zählt als ausgefüllt, jeder Wert wird geprüft', () => {
    const defs = [
      { name: 'Marke', required: true, recommended: false, selectionOnly: false, multi: false, values: [] },
      { name: 'Sorte', required: true, recommended: false, selectionOnly: true, multi: false, values: ['Kirsche', 'Apfel'] },
    ];
    const check = variationAspectCheck(defs, attempt());
    expect(check.missing).toEqual([]);
    expect(check.problems).toEqual(['Sorte: „Blaue Himbeere" steht nicht in der eBay-Liste.']);
  });
});

describe('Wawi und Vorschläge', () => {
  it('je Variante ein eigenes Angebot mit eigener SKU, EAN, Menge und EK', () => {
    const list = variantListings(attempt());
    expect(list.map((l) => [l.sku, l.ean, l.quantity, l.price, l.purchasePrice, l.title])).toEqual([
      ['LG-7-V1', '4000000000017', 10, 2.49, 0.9, 'Testbonbons Kaubonbons 15 g – Kirsche'],
      ['LG-7-V2', '', 0, 2.99, undefined, 'Testbonbons Kaubonbons 15 g – Blaue Himbeere'],
    ]);
    expect(list[0].variants).toBeUndefined();
    expect(variantTitle('x'.repeat(80), 'Kirsche')).toHaveLength(80);
  });
  it('Variantenwert aus dem Titel eines Suchtreffers', () => {
    expect(suggestVariantValue('Airheads Kaubonbons Kirsche 15,6 g', 'Airheads Kaubonbons Blaue Himbeere 15,6 g')).toBe('Blaue Himbeere');
    expect(suggestVariantValue('Testbonbons Rope Cherry (24 x 22.9g)', 'Testbonbons Rope Grape (24 x 22.9g)')).toBe('Grape');
  });
});

// --- Veröffentlichen ---

function mockInv(overrides: Partial<InventoryApi> = {}): InventoryApi {
  let n = 0;
  return {
    putInventoryItem: vi.fn(async () => {}),
    createOffer: vi.fn(async () => `OFFER-${++n}`),
    updateOffer: vi.fn(async () => {}),
    publishOffer: vi.fn(async () => 'LISTING-SINGLE'),
    putInventoryItemGroup: vi.fn(async () => {}),
    publishOfferByGroup: vi.fn(async () => 'LISTING-GROUP'),
    ...overrides,
  };
}
const uploads: string[] = [];
const upload = async (name: string) => {
  uploads.push(name);
  return `https://eps.ebay.com/${name}`;
};

async function variationDraft(db: Db) {
  const a = await createAttempt(db, { ean: '', price: 2.49, quantity: 1, condition: 'NEW' });
  return (await updateAttempt(db, a.id, {
    title: 'Testbonbons', description: 'D', categoryId: '123', aspects: { Marke: ['Testbonbons'] },
    imageUrls: ['https://img.example/gruppe.jpg'],
    variants: normalizeVariants({ name: 'Sorte', items: [
      { value: 'Kirsche', price: 2.49, quantity: 5, imageUrl: 'https://img.example/gruppe.jpg' },
      { value: 'Apfel', price: 2.99, quantity: 3, imageUrl: 'https://img.example/apfel.jpg' },
    ] }, { id: a.id }),
  }))!;
}

describe('publishAttempt mit Varianten', () => {
  beforeEach(async () => {
    uploads.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } })));
  });
  afterEach(async () => vi.unstubAllGlobals());

  it('Items → Gruppe → Offers → Gruppe veröffentlichen; jedes Bild nur einmal kopiert', async () => {
    const db = openMemoryDb();
    const a = await variationDraft(db);
    const inv = mockInv();
    const r = await publishAttempt(db, inv, settings, a.id, upload);

    expect(r.status).toBe('published');
    expect(r.listingId).toBe('LISTING-GROUP');
    expect(r.sku).toBe(`LG-${a.id}-G`);
    expect(uploads).toEqual(['gruppe.jpg', 'apfel.jpg']);
    expect(vi.mocked(inv.putInventoryItem).mock.calls.map((c) => c[0])).toEqual([`LG-${a.id}-V1`, `LG-${a.id}-V2`]);
    expect(inv.putInventoryItemGroup).toHaveBeenCalledWith(`LG-${a.id}-G`, expect.objectContaining({ variantSKUs: [`LG-${a.id}-V1`, `LG-${a.id}-V2`], imageUrls: ['https://eps.ebay.com/gruppe.jpg'] }));
    expect(inv.publishOfferByGroup).toHaveBeenCalledWith(`LG-${a.id}-G`);
    expect(inv.publishOffer).not.toHaveBeenCalled();
    expect(r.variants!.items.map((i) => [i.offerId, i.imageUrl])).toEqual([
      ['OFFER-1', 'https://eps.ebay.com/gruppe.jpg'],
      ['OFFER-2', 'https://eps.ebay.com/apfel.jpg'],
    ]);
  });

  it('Fehler beim Veröffentlichen: offerIds bleiben, erneuter Versuch aktualisiert statt doppelt anzulegen', async () => {
    const db = openMemoryDb();
    const a = await variationDraft(db);
    const failing = mockInv({ publishOfferByGroup: vi.fn(async () => { throw new Error('Pflicht-Merkmal fehlt'); }) });
    const r1 = await publishAttempt(db, failing, settings, a.id, upload);
    expect(r1.status).toBe('publish_failed');
    expect(r1.errorMessage).toBe('Pflicht-Merkmal fehlt');
    const stored = (await getAttempt(db, a.id))!;
    expect(stored.variants!.items.map((i) => i.offerId)).toEqual(['OFFER-1', 'OFFER-2']);
    // Bis zum Erfolg bleiben die Original-Bilder gespeichert.
    expect(stored.variants!.items[1].imageUrl).toBe('https://img.example/apfel.jpg');

    const inv = mockInv();
    const r2 = await publishAttempt(db, inv, settings, a.id, upload);
    expect(r2.status).toBe('published');
    expect(inv.createOffer).not.toHaveBeenCalled();
    expect(vi.mocked(inv.updateOffer).mock.calls.map((c) => c[0])).toEqual(['OFFER-1', 'OFFER-2']);
  });

  it('weniger als 2 Varianten → Hinweis, nichts an eBay', async () => {
    const db = openMemoryDb();
    const a = await variationDraft(db);
    await updateAttempt(db, a.id, { variants: { name: 'Sorte', items: [a.variants!.items[0]] } });
    const inv = mockInv();
    await expect(publishAttempt(db, inv, settings, a.id, upload)).rejects.toThrow(/mindestens 2 Varianten/);
    expect(inv.putInventoryItem).not.toHaveBeenCalled();
  });
});
