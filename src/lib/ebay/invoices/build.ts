import { roundCents } from '../pipeline/money';
import type { InvoiceData, InvoiceLine, InvoiceSettings, OrderForInvoice } from './types';

/** Was für eine Rechnung nach §14 UStG fehlt — leer heißt: alles da. */
export function missingSellerData(s: InvoiceSettings): string[] {
  const missing: string[] = [];
  if (!s.companyName?.trim()) missing.push('Firmenname');
  if (!s.street?.trim()) missing.push('Straße');
  if (!s.postalCode?.trim()) missing.push('PLZ');
  if (!s.city?.trim()) missing.push('Ort');
  if (!s.taxNumber?.trim() && !s.vatId?.trim()) missing.push('Steuernummer oder USt-IdNr.');
  return missing;
}

export function effectiveVatRate(s: InvoiceSettings, fallback?: number): number {
  if (s.kleinunternehmer) return 0;
  const r = s.vatRate ?? fallback ?? 19;
  return Number.isFinite(r) && r >= 0 ? r : 19;
}

export function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Umsatzsteuer aus dem Bruttobetrag der ganzen Rechnung — nicht je Zeile
 * summiert, damit keine Rundungscents zwischen Zeilen und Summe entstehen.
 */
export function splitGross(totalGross: number, vatRate: number): { net: number; vat: number } {
  if (vatRate <= 0) return { net: roundCents(totalGross), vat: 0 };
  const vat = roundCents((totalGross * vatRate) / (100 + vatRate));
  return { net: roundCents(totalGross - vat), vat };
}

export function buildInvoiceData(
  order: OrderForInvoice,
  s: InvoiceSettings,
  opts: { number: string; date: string; vatRate: number }
): InvoiceData {
  const lines: InvoiceLine[] = order.items.map((i) => ({
    description: i.sku ? `${i.title} (Art.-Nr. ${i.sku})` : i.title,
    quantity: i.quantity,
    unitGross: roundCents(i.totalGross / (i.quantity || 1)),
    totalGross: roundCents(i.totalGross),
  }));
  if (order.shippingGross > 0) {
    lines.push({ description: 'Versandkosten', quantity: 1, unitGross: roundCents(order.shippingGross), totalGross: roundCents(order.shippingGross) });
  }
  if (order.discountGross > 0) {
    lines.push({ description: 'Rabatt', quantity: 1, unitGross: -roundCents(order.discountGross), totalGross: -roundCents(order.discountGross) });
  }
  const totalGross = roundCents(lines.reduce((sum, l) => sum + l.totalGross, 0));
  const vatRate = s.kleinunternehmer ? 0 : opts.vatRate;
  const { net, vat } = splitGross(totalGross, vatRate);

  return {
    kind: 'invoice',
    number: opts.number,
    date: opts.date,
    orderId: order.orderId,
    orderDate: order.createdAt,
    paidAt: order.paidAt,
    buyerUsername: order.buyerUsername,
    seller: {
      companyName: s.companyName!.trim(),
      ownerName: s.ownerName?.trim() || undefined,
      addressLines: [s.street!.trim(), `${s.postalCode!.trim()} ${s.city!.trim()}`, s.country?.trim() || 'Deutschland'],
      email: s.email?.trim() || undefined,
      phone: s.phone?.trim() || undefined,
      taxNumber: s.taxNumber?.trim() || undefined,
      vatId: s.vatId?.trim() || undefined,
      footerText: s.footerText?.trim() || undefined,
    },
    buyer: order.buyer,
    buyerEmail: order.buyerEmail,
    currency: order.currency,
    lines,
    kleinunternehmer: Boolean(s.kleinunternehmer),
    vatRate,
    totalGross,
    totalNet: net,
    totalVat: vat,
  };
}

/** Stornorechnung: dieselben Positionen mit umgekehrtem Vorzeichen, Verweis auf das Original. */
export function buildStornoData(original: InvoiceData, opts: { number: string; date: string }): InvoiceData {
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return {
    ...original,
    kind: 'storno',
    number: opts.number,
    date: opts.date,
    cancels: original.number,
    lines: original.lines.map((l) => ({ ...l, unitGross: neg(l.unitGross), totalGross: neg(l.totalGross) })),
    totalGross: neg(original.totalGross),
    totalNet: neg(original.totalNet),
    totalVat: neg(original.totalVat),
  };
}

/** Ersetzt {nummer}, {bestellnummer} und {name} in Betreff und Text der E-Mail. */
export function fillTemplate(template: string, data: InvoiceData): string {
  return template
    .replaceAll('{nummer}', data.number)
    .replaceAll('{bestellnummer}', data.orderId)
    .replaceAll('{name}', data.buyer.name);
}

export const DEFAULT_EMAIL_SUBJECT = 'Ihre Rechnung {nummer} zur eBay-Bestellung {bestellnummer}';
export const DEFAULT_EMAIL_TEXT =
  'Hallo {name},\n\nvielen Dank für Ihren Einkauf. Anbei erhalten Sie die Rechnung {nummer} zu Ihrer eBay-Bestellung {bestellnummer}.\n\nMit freundlichen Grüßen';
