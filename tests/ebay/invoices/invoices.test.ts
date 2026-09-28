import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {saveToken, setSetting} from '@/lib/ebay/db/db';
import type { Db } from '@/lib/ebay/db/db';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import { buildInvoiceData, buildStornoData, fillTemplate, missingSellerData, splitGross } from '@/lib/ebay/invoices/build';
import { mapOrder } from '@/lib/ebay/invoices/orders';
import { renderInvoicePdf, safe } from '@/lib/ebay/invoices/pdf';
import { cancelInvoice, createInvoice, openOrders, sendInvoice, syncInvoices } from '@/lib/ebay/invoices/service';
import { getInvoice, listInvoices, saveInvoiceSettings } from '@/lib/ebay/invoices/store';
import type { InvoiceSettings, OrderForInvoice } from '@/lib/ebay/invoices/types';
import { mergeInvoiceSettings } from '@/lib/ebay/routes/invoices';
import type { MailInput } from '@/lib/ebay/invoices/mail';

const SELLER: InvoiceSettings = {
  companyName: 'LuGru Handel', street: 'Hauptstr. 1', postalCode: '12345', city: 'Musterstadt',
  taxNumber: '12/345/67890', email: 'shop@example.de', prefix: 'RE-',
};

function order(id = '12-34567-89012', extra: Partial<OrderForInvoice> = {}): OrderForInvoice {
  return {
    orderId: id, createdAt: '2026-09-20T10:00:00.000Z', paidAt: '2026-09-20T10:05:00.000Z', paid: true, cancelled: false,
    buyerUsername: 'kaeufer123', buyer: { name: 'Erika Muster', lines: ['Weg 2', '54321 Beispielort'] },
    buyerEmail: 'erika@example.de', currency: 'EUR',
    items: [{ title: 'Kaffeemaschine', sku: 'LG-1', quantity: 2, totalGross: 119 }],
    shippingGross: 4.99, discountGross: 0, ...extra,
  };
}

async function db() {
  const d = openMemoryDb();
  await setSetting(d, 'env', 'production');
  await saveInvoiceSettings(d, SELLER);
  return d;
}

describe('Rechnungsinhalt', () => {
  it('rechnet die USt aus dem Brutto der ganzen Rechnung heraus', async () => {
    expect(splitGross(123.99, 19)).toEqual({ net: 104.19, vat: 19.8 });
    expect(splitGross(50, 0)).toEqual({ net: 50, vat: 0 });
  });

  it('baut Positionen mit Stückpreis, Versand und Summen', async () => {
    const d = buildInvoiceData(order(), SELLER, { number: 'RE-2026-0001', date: '2026-09-21T00:00:00Z', vatRate: 19 });
    expect(d.lines).toEqual([
      { description: 'Kaffeemaschine (Art.-Nr. LG-1)', quantity: 2, unitGross: 59.5, totalGross: 119 },
      { description: 'Versandkosten', quantity: 1, unitGross: 4.99, totalGross: 4.99 },
    ]);
    expect(d).toMatchObject({ totalGross: 123.99, totalNet: 104.19, totalVat: 19.8, vatRate: 19, kleinunternehmer: false });
    expect(d.seller.addressLines).toEqual(['Hauptstr. 1', '12345 Musterstadt', 'Deutschland']);
  });

  it('weist als Kleinunternehmer keine USt aus', async () => {
    const d = buildInvoiceData(order(), { ...SELLER, kleinunternehmer: true }, { number: 'X', date: '2026-09-21', vatRate: 19 });
    expect(d).toMatchObject({ vatRate: 0, totalVat: 0, totalNet: 123.99, kleinunternehmer: true });
  });

  it('kehrt beim Storno alle Beträge um und verweist aufs Original', async () => {
    const d = buildInvoiceData(order(), SELLER, { number: 'RE-2026-0001', date: '2026-09-21', vatRate: 19 });
    const s = buildStornoData(d, { number: 'RE-2026-0002', date: '2026-09-22' });
    expect(s).toMatchObject({ kind: 'storno', cancels: 'RE-2026-0001', totalGross: -123.99, totalVat: -19.8 });
    expect(s.lines[0].totalGross).toBe(-119);
  });

  it('nennt fehlende Pflichtangaben', async () => {
    expect(missingSellerData({})).toEqual(['Firmenname', 'Straße', 'PLZ', 'Ort', 'Steuernummer oder USt-IdNr.']);
    expect(missingSellerData({ ...SELLER, taxNumber: undefined, vatId: 'DE123' })).toEqual([]);
  });

  it('füllt Platzhalter im E-Mail-Text', async () => {
    const d = buildInvoiceData(order(), SELLER, { number: 'RE-1', date: '2026-09-21', vatRate: 19 });
    expect(fillTemplate('{name}: {nummer} / {bestellnummer}', d)).toBe('Erika Muster: RE-1 / 12-34567-89012');
  });
});

