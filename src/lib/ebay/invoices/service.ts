import type { Db } from '../db/db';
import { getSettings } from '../db/db';
import type { Settings } from '../types';
import {
  buildInvoiceData, buildStornoData, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEXT, effectiveVatRate, fillTemplate, missingSellerData,
} from './build';
import type { MailSender } from './mail';
import { renderInvoicePdf } from './pdf';
import {
  getInvoice, getInvoiceSettings, insertInvoice, invoicedOrderIds, markEmailError, markEmailed, saveSyncStatus, type SyncStatus,
} from './store';
import type { InvoiceRecord, OrderForInvoice } from './types';

export interface InvoiceDeps {
  fetchOrders: (since: string) => Promise<OrderForInvoice[]>;
  /** Wird erst beim ersten Versand gebaut — ohne verbundenes Postfach soll das Erstellen trotzdem gehen. */
  mailer?: () => MailSender | Promise<MailSender>;
  now?: () => Date;
  /** Postfächer des Hauptsystems, über die gesendet werden kann. */
  senders?: () => Promise<{ id: string; address: string; isDefault: boolean }[]>;
}

/** Wie weit zurück „offene Bestellungen" reichen, wenn die Automatik nie eingeschaltet war. */
const DEFAULT_LOOKBACK_DAYS = 30;

function requireProduction(settings: Settings): void {
  if (settings.env !== 'production') {
    throw new Error('Rechnungen gibt es nur für echte Bestellungen — bitte in den Einstellungen auf Production umstellen.');
  }
}

export function pdfFilename(inv: InvoiceRecord): string {
  return `${inv.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'}_${inv.number}.pdf`.replace(/[^\w.-]+/g, '_');
}

async function sinceDate(db: Db, now: Date): Promise<string> {
  const s = await getInvoiceSettings(db);
  return s.startDate ?? new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString();
}

/** Bezahlte, nicht stornierte Bestellungen ohne gültige Rechnung. */
export async function openOrders(db: Db, deps: InvoiceDeps): Promise<OrderForInvoice[]> {
  requireProduction(await getSettings(db));
  const now = deps.now?.() ?? new Date();
  const done = await invoicedOrderIds(db);
  const orders = await deps.fetchOrders(await sinceDate(db, now));
  return orders.filter((o) => o.paid && !o.cancelled && !done.has(o.orderId));
}

export async function createInvoice(db: Db, order: OrderForInvoice, now = new Date()): Promise<InvoiceRecord> {
  const settings = await getSettings(db);
  requireProduction(settings);
  const s = await getInvoiceSettings(db);
  const missing = missingSellerData(s);
  if (missing.length > 0) throw new Error(`Für Rechnungen fehlen noch Angaben unter Einstellungen → Rechnungen: ${missing.join(', ')}.`);
  if (!order.paid) throw new Error(`Bestellung ${order.orderId} ist noch nicht bezahlt.`);
  if ((await invoicedOrderIds(db)).has(order.orderId)) throw new Error(`Für Bestellung ${order.orderId} gibt es schon eine Rechnung.`);

  const vatRate = effectiveVatRate(s, settings.vatPercentage);
  return await insertInvoice(db, {
    env: settings.env,
    settings: s,
    date: now,
    orderId: order.orderId,
    build: (number) => buildInvoiceData(order, s, { number, date: now.toISOString(), vatRate }),
  });
}

export async function cancelInvoice(db: Db, id: number, now = new Date()): Promise<InvoiceRecord> {
  const original = await getInvoice(db, id);
  if (!original) throw new Error('Rechnung nicht gefunden.');
  if (original.kind === 'storno') throw new Error('Eine Stornorechnung kann nicht storniert werden.');
  if (original.cancelledById) throw new Error('Diese Rechnung ist bereits storniert.');
  const s = await getInvoiceSettings(db);
  return await insertInvoice(db, {
    env: original.env,
    settings: s,
    date: now,
    orderId: original.orderId,
    cancelsId: original.id,
    build: (number) => buildStornoData(original.data, { number, date: now.toISOString() }),
  });
}

export async function sendInvoice(db: Db, id: number, to: string | undefined, mailer: MailSender): Promise<InvoiceRecord> {
  const inv = await getInvoice(db, id);
  if (!inv) throw new Error('Rechnung nicht gefunden.');
  const address = (to ?? inv.emailTo ?? inv.data.buyerEmail ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw new Error('Keine gültige E-Mail-Adresse des Käufers — bitte eine Adresse angeben.');
  }
  const s = await getInvoiceSettings(db);
  try {
    await mailer({
      to: address,
      subject: fillTemplate(s.emailSubject?.trim() || DEFAULT_EMAIL_SUBJECT, inv.data),
      text: fillTemplate(s.emailText?.trim() || DEFAULT_EMAIL_TEXT, inv.data),
      attachment: { filename: pdfFilename(inv), content: await renderInvoicePdf(inv.data) },
    });
  } catch (err) {
    await markEmailError(db, id, err instanceof Error ? err.message : String(err));
    throw err;
  }
  await markEmailed(db, id, address);
  return (await getInvoice(db, id))!;
}

/**
 * Ein Durchlauf der Automatik: neue bezahlte Bestellungen abrechnen und — wenn
 * eingestellt — verschicken. Ein Fehler bei einer Bestellung hält die übrigen
 * nicht auf; der erste wird im Status gemeldet.
 */
export async function syncInvoices(db: Db, deps: InvoiceDeps): Promise<SyncStatus> {
  const now = deps.now?.() ?? new Date();
  const status: SyncStatus = { at: now.toISOString(), created: 0, sent: 0 };
  try {
    const s = await getInvoiceSettings(db);
    const orders = await openOrders(db, deps);
    let mailer: MailSender | undefined;
    for (const order of orders) {
      try {
        const inv = await createInvoice(db, order, now);
        status.created++;
        if (s.autoSend && inv.data.buyerEmail) {
          mailer ??= await deps.mailer?.();
          if (mailer) {
            await sendInvoice(db, inv.id, undefined, mailer);
            status.sent++;
          }
        }
      } catch (err) {
        status.error ??= err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
  }
  await saveSyncStatus(db, status);
  return status;
}
