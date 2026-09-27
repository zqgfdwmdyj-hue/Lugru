import type { Db, InvoiceRow } from '../db/db';
import { getSetting, setSetting } from '../db/db';
import { formatInvoiceNumber } from './build';
import type { InvoiceData, InvoiceRecord, InvoiceSettings } from './types';

/*
 * Rechnungen sind Buchhaltungsbelege: Inhalt und Nummer werden beim Anlegen
 * eingefroren und danach nie geändert. Tabelle siehe INVOICE_SCHEMA in db/db.ts.
 */

// --- Einstellungen ---

const SETTINGS_KEY = 'invoiceSettings';

export async function getInvoiceSettings(db: Db): Promise<InvoiceSettings> {
  const raw = await getSetting(db, SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as InvoiceSettings) : {};
  } catch {
    return {};
  }
}

export async function saveInvoiceSettings(db: Db, s: InvoiceSettings): Promise<void> {
  await setSetting(db, SETTINGS_KEY, JSON.stringify(s));
}

export interface SyncStatus {
  at: string;
  created: number;
  sent: number;
  error?: string;
}

export async function getSyncStatus(db: Db): Promise<SyncStatus | null> {
  const raw = await getSetting(db, 'invoiceLastSync');
  try {
    return raw ? (JSON.parse(raw) as SyncStatus) : null;
  } catch {
    return null;
  }
}

export async function saveSyncStatus(db: Db, s: SyncStatus): Promise<void> {
  await setSetting(db, 'invoiceLastSync', JSON.stringify(s));
}

// --- Rechnungen ---

function toRecord(r: InvoiceRow): InvoiceRecord {
  return {
    id: Number(r.id),
    env: r.env,
    number: r.number,
    kind: r.kind === 'storno' ? 'storno' : 'invoice',
    orderId: r.order_id,
    cancelsId: r.cancels_id ?? undefined,
    cancelledById: r.cancelled_by_id ?? undefined,
    data: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as InvoiceData,
    createdAt: r.created_at,
    emailedAt: r.emailed_at ?? undefined,
    emailTo: r.email_to ?? undefined,
    emailError: r.email_error ?? undefined,
  };
}

export async function listInvoices(db: Db): Promise<InvoiceRecord[]> {
  return (await db.listInvoices()).map(toRecord);
}

export async function getInvoice(db: Db, id: number): Promise<InvoiceRecord | null> {
  if (!Number.isInteger(id)) return null;
  const row = await db.getInvoice(id);
  return row ? toRecord(row) : null;
}

/** Bestellnummern, für die eine gültige Rechnung existiert. */
export async function invoicedOrderIds(db: Db): Promise<Set<string>> {
  const rows = await db.listInvoices();
  return new Set(rows.filter((r) => r.kind === 'invoice' && r.cancelled_by_id === null).map((r) => r.order_id));
}

/** Nächste freie Nummer im Jahr — lückenlos, beginnend bei 1 oder der eingestellten Startnummer. */
export async function nextSeq(db: Db, year: number, s: InvoiceSettings): Promise<number> {
  const m = await db.maxInvoiceSeq(year);
  const start = s.startNumberYear === year && s.startNumber && s.startNumber > 0 ? s.startNumber : 1;
  return Math.max(m ?? 0, start - 1) + 1;
}

/**
 * Vergibt die Nummer und speichert die Rechnung in einem Schritt. `build`
 * bekommt die fertige Nummer und liefert den Inhalt — so kann keine Nummer
 * vergeben werden, ohne dass eine Rechnung dazu existiert. Die Sperre sorgt
 * dafür, dass zwei gleichzeitige Aufrufe nicht dieselbe Nummer ziehen.
 */
export async function insertInvoice(
  db: Db,
  opts: {
    env: string;
    settings: InvoiceSettings;
    date: Date;
    orderId: string;
    cancelsId?: number;
    build: (number: string) => InvoiceData;
  }
): Promise<InvoiceRecord> {
  const year = opts.date.getFullYear();
  const id = await db.transaction(async (tx) => {
    const seq = await nextSeq(tx, year, opts.settings);
    const number = formatInvoiceNumber(opts.settings.prefix ?? 'RE-', year, seq);
    const data = opts.build(number);
    const newId = await tx.insertInvoice({
      env: opts.env,
      number,
      year,
      seq,
      kind: data.kind,
      order_id: opts.orderId,
      cancels_id: opts.cancelsId ?? null,
      cancelled_by_id: null,
      data,
      created_at: new Date().toISOString(),
      emailed_at: null,
      email_to: null,
      email_error: null,
    });
    if (opts.cancelsId !== undefined) await tx.updateInvoice(opts.cancelsId, { cancelled_by_id: newId });
    return newId;
  }, 'invoice-number');
  return (await getInvoice(db, id))!;
}

export async function markEmailed(db: Db, id: number, to: string): Promise<void> {
  await db.updateInvoice(id, { emailed_at: new Date().toISOString(), email_to: to, email_error: null });
}

export async function markEmailError(db: Db, id: number, message: string): Promise<void> {
  await db.updateInvoice(id, { email_error: message });
}
