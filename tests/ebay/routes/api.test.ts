import { describe, it, expect, beforeAll } from 'vitest';
import { apiRouter } from '@/lib/ebay/routes/api';
import { dispatch } from '@/lib/ebay/routes/dispatch';
import { createAttempt, getSettings, saveToken, updateAttempt, type Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';

/**
 * Route-Tests – im bisherigen Tool gegen einen echten Express-Server, hier direkt über
 * dieselbe Weiterleitung, die auch der Next-Route-Handler nutzt.
 * Sie sichern die Zusagen ab, die sonst nur durch Code-Lesen belegt wären —
 * allen voran: Einkaufsdaten bleiben auch nach dem Veröffentlichen änderbar.
 */
let db: Db;
const base = 'http://test/api';

beforeAll(async () => {
  db = openMemoryDb();
});

/** Ersetzt im Test den Aufruf des Servers per HTTP. */
async function fetch(url: string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(url);
  return dispatch([apiRouter(db)], {
    method: init.method ?? 'GET',
    path: u.pathname.replace(/^\/api/, ''),
    query: u.searchParams,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  });
}

async function published() {
  const a = await createAttempt(db, {
    ean: '4006381333931',
    price: 25,
    quantity: 1,
    condition: 'NEW',
    purchasePrice: 8,
  });
  return (await updateAttempt(db, a.id, { status: 'published', listingId: '1234', categoryId: '15032' }))!;
}

async function patch(id: number, body: unknown) {
  const res = await fetch(`${base}/attempts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('PATCH /attempts/:id — Einkaufsdaten bei veröffentlichten Listings', () => {
  it('lässt Einkaufsdaten zu und liefert die angereicherte Antwort', async () => {
    const a = await published();
    const { status, json } = await patch(a.id, {
      purchasedUnits: 10,
      purchasePrice: 90,
      purchasePriceMode: 'total',
      purchaseSource: 'https://www.metro.de/artikel/4711',
    });

    expect(status).toBe(200);
    expect(json.status).toBe('published');
    expect(json.purchasedUnits).toBe(10);
    expect(json.purchasePrice).toBe(9); // 90 / 10 Einheiten
    expect(json.source).toMatchObject({ merchant: 'Metro', url: 'https://www.metro.de/artikel/4711' });
    // Anreicherung muss auch auf diesem Pfad laufen.
    expect(json.fee).toBe(2.2); // 25 × 7 % (Kategorie 15032, neu) + 0,45
    // Ohne USt-Satz und ohne Versandkosten: 25,00 − 9,00 − 2,20
    expect(json.profit).toMatchObject({ profit: 13.8, purchasePrice: 9, fee: 2.2 });
  });

  it('blockt Angebotsinhalte bei veröffentlichten Listings weiterhin', async () => {
    const a = await published();
    const { status, json } = await patch(a.id, { title: 'Neuer Titel' });
    expect(status).toBe(400);
    expect(String(json.error)).toContain('Veröffentlichte Listings');
  });

  it('leert ein Einkaufsfeld, wenn null geschickt wird', async () => {
    const a = await published();
    const { json } = await patch(a.id, { purchasePrice: null });
    expect(json.purchasePrice).toBeUndefined();
    expect(json.profit).toBeNull();
  });
});

describe('PATCH /attempts/:id — gemischte Bodies', () => {
  it('weist Angebots- und Einkaufsfelder in einem Body zurück, statt still zu verwerfen', async () => {
    const a = await createAttempt(db, { ean: '1', price: 10, quantity: 1, condition: 'NEW' });
    const { status, json } = await patch(a.id, { purchasePrice: 5, price: 99 });
    expect(status).toBe(400);
    expect(String(json.error)).toContain('getrennt');

    // Der Preis darf dabei nicht verändert worden sein.
    const after = (await (await fetch(`${base}/attempts/${a.id}`)).json());
    expect(after.price).toBe(10);
    expect(after.purchasePrice).toBeUndefined();
  });

  it('erlaubt purchasePriceMode als Begleitfeld', async () => {
    const a = await createAttempt(db, { ean: '1', price: 10, quantity: 1, condition: 'NEW' });
    const { status, json } = await patch(a.id, { purchasePrice: 20, purchasePriceMode: 'total', purchasedUnits: 4 });
    expect(status).toBe(200);
    expect(json.purchasePrice).toBe(5);
  });
});

describe('PUT /settings — Gebührensätze', () => {
  async function put(body: unknown) {
    return fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('nimmt feeCategoryRates als JSON-String', async () => {
    await put({ feeCategoryRates: JSON.stringify({ '999001': 9.5 }) });
    const s = ((await (await fetch(`${base}/settings`)).json())) as Record<string, unknown>;
    expect(s.feeCategoryRates).toEqual({ '999001': 9.5 });
  });

  it('nimmt feeCategoryRates auch als Objekt', async () => {
    await put({ feeCategoryRates: { '999002': 6 } });
    const s = ((await (await fetch(`${base}/settings`)).json())) as Record<string, unknown>;
    expect(s.feeCategoryRates).toEqual({ '999002': 6 });
  });
});

describe('Umsatzsteuer in der Gewinnrechnung', () => {
  it('zieht die enthaltene USt ab und rechnet brutto eingegebene Einkäufe auf netto', async () => {
    await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vatPercentage: '19', shippingAssumption: '3.37', feeCategoryRates: { '900100': 15 } }),
    });

    const a = await createAttempt(db, { ean: '9', price: 35, quantity: 1, condition: 'NEW' });
    await updateAttempt(db, a.id, { categoryId: '900100' });

    // 12,05 brutto → 10,13 netto
    const { json } = await patch(a.id, { purchasePrice: 12.05, purchasePriceVat: 'gross' });
    expect(json.purchasePrice).toBe(10.13);

    const profit = json.profit as Record<string, number>;
    expect(profit.vat).toBe(5.59); // 35 × 19/119
    expect(profit.shipping).toBe(3.37);
    // Eigener Satz 15 % auf 35,00 = 5,25, plus 0,45 Fixbetrag (Bestellwert über 10 €)
    expect(profit.fee).toBe(5.7);
    expect(profit.profit).toBe(10.21); // 35 − 5,59 − 10,13 − 5,70 − 3,37
    // Die Vorschau braucht den Satz, um die Brutto-Eingabe anzubieten.
    expect(json.vatPercentage).toBe(19);
  });

  it('der USt-Satz gilt für beide Umgebungen', async () => {
    const put = (body: unknown) =>
      fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await put({ env: 'production' });
    try {
      const s = ((await (await fetch(`${base}/settings`)).json())) as Record<string, unknown>;
      expect(s.vatPercentage).toBe(19);
    } finally {
      await put({ env: 'sandbox' });
    }
  });

  it('weist einen Gesamtbetrag ohne Einheiten und brutto ohne USt-Satz ab', async () => {
    const put = (body: unknown) =>
      fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const a = await createAttempt(db, { ean: '9', price: 35, quantity: 1, condition: 'NEW' });

    const noUnits = await patch(a.id, { purchasePrice: 120.5, purchasePriceMode: 'total' });
    expect(noUnits.status).toBe(400);
    expect(String(noUnits.json.error)).toContain('Einheiten');

    await put({ vatPercentage: '' });
    try {
      const noVat = await patch(a.id, { purchasePrice: 12.05, purchasePriceVat: 'gross' });
      expect(noVat.status).toBe(400);
      expect(String(noVat.json.error)).toContain('USt-Satz');
    } finally {
      await put({ vatPercentage: '19' });
    }
    // Nichts davon wurde still gespeichert.
    expect(((await (await fetch(`${base}/attempts/${a.id}`)).json())).purchasePrice).toBeUndefined();
  });
});

describe('Altbestand: Einkaufspreise ohne bestätigte Basis', () => {
  const put = (body: unknown) =>
    fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const settle = async (ids: number[], action: string) => {
    const res = await fetch(`${base}/purchases/basis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action }),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const unconfirmed = async () =>
    ((await (await fetch(`${base}/purchases/unconfirmed`)).json())) as { attempts: { id: number }[]; vatPercentage?: number; netBasisSince: string };
  /** Eine Zeile aus der Zeit vor der Umstellung: Preis da, Basis leer. */
  async function legacy(purchasePrice: number) {
    const a = await createAttempt(db, { ean: '7', price: 35, quantity: 1, condition: 'NEW', purchasePrice });
    await db.updateAttempt(a.id, { purchase_price_basis: null });
    return a;
  }

  it('listet nur Zeilen ohne Basis, mit USt-Satz und Stichtag', async () => {
    const a = await legacy(12.05);
    const fresh = await createAttempt(db, { ean: '7', price: 35, quantity: 1, condition: 'NEW', purchasePrice: 5 });
    const list = await unconfirmed();
    expect(list.attempts.map((x) => x.id)).toContain(a.id);
    expect(list.attempts.map((x) => x.id)).not.toContain(fresh.id);
    expect(list.vatPercentage).toBe(19);
    expect(list.netBasisSince).toBe('2026-09-01T14:20:21.000Z');
  });

  it('rechnet auf Wunsch brutto → netto um und markiert die Zeile — genau einmal', async () => {
    const a = await legacy(12.05);
    expect((await settle([a.id], 'convert')).json).toEqual({ updated: 1 });
    const after = (await (await fetch(`${base}/attempts/${a.id}`)).json());
    expect(after.purchasePrice).toBe(10.13); // 12,05 / 1,19
    expect(after.purchasePriceBasis).toBe('net');
    expect((await unconfirmed()).attempts.map((x) => x.id)).not.toContain(a.id);
    // Eine bestätigte Zeile wird nicht ein zweites Mal umgerechnet.
    expect((await settle([a.id], 'convert')).json).toEqual({ updated: 0 });
    expect(((await (await fetch(`${base}/attempts/${a.id}`)).json())).purchasePrice).toBe(10.13);
  });

  it('bestätigt einen Wert als netto, ohne ihn zu ändern', async () => {
    const a = await legacy(8);
    expect((await settle([a.id], 'confirm')).json).toEqual({ updated: 1 });
    const after = (await (await fetch(`${base}/attempts/${a.id}`)).json());
    expect(after.purchasePrice).toBe(8);
    expect(after.purchasePriceBasis).toBe('net');
  });

  it('weist eine Umrechnung ohne USt-Satz ab und lässt alles unangetastet', async () => {
    const a = await legacy(12.05);
    await put({ vatPercentage: '' });
    try {
      const { status, json } = await settle([a.id], 'convert');
      expect(status).toBe(400);
      expect(String(json.error)).toContain('USt-Satz');
    } finally {
      await put({ vatPercentage: '19' });
    }
    const after = (await (await fetch(`${base}/attempts/${a.id}`)).json());
    expect(after.purchasePrice).toBe(12.05);
    expect(after.purchasePriceBasis).toBeUndefined();
  });

  it('weist unbekannte Aktionen und leere Listen ab', async () => {
    expect((await settle([1], 'delete')).status).toBe(400);
    expect((await settle([], 'confirm')).status).toBe(400);
  });
});