describe('mapOrder', () => {
  it('liest Käufer, Positionen, Versand und Rabatt aus der Fulfillment API', async () => {
    const o = mapOrder({
      orderId: '99', creationDate: '2026-09-01T08:00:00.000Z', orderPaymentStatus: 'PAID',
      cancelStatus: { cancelState: 'NONE_REQUESTED' },
      buyer: { username: 'max', buyerRegistrationAddress: { fullName: 'Max M', email: 'max@x.de',
        contactAddress: { addressLine1: 'Str. 1', city: 'Wien', postalCode: '1010', countryCode: 'AT' } } },
      pricingSummary: { deliveryCost: { value: '5.00' }, priceDiscount: { value: '-2.00' }, total: { value: '48.00', currency: 'EUR' } },
      paymentSummary: { payments: [{ paymentDate: '2026-09-01T08:01:00.000Z' }] },
      lineItems: [{ title: 'Ding', sku: 'A', legacyItemId: '123', quantity: 3, lineItemCost: { value: '45.00' } }],
    });
    expect(o).toMatchObject({
      orderId: '99', paid: true, cancelled: false, buyerUsername: 'max', buyerEmail: 'max@x.de',
      buyer: { name: 'Max M', lines: ['Str. 1', '1010 Wien', 'Österreich'] },
      items: [{ title: 'Ding', sku: 'A', itemId: '123', quantity: 3, totalGross: 45 }],
      shippingGross: 5, discountGross: 2, paidAt: '2026-09-01T08:01:00.000Z',
    });
  });

  it('nimmt ohne Registrierungsadresse die Lieferadresse', async () => {
    const o = mapOrder({ orderId: '1', orderPaymentStatus: 'PENDING', buyer: { username: 'u' },
      fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: 'Lieferung', contactAddress: { addressLine1: 'A 1', postalCode: '1', city: 'B', countryCode: 'DE' } } } }] });
    expect(o.buyer).toEqual({ name: 'Lieferung', lines: ['A 1', '1 B'] });
    expect(o.paid).toBe(false);
  });
});

describe('Nummernkreis und Ablauf', () => {
  const now = new Date('2026-09-21T12:00:00Z');

  it('vergibt lückenlose Nummern je Jahr und verhindert doppelte Rechnungen', async () => {
    const d = await db();
    expect((await createInvoice(d, order('A'), now)).number).toBe('RE-2026-0001');
    expect((await createInvoice(d, order('B'), now)).number).toBe('RE-2026-0002');
    await expect(createInvoice(d, order('A'), now)).rejects.toThrow(/schon eine Rechnung/);
    expect((await createInvoice(d, order('C'), new Date('2027-01-02T12:00:00Z'))).number).toBe('RE-2027-0001');
  });

  it('beginnt bei der eingestellten Startnummer', async () => {
    const d = await db();
    await saveInvoiceSettings(d, { ...SELLER, startNumber: 150, startNumberYear: 2026 });
    expect((await createInvoice(d, order('A'), now)).number).toBe('RE-2026-0150');
  });

  it('storniert per Stornorechnung und erlaubt danach eine neue Rechnung', async () => {
    const d = await db();
    const inv = await createInvoice(d, order('A'), now);
    const storno = await cancelInvoice(d, inv.id, now);
    expect(storno).toMatchObject({ kind: 'storno', number: 'RE-2026-0002' });
    expect((await getInvoice(d, inv.id))?.cancelledById).toBe(storno.id);
    await expect(cancelInvoice(d, inv.id, now)).rejects.toThrow(/bereits storniert/);
    expect((await createInvoice(d, order('A'), now)).number).toBe('RE-2026-0003');
  });

  it('verweigert Rechnungen in der Sandbox und ohne Absenderdaten', async () => {
    const d = await db();
    await setSetting(d, 'env', 'sandbox');
    await expect(createInvoice(d, order(), now)).rejects.toThrow(/Production/);
    await setSetting(d, 'env', 'production');
    await saveInvoiceSettings(d, {});
    await expect(createInvoice(d, order(), now)).rejects.toThrow(/Firmenname/);
  });

  it('rechnet in der Automatik nur bezahlte, offene Bestellungen ab und verschickt sie', async () => {
    const d = await db();
    await saveInvoiceSettings(d, { ...SELLER, autoCreate: true, autoSend: true, startDate: '2026-09-01T00:00:00Z' });
    await saveToken(d, 'production', 'user', { accessToken: 'a', accessExpiresAt: '2099-01-01', refreshToken: 'r' });
    const sent: MailInput[] = [];
    let since = '';
    const deps = {
      now: () => now,
      fetchOrders: async (s: string) => {
        since = s;
        return [order('A'), order('B', { paid: false }), order('C', { cancelled: true }), order('D', { buyerEmail: undefined })];
      },
      mailer: () => async (m: MailInput) => { sent.push(m); },
    };
    const status = await syncInvoices(d, deps);
    expect(since).toBe('2026-09-01T00:00:00Z');
    expect(status).toMatchObject({ created: 2, sent: 1 });
    expect(sent[0].to).toBe('erika@example.de');
    expect(sent[0].attachment?.filename).toBe('Rechnung_RE-2026-0001.pdf');
    expect((await listInvoices(d)).map((i) => i.orderId).sort()).toEqual(['A', 'D']);
    expect(await openOrders(d, deps)).toEqual([]);
    expect((await syncInvoices(d, deps)).created).toBe(0);
  });

  it('merkt sich Versandfehler an der Rechnung', async () => {
    const d = await db();
    const inv = await createInvoice(d, order('A'), now);
    await expect(sendInvoice(d, inv.id, undefined, async () => { throw new Error('Mailserver weg'); })).rejects.toThrow(/Mailserver/);
    expect((await getInvoice(d, inv.id))?.emailError).toBe('Mailserver weg');
    await sendInvoice(d, inv.id, 'neu@example.de', async () => {});
    expect(await getInvoice(d, inv.id)).toMatchObject({ emailTo: 'neu@example.de', emailError: undefined });
  });
});

