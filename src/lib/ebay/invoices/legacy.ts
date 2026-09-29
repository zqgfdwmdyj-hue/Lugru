import type { Db } from '../db/db';
import { getSetting, setSetting } from '../db/db';
import { listInvoices } from './store';

// Umzug aus dem bisherigen eBay-Tool: Solange nicht entschieden ist, ob die alten Rechnungen
// übernommen werden, entstehen hier keine Rechnungen – sonst gäbe es dieselben Rechnungsnummern
// doppelt (altes Tool und Seller-System zählen beide ab RE-JJJJ-0001) und die Übernahme wäre
// nicht mehr möglich (sie geht nur in einen leeren Bereich).

export const LEGACY_KEY = 'legacyDecision';
export const LEGACY_PENDING =
  'Rechnungen ruhen, bis entschieden ist, ob die Daten aus dem bisherigen eBay-Tool übernommen werden (eBay-Einstellungen → Sicherung → Übernahme) – sonst gäbe es Rechnungsnummern doppelt.';

export type LegacyDecision = 'imported' | 'fresh';

export async function legacyDecision(db: Db): Promise<LegacyDecision | null> {
  const v = await getSetting(db, LEGACY_KEY);
  if (v === 'imported' || v === 'fresh') return v;
  // Frühere Übernahmen (vor dieser Einstellung) oder schon vorhandene Rechnungen gelten als entschieden.
  return (await listInvoices(db)).length > 0 ? 'imported' : null;
}

export async function requireLegacyDecision(db: Db): Promise<void> {
  if (!(await legacyDecision(db))) throw new Error(LEGACY_PENDING);
}

export async function setLegacyDecision(db: Db, d: LegacyDecision): Promise<void> {
  await setSetting(db, LEGACY_KEY, d);
}