describe('GET /status — Ablaufdatum der Verbindung', () => {
  it('meldet null, solange keine Verbindung besteht', async () => {
    const res = await fetch(`${base}/status`);
    const body = await res.json();
    expect(body.connected).toBe(false);
    expect(body.connectionExpiresAt).toBeNull();
  });

  it('gibt das Ablaufdatum des Refresh-Tokens heraus', async () => {
    const expires = new Date(Date.now() + 400 * 24 * 3600_000).toISOString();
    await saveToken(db, 'sandbox', 'user', {
      accessToken: 'tok',
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      refreshToken: 'r',
      refreshExpiresAt: expires,
    });

    const res = await fetch(`${base}/status`);
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.connectionExpiresAt).toBe(expires);
  });
});

describe('PATCH /attempts/:id — Beschreibung und Versandprofil am Entwurf', () => {
  async function draft() {
    const a = await createAttempt(db, { ean: '4006381333931', price: 25, quantity: 1, condition: 'NEW' });
    return (await updateAttempt(db, a.id, { title: 'Testartikel', aspects: { Marke: ['ACME'] }, description: '<p>alt</p>' }))!;
  }

  it('übernimmt eigenes HTML und weist aktive Inhalte ab', async () => {
    const a = await draft();
    const ok = await patch(a.id, { description: '<div style="color:red"><b>Neu</b></div>' });
    expect(ok.status).toBe(200);
    expect(ok.json.description).toBe('<div style="color:red"><b>Neu</b></div>');

    const bad = await patch(a.id, { description: '<p>x</p><script>alert(1)</script>' });
    expect(bad.status).toBe(400);
    expect(String(bad.json.error)).toContain('<script>');
  });

  it('erzeugt die Beschreibung auf Wunsch neu aus Titel und Merkmalen', async () => {
    const a = await draft();
    const { json } = await patch(a.id, { resetDescription: true });
    expect(json.description).toContain('<h2>Testartikel</h2>');
    expect(json.description).toContain('ACME');
  });

  it('merkt sich ein Versandprofil und fällt bei leerer Auswahl auf den Standard zurück', async () => {
    const a = await draft();
    expect((await patch(a.id, { fulfillmentPolicyId: 'F-EXPRESS' })).json.fulfillmentPolicyId).toBe('F-EXPRESS');
    expect((await patch(a.id, { fulfillmentPolicyId: '' })).json.fulfillmentPolicyId).toBeUndefined();
  });
});

describe('Einstellungen — Keepa-Schlüssel', () => {
  async function put(body: unknown) {
    await fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const get = async () => (await (await fetch(`${base}/settings`)).json()) as Record<string, unknown>;

  it('speichert den Schlüssel, zeigt ihn nur maskiert und lässt ihn bei „***" stehen', async () => {
    await put({ keepaApiKey: 'geheim123' });
    expect((await get()).keepaApiKey).toBe('***');
    await put({ keepaApiKey: '***' });
    expect((await getSettings(db)).keepaApiKey).toBe('geheim123');
    await put({ keepaApiKey: '' });
    expect((await get()).keepaApiKey).toBe('');
  });
});
