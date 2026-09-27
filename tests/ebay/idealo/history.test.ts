import { describe, expect, it } from 'vitest';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import { ownHistory, recordPrice, withOwnHistory } from '@/lib/ebay/idealo/history';
import type { IdealoResult } from '@/lib/ebay/idealo/idealo';

const base: IdealoResult = { status: 'ok', searchUrl: 's', productId: '42', lowPrice: 10, fetchedAt: '' };

describe('eigene idealo-Preisaufzeichnung', () => {
  it('merkt je Tag den niedrigsten Preis', async () => {
    const db = openMemoryDb();
    await recordPrice(db, '42', 12, new Date(2026, 8, 1, 9));
    await recordPrice(db, '42', 11, new Date(2026, 8, 1, 18));
    await recordPrice(db, '42', 13, new Date(2026, 8, 2, 9));
    expect(await ownHistory(db, '42')).toEqual([{ date: '2026-09-01', price: 11 }, { date: '2026-09-02', price: 13 }]);
  });

  it('nimmt den idealo-Verlauf, wenn es einen gibt, sonst den eigenen', async () => {
    const db = openMemoryDb();
    const idealo = await withOwnHistory(db, { ...base, productId: 'anderes', history: [{ date: '2026-01-01', price: 9 }, { date: '2026-01-02', price: 8 }] });
    expect(idealo.historySource).toBe('idealo');
    await withOwnHistory(db, { ...base, lowPrice: 10 }, new Date(2026, 8, 1));
    const own = await withOwnHistory(db, { ...base, lowPrice: 9.5 }, new Date(2026, 8, 2));
    expect(own).toMatchObject({ historySource: 'own', history: [
      { date: '2026-09-01', price: 10 }, { date: '2026-09-02', price: 9.5 },
    ] });
  });

  it('lässt Fehlschläge unverändert', async () => {
    const db = openMemoryDb();
    const r: IdealoResult = { status: 'blocked', searchUrl: 's', fetchedAt: '' };
    expect(await withOwnHistory(db, r)).toBe(r);
  });
});
