import type { Db } from '../db/db';
import { getSettings, getToken } from '../db/db';
import { syncInvoices, type InvoiceDeps } from './service';
import { getInvoiceSettings } from './store';
import { legacyDecision } from './legacy';

/**
 * Ein Lauf der Rechnungs-Automatik: neue bezahlte Bestellungen abrechnen. Läuft nur, wenn
 * sie eingeschaltet ist, Production aktiv ist und eine eBay-Verbindung besteht. Aufgerufen
 * vom Hintergrund-Takt des Seller-Systems (alle 15 Minuten, wie im bisherigen Tool).
 */
export async function runInvoiceAutomation(db: Db, deps: InvoiceDeps): Promise<void> {
  const settings = await getSettings(db);
  if (!(await getInvoiceSettings(db)).autoCreate || settings.env !== 'production') return;
  if (!(await getToken(db, settings.env, 'user'))?.refreshToken) return;
  // Erst nach der Entscheidung über die Übernahme aus dem bisherigen Tool (siehe legacy.ts).
  if (!(await legacyDecision(db))) return;
  const status = await syncInvoices(db, deps);
  if (status.created > 0 || status.error) {
    console.log(`Rechnungen: ${status.created} erstellt, ${status.sent} verschickt${status.error ? ` — ${status.error}` : ''}`);
  }
}
