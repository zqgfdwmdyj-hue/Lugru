import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Prüft die ZIPs mit dem System-unzip; fehlt es (z.B. unter Windows), entfallen diese Tests. */
const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v']);
    return true;
  } catch {
    return false;
  }
})();
import {setSetting} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import { cancelInvoice, createInvoice } from '@/lib/ebay/invoices/service';
import { listInvoices, saveInvoiceSettings } from '@/lib/ebay/invoices/store';
import type { OrderForInvoice } from '@/lib/ebay/invoices/types';
import { buildAccountingZip, invoiceCsv, invoicesInRange, parseDay } from '@/lib/ebay/export/accounting';
import { createZip } from '@/lib/ebay/export/zip';

function order(id: string, name = 'Erika Muster'): OrderForInvoice {
  return {
    orderId: id, createdAt: '2026-09-01T10:00:00Z', paid: true, cancelled: false, buyer: { name, lines: ['A 1'] },
    currency: 'EUR', items: [{ title: 'Ding', quantity: 1, totalGross: 119 }], shippingGross: 0, discountGross: 0,
  };
}

async function setup() {
  const db = openMemoryDb();
  await setSetting(db, 'env', 'production');
  await saveInvoiceSettings(db, { companyName: 'X', street: 'S', postalCode: '1', city: 'C', taxNumber: '1' });
  const a = await createInvoice(db, order('A'), new Date(2026, 7, 31, 12));
  await createInvoice(db, order('B', '=HYPERLINK("x")'), new Date(2026, 8, 5, 12));
  await cancelInvoice(db, a.id, new Date(2026, 8, 10, 12));
  return db;
}

describe('Buchhaltungs-Export', () => {
  it('filtert nach Rechnungsdatum', async () => {
    const all = await listInvoices(await setup());
    expect(invoicesInRange(all, '2026-09-01', '2026-09-30').map((i) => i.number)).toEqual(['RE-2026-0002', 'RE-2026-0003']);
  });

  it('schreibt eine Excel-taugliche CSV mit Summenzeile und entschärften Formeln', async () => {
    const all = await listInvoices(await setup());
    const csv = invoiceCsv(invoicesInRange(all, '2026-08-01', '2026-09-30'), all);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toContain('Rechnungsnummer;Rechnungsdatum');
    expect(lines[1]).toContain('RE-2026-0001;31.08.2026;Rechnung;;RE-2026-0003');
    expect(lines[1]).toContain('100,00;19,00;19,00;119,00;EUR');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[3]).toContain('Stornorechnung;RE-2026-0001');
    expect(lines[3]).toContain(';-100,00;19,00;-19,00;-119,00;');
    expect(lines[4]).toBe('Summe;;;;;;;;100,00;;19,00;119,00;;;');
  });

  it.skipIf(!hasUnzip)('packt CSV und PDFs in ein ZIP, das sich entpacken lässt', async () => {
    const all = await listInvoices(await setup());
    const { zip, count } = await buildAccountingZip(all, '2026-09-01', '2026-09-30');
    expect(count).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), 'lugru-zip-'));
    writeFileSync(join(dir, 'a.zip'), zip);
    const listing = execFileSync('unzip', ['-t', join(dir, 'a.zip')]).toString();
    expect(listing).toContain('No errors detected');
    expect(listing).toContain('Rechnungen/Stornorechnung_RE-2026-0003.pdf');
    expect(listing).toContain('Rechnungsausgangsbuch_2026-09-01_bis_2026-09-30.csv');
  });

  it('prüft Datumsangaben', async () => {
    expect(() => parseDay('2026-9-1', 'Von')).toThrow(/JJJJ-MM-TT/);
    expect(parseDay('2026-09-01', 'Von')).toBe('2026-09-01');
  });

  it.skipIf(!hasUnzip)('schreibt Umlaute in Dateinamen korrekt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lugru-zip-'));
    writeFileSync(join(dir, 'u.zip'), createZip([{ name: 'Übersicht.txt', data: 'äöü' }]));
    expect(execFileSync('unzip', ['-p', join(dir, 'u.zip')]).toString()).toBe('äöü');
  });
});
