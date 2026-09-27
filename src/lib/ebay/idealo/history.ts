import type { Db } from '../db/db';
import type { IdealoResult, PricePoint } from './idealo';

/**
 * Eigene Aufzeichnung des idealo-Bestpreises: je Produkt und Tag der
 * niedrigste gesehene Preis. Liefert idealo keinen Verlauf (Bot-Schutz, fehlende
 * Daten), entsteht so mit der Zeit ein eigener.
 */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function recordPrice(db: Db, productKey: string, price: number, now = new Date()): Promise<void> {
  await db.recordIdealoPrice(productKey, localDay(now), price);
}

export async function ownHistory(db: Db, productKey: string): Promise<PricePoint[]> {
  return (await db.idealoHistory(productKey)).map((r) => ({ date: r.day, price: Number(r.price) }));
}

/** Aktuellen Bestpreis merken und — wenn idealo keinen Verlauf liefert — den eigenen einsetzen. */
export async function withOwnHistory(db: Db, result: IdealoResult, now = new Date()): Promise<IdealoResult> {
  if (result.status !== 'ok') return result;
  const key = result.productId ?? result.searchUrl;
  if (result.lowPrice !== undefined && result.lowPrice > 0) await recordPrice(db, key, result.lowPrice, now);
  if ((result.history ?? []).length >= 2) return { ...result, historySource: 'idealo' };
  return { ...result, history: await ownHistory(db, key), historySource: 'own' };
}