describe('PDF', () => {
  it('erzeugt ein lesbares PDF, auch mit Sonderzeichen und langen Titeln', async () => {
    const d = buildInvoiceData(
      order('A', { items: [{ title: 'Łódź Kaffeemaschine 😀 ' + 'Superlangertitelohneleerzeichen'.repeat(6), quantity: 1, totalGross: 10 }] }),
      { ...SELLER, footerText: 'IBAN DE00 1234 5678 9012 3456 78\nAmtsgericht Musterstadt' },
      { number: 'RE-2026-0001', date: '2026-09-21', vatRate: 19 }
    );
    const bytes = await renderInvoicePdf(d);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Rechnung RE-2026-0001');
  });

  it('bricht viele Positionen auf mehrere Seiten um', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ title: `Artikel ${i + 1}`, quantity: 1, totalGross: 1 }));
    const bytes = await renderInvoicePdf(buildInvoiceData(order('A', { items }), SELLER, { number: 'X', date: '2026-09-21', vatRate: 19 }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it('ersetzt Zeichen außerhalb der Standardschrift', async () => {
    expect(safe('Łódź Straße 5 € 😀')).toBe('?ódz Straße 5 € ?');
  });
});

describe('mergeInvoiceSettings', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  it('setzt beim Einschalten der Automatik den Startzeitpunkt nur einmal', async () => {
    const a = mergeInvoiceSettings({}, { autoCreate: true }, now);
    expect(a.startDate).toBe(now.toISOString());
    expect(mergeInvoiceSettings(a, { autoCreate: true }, new Date('2027-01-01')).startDate).toBe(now.toISOString());
  });

  it('übernimmt das Absender-Postfach, verwirft den alten SMTP-Zugang und prüft Eingaben', async () => {
    // Der frühere eigene SMTP-Zugang fällt beim Speichern weg – versendet wird über die Postfächer des Hauptsystems.
    const cur: InvoiceSettings = { smtp: { host: 'h', pass: 'geheim' }, companyName: 'A' };
    const next = mergeInvoiceSettings(cur, { senderMailboxId: ' 7f1c ' });
    expect(next.smtp).toBeUndefined();
    expect(next).toMatchObject({ senderMailboxId: '7f1c', companyName: 'A' });
    expect(mergeInvoiceSettings(next, { senderMailboxId: '' }).senderMailboxId).toBeUndefined();
    expect(() => mergeInvoiceSettings({}, { vatRate: 150 })).toThrow(/USt-Satz/);
    expect(() => mergeInvoiceSettings({}, { prefix: 'RE/' })).toThrow(/Präfix/);
    expect(mergeInvoiceSettings({}, { startNumber: '42' }, now)).toMatchObject({ startNumber: 42, startNumberYear: 2026 });
  });
});
