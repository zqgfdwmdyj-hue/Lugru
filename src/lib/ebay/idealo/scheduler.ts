import type { Db } from '../db/db';
import { getSetting, listAttempts, setSetting } from '../db/db';
import { withOwnHistory } from './history';
import { lookupIdealo } from './idealo';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Abstand zwischen zwei Abfragen — idealo soll keine Anfrageflut sehen. */
const GAP_MS = 20_000;
const MAX_PER_RUN = 50;

/**
 * Fragt einmal am Tag den idealo-Bestpreis für alle veröffentlichten Artikel
 * ab, damit der eigene Preisverlauf auch ohne Öffnen der Vorschau wächst.
 * Aufgerufen vom Hintergrund-Takt; tut nichts, wenn der letzte Lauf keinen Tag her ist.
 */
export async function runIdealoDaily(db: Db, gapMs = GAP_MS): Promise<void> {
  const last = await getSetting(db, 'idealoLastDaily');
  if (last && Date.now() - Date.parse(last) < DAY_MS) return;
  await setSetting(db, 'idealoLastDaily', new Date().toISOString());
  const eans = [...new Set((await listAttempts(db)).filter((a) => a.status === 'published' && a.ean).map((a) => a.ean))].slice(0, MAX_PER_RUN);
  for (const ean of eans) {
    try {
      await withOwnHistory(db, await lookupIdealo({ ean }));
    } catch {
      // Einzelne Fehlschläge sind egal — morgen gibt es den nächsten Versuch.
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
