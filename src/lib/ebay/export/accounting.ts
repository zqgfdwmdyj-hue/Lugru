import { formatDate, renderInvoicePdf } from '../invoices/pdf';
import { pdfFilename } from '../invoices/service';
import type { InvoiceRecord } from '../invoices/types';
import { createZip } from './zip';

/** Lokales Kalenderdatum als YYYY-MM-DD — so, wie es auf der Rechnung steht. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDay(value: unknown, label: string): string {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`${label}: bitte ein Datum im Format JJJJ-MM-TT angeben.`);
  return s;
}

export function invoicesInRange(all: InvoiceRecord[], from: string, to: string): InvoiceRecord[] {
  return all
    .filter((i) => {
      const day = localDay(i.data.date);
      return day >= from && day <= to;
    })
    .sort((a, b) => a.data.date.localeCompare(b.data.date) || a.number.localeCompare(b.number));
}

const num = (n: number) => n.toFixed(2).replace('.', ',');

function cell(v: string | number): string {
  // Beträge bleiben Zahlen (auch negative bei Stornos); nur Texte werden gegen
  // Excel-Formeln entschärft — ein Käufername wie „=HYPERLINK(…)" soll Text bleiben.
  if (typeof v === 'number') return num(v);
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Rechnungsausgangsbuch als CSV — so, wie Excel und die meisten
 * Buchhaltungsprogramme es in Deutschland erwarten: Semikolon,
 * Dezimalkomma, UTF-8 mit BOM.
 */
export function invoiceCsv(list: InvoiceRecord[], all: InvoiceRecord[]): string {
  const header = [
    'Rechnungsnummer', 'Rechnungsdatum', 'Art', 'Storno zu', 'storniert durch', 'eBay-Bestellnummer', 'Käufer', 'eBay-Mitglied',
    'Nettobetrag', 'USt-Satz %', 'USt-Betrag', 'Bruttobetrag', 'Währung', 'Bezahlt am', 'Kleinunternehmer',
  ];
  const rows = list.map((i) => {
    const d = i.data;
    const cancelledBy = i.cancelledById ? all.find((x) => x.id === i.cancelledById)?.number ?? '' : '';
    return [
      i.number, formatDate(d.date), i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung', d.cancels ?? '', cancelledBy,
      d.orderId, d.buyer.name, d.buyerUsername ?? '',
      d.totalNet, d.vatRate, d.totalVat, d.totalGross, d.currency,
      d.paidAt ? formatDate(d.paidAt) : '', d.kleinunternehmer ? 'ja' : 'nein',
    ].map(cell).join(';');
  });
  const sum = (f: (i: InvoiceRecord) => number) => num(list.reduce((s, i) => s + f(i), 0));
  const total = ['Summe', '', '', '', '', '', '', '', sum((i) => i.data.totalNet), '', sum((i) => i.data.totalVat), sum((i) => i.data.totalGross), '', '', ''].join(';');
  return '\uFEFF' + [header.join(';'), ...rows, total].join('\r\n') + '\r\n';
}

/** ZIP für die Buchhaltung: Rechnungsliste als CSV plus jede Rechnung als PDF. */
export async function buildAccountingZip(all: InvoiceRecord[], from: string, to: string): Promise<{ zip: Buffer; count: number }> {
  const list = invoicesInRange(all, from, to);
  const files: { name: string; data: Uint8Array | string }[] = [
    { name: `Rechnungsausgangsbuch_${from}_bis_${to}.csv`, data: invoiceCsv(list, all) },
  ];
  for (const inv of list) files.push({ name: `Rechnungen/${pdfFilename(inv)}`, data: await renderInvoicePdf(inv.data) });
  return { zip: createZip(files), count: list.length };
}
