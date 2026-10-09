import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { openMemoryDb } from '@/lib/ebay/db/memory';
import { buildB2bInvoiceData, checkB2bInput, computeB2b, suggestTaxCase, type B2bInput } from '@/lib/ebay/invoices/b2b';
import { buildStornoData } from '@/lib/ebay/invoices/build';
import { buildCiiXml, unitCode } from '@/lib/ebay/invoices/einvoice';
import { deriveNumbering, formatNumber, validNumberFormat, yearlyNumbers } from '@/lib/ebay/invoices/numbering';
import { renderInvoicePdf } from '@/lib/ebay/invoices/pdf';
import { insertInvoice, nextSeq } from '@/lib/ebay/invoices/store';
import type { InvoiceSettings } from '@/lib/ebay/invoices/types';
import { mergeInvoiceSettings } from '@/lib/ebay/routes/invoices';

const SELLER: InvoiceSettings = {
  companyName: 'Testhandel GmbH', street: 'Hauptstr. 1', postalCode: '01067', city: 'Dresden', country: 'Deutschland',
  taxNumber: '201/123/45678', vatId: 'DE123456789', email: 'buchhaltung@testhandel.example', iban: 'DE02120300000000202051', bic: 'BYLADEM1001', bankName: 'Testbank',
};

function input(extra: Partial<B2bInput> = {}): B2bInput {
  return {
    buyer: { name: 'Kunde & Co. KG', contact: 'Frau Muster', street: 'Industriestr. 5', zip: '04109', city: 'Leipzig', country: 'DE', email: 'einkauf@kunde.example' },
    taxCase: 'domestic',
    serviceDate: '2026-10-05',
    paymentDays: 14,
    reference: 'PO-4711',
    lines: [
      { description: 'Haarshampoo 250 ml', quantity: 24, unit: 'Stk', unitNet: 3.35, vatRate: 19 },
      { description: 'Fachbuch Haarpflege', quantity: 2, unit: 'Stk', unitNet: 19.99, vatRate: 7 },
    ],
    ...extra,
  };
}

describe('Nummernkreis aus Stotax übernehmen', () => {
  it('leitet Format und nächste Nummer aus der letzten Nummer ab', () => {
    expect(deriveNumbering('2026-0815')).toEqual({ numberFormat: '{JJJJ}-{NR:4}', nextNumber: 816, year: 2026 });
    expect(deriveNumbering('RE-123')).toEqual({ numberFormat: 'RE-{NR:3}', nextNumber: 124, year: null });
    expect(deriveNumbering('R2026/045')).toEqual({ numberFormat: 'R{JJJJ}/{NR:3}', nextNumber: 46, year: 2026 });
    expect(deriveNumbering('RG-2025-7-A')).toEqual({ numberFormat: 'RG-{JJJJ}-{NR}-A', nextNumber: 8, year: 2025 });
    expect(deriveNumbering('10045')).toEqual({ numberFormat: '{NR:5}', nextNumber: 10046, year: null });
    expect(deriveNumbering('')).toBeNull();
    expect(deriveNumbering('ohne Ziffern')).toBeNull();
    expect(deriveNumbering('RE {1}')).toBeNull();
  });

  it('Format rückwärts ergibt wieder die letzte Nummer', () => {
    for (const last of ['2026-0815', 'RE-123', 'R2026/045', 'RE-2026-0001', '10045', 'AB.2026.12']) {
      const d = deriveNumbering(last)!;
      expect(formatNumber({ numberFormat: d.numberFormat }, d.year ?? 2026, d.nextNumber - 1)).toBe(last);
    }
  });

  it('Standard bleibt Präfix-Jahr-Nummer; ohne {JJJJ} läuft die Nummer durch', () => {
    expect(formatNumber({}, 2026, 7)).toBe('RE-2026-0007');
    expect(formatNumber({ prefix: 'LG-' }, 2026, 12)).toBe('LG-2026-0012');
    expect(formatNumber({ numberFormat: 'RE-{NR:3}' }, 2027, 1240)).toBe('RE-1240');
    expect(yearlyNumbers({})).toBe(true);
    expect(yearlyNumbers({ numberFormat: 'RE-{NR}' })).toBe(false);
    expect(validNumberFormat('{JJJJ}-{NR:4}')).toBe(true);
    expect(validNumberFormat('RE-{NR}-{NR}')).toBe(false);
    expect(validNumberFormat('RE-{JAHR}-{NR}')).toBe(false);
  });

  it('nächste Nummer: jährlich ab Startnummer, durchlaufend über alle Jahre', async () => {
    const d = openMemoryDb();
    const yearly: InvoiceSettings = { ...SELLER, numberFormat: '{JJJJ}-{NR:4}', startNumber: 816, startNumberYear: 2026 };
    expect(await nextSeq(d, 2026, yearly)).toBe(816);
    expect(await nextSeq(d, 2027, yearly)).toBe(1);
    const cont: InvoiceSettings = { ...SELLER, numberFormat: 'RE-{NR}', startNumber: 124, startNumberYear: 2025 };
    expect(await nextSeq(d, 2026, cont)).toBe(124);
    const inv = await insertInvoice(d, { env: 'production', settings: cont, date: new Date('2026-12-30T10:00:00Z'), orderId: 'B2B-1', build: (number) => buildB2bInvoiceData(input(), cont, { number, date: '2026-12-30T10:00:00Z', orderId: 'B2B-1' }) });
    expect(inv.number).toBe('RE-124');
    // Neues Jahr: läuft weiter, nicht wieder bei 1.
    expect(await nextSeq(d, 2027, cont)).toBe(125);
  });

  it('Speichern im eBay-Tool lässt das übernommene Format und das Startjahr stehen', () => {
    const cur: InvoiceSettings = { ...SELLER, numberFormat: '{JJJJ}-{NR:4}', startNumber: 816, startNumberYear: 2025 };
    const next = mergeInvoiceSettings(cur, { prefix: 'RE-', startNumber: 816, companyName: 'Testhandel GmbH' }, new Date('2026-01-10T10:00:00Z'));
    expect(next.numberFormat).toBe('{JJJJ}-{NR:4}');
    expect(next.startNumberYear).toBe(2025);
    expect(mergeInvoiceSettings(cur, { prefix: 'LG-' }).numberFormat).toBeUndefined();
  });
});

describe('B2B-Rechnung', () => {
  it('rechnet netto je Zeile und die USt je Satz aus der Summe', () => {
    const c = computeB2b(input(), false);
    expect(c.lines[0].totalNet).toBe(80.4);
    expect(c.vat).toEqual([{ rate: 19, net: 80.4, vat: 15.28 }, { rate: 7, net: 39.98, vat: 2.8 }]);
    expect(c).toMatchObject({ totalNet: 120.38, totalVat: 18.08, totalGross: 138.46 });
  });

  it('steuerfreie Fälle und Kleinunternehmer: 0 %', () => {
    expect(computeB2b(input({ taxCase: 'eu_supply' }), false).totalVat).toBe(0);
    expect(computeB2b(input(), true).vat).toEqual([{ rate: 0, net: 120.38, vat: 0 }]);
  });

  it('schlägt den Steuerfall aus Land und USt-IdNr. vor', () => {
    expect(suggestTaxCase('DE', 'DE999')).toBe('domestic');
    expect(suggestTaxCase('AT', 'ATU12345678')).toBe('eu_supply');
    expect(suggestTaxCase('AT', '')).toBe('domestic');
    expect(suggestTaxCase('CH')).toBe('export');
  });

  it('prüft Pflichtangaben je Steuerfall', () => {
    expect(checkB2bInput(input(), SELLER)).toEqual([]);
    const eu = checkB2bInput(input({ taxCase: 'eu_supply', buyer: { ...input().buyer, country: 'AT' } }), { ...SELLER, vatId: undefined });
    expect(eu.join(' ')).toMatch(/USt-IdNr\. des Kunden Pflicht/);
    expect(eu.join(' ')).toMatch(/deine eigene USt-IdNr\. Pflicht/);
    expect(checkB2bInput(input({ taxCase: 'export', buyer: { ...input().buyer, country: 'NL' } }), SELLER).join(' ')).toMatch(/außerhalb der EU/);
    expect(checkB2bInput(input({ lines: [] }), SELLER).join(' ')).toMatch(/Mindestens eine Position/);
    expect(checkB2bInput(input(), { companyName: 'X' }).join(' ')).toMatch(/Absenderdaten fehlen/);
  });

  it('baut den Rechnungsinhalt mit Fälligkeit, Bank und Anschrift', () => {
    const d = buildB2bInvoiceData(input({ buyer: { ...input().buyer, country: 'AT', vatId: 'atu 12345678' }, taxCase: 'eu_supply' }), SELLER, { number: '2026-0816', date: '2026-10-09T09:00:00Z', orderId: 'B2B-x' });
    expect(d.b2b).toMatchObject({ dueDate: '2026-10-23', buyerVatId: 'ATU12345678', buyerCountry: 'AT', bank: { iban: 'DE02120300000000202051' } });
    expect(d.buyer.lines).toEqual(['z. Hd. Frau Muster', 'Industriestr. 5', '04109 Leipzig', 'Österreich']);
    expect(d.totalGross).toBe(120.38);
  });

  it('Storno dreht Netto-Positionen und Steuer um', () => {
    const d = buildB2bInvoiceData(input(), SELLER, { number: '2026-0816', date: '2026-10-09T09:00:00Z', orderId: 'B2B-x' });
    const s = buildStornoData(d, { number: '2026-0817', date: '2026-10-10T09:00:00Z' });
    expect(s.b2b!.lines[0].totalNet).toBe(-80.4);
    expect(s.b2b!.vat[0]).toMatchObject({ net: -80.4, vat: -15.28 });
    expect(s.totalGross).toBe(-138.46);
  });
});

describe('E-Rechnung (EN 16931, CII)', () => {
  const d = buildB2bInvoiceData(input(), SELLER, { number: '2026-0816', date: '2026-10-09T09:00:00Z', orderId: 'B2B-x' });

  it('enthält Kopf, Parteien, Positionen, Steuer je Satz und Summen', () => {
    const x = buildCiiXml(d);
    expect(x).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(x).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(x).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(x).toContain('<udt:DateTimeString format="102">20261009</udt:DateTimeString>');
    expect(x).toContain('<ram:Name>Kunde &amp; Co. KG</ram:Name>');
    expect(x).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>');
    expect(x).toContain('<ram:ID schemeID="FC">201/123/45678</ram:ID>');
    expect(x).toContain('<ram:BilledQuantity unitCode="H87">24</ram:BilledQuantity>');
    expect(x).toContain('<ram:CalculatedAmount>15.28</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>80.40</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>');
    expect(x).toContain('<ram:RateApplicablePercent>7.00</ram:RateApplicablePercent>');
    expect(x).toContain('<ram:LineTotalAmount>120.38</ram:LineTotalAmount>');
    expect(x).toContain('<ram:TaxTotalAmount currencyID="EUR">18.08</ram:TaxTotalAmount>');
    expect(x).toContain('<ram:GrandTotalAmount>138.46</ram:GrandTotalAmount>');
    expect(x).toContain('<ram:IBANID>DE02120300000000202051</ram:IBANID>');
    expect(x).toContain('<ram:DueDateDateTime><udt:DateTimeString format="102">20261023</udt:DateTimeString></ram:DueDateDateTime>');
    expect(x).toContain('<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>PO-4711</ram:IssuerAssignedID>');
    // Reihenfolge laut Schema: Positionen vor Vereinbarung, Lieferung, Abrechnung.
    expect(x.indexOf('IncludedSupplyChainTradeLineItem')).toBeLessThan(x.indexOf('ApplicableHeaderTradeAgreement'));
    expect(x.indexOf('ApplicableHeaderTradeDelivery')).toBeLessThan(x.indexOf('ApplicableHeaderTradeSettlement'));
    expect(x.indexOf('SpecifiedTradeSettlementPaymentMeans')).toBeLessThan(x.indexOf('<ram:ApplicableTradeTax><ram:CalculatedAmount>'));
  });

  it('innergemeinschaftliche Lieferung: Kategorie K mit Befreiungsgrund und Lieferland', () => {
    const eu = buildB2bInvoiceData(input({ buyer: { ...input().buyer, country: 'AT', vatId: 'ATU12345678' }, taxCase: 'eu_supply' }), SELLER, { number: 'X-1', date: '2026-10-09T09:00:00Z', orderId: 'B2B-y' });
    const x = buildCiiXml(eu);
    expect(x).toContain('<ram:ExemptionReason>Steuerfreie innergemeinschaftliche Lieferung</ram:ExemptionReason>');
    expect(x).toContain('<ram:CategoryCode>K</ram:CategoryCode><ram:ExemptionReasonCode>VATEX-EU-IC</ram:ExemptionReasonCode>');
    expect(x).toContain('<ram:ShipToTradeParty>');
    expect(x).toContain('<ram:ID schemeID="VA">ATU12345678</ram:ID>');
    expect(x).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>');
  });

  it('Storno als Gutschrift 381 mit positiven Beträgen und Bezug', () => {
    const s = buildStornoData(d, { number: '2026-0817', date: '2026-10-10T09:00:00Z' });
    const x = buildCiiXml(s);
    expect(x).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(x).toContain('<ram:GrandTotalAmount>138.46</ram:GrandTotalAmount>');
    expect(x).toContain('<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>2026-0816</ram:IssuerAssignedID>');
    expect(x).not.toContain('DueDateDateTime');
  });

  it('Rabattzeile: Preis nie negativ, stattdessen negative Menge', () => {
    const r = buildB2bInvoiceData(input({ lines: [...input().lines, { description: 'Rabatt', quantity: 1, unit: 'pauschal', unitNet: -10, vatRate: 19 }] }), SELLER, { number: 'X-2', date: '2026-10-09T09:00:00Z', orderId: 'B2B-z' });
    const x = buildCiiXml(r);
    expect(x).toContain('<ram:ChargeAmount>10.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>\n<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="LS">-1</ram:BilledQuantity>');
    expect(unitCode('Stück')).toBe('H87');
    expect(unitCode('Std.')).toBe('HUR');
    expect(unitCode('Dose')).toBe('C62');
  });
});

describe('PDF der B2B-Rechnung', () => {
  it('zeigt Netto-Positionen, USt je Satz, Fälligkeit und Bankverbindung', async () => {
    const d = buildB2bInvoiceData(input(), SELLER, { number: '2026-0816', date: '2026-10-09T09:00:00Z', orderId: 'B2B-x' });
    const pdf = await renderInvoicePdf(d);
    const { text } = await extractText(await getDocumentProxy(pdf), { mergePages: true });
    const t = (Array.isArray(text) ? text.join(' ') : text).replace(/\s+/g, ' ');
    for (const s of ['Rechnung', '2026-0816', 'Liefer-/Leistungsdatum', '05.10.2026', 'Preis netto', 'Ihre Referenz', 'PO-4711', 'Fällig am', '23.10.2026', 'zzgl. USt 19 % auf 80,40 €', '15,28 €', 'zzgl. USt 7 %', 'Rechnungsbetrag', '138,46 €', 'IBAN DE02 1203 0000 0000 2020 51', 'Verwendungszweck: 2026-0816']) {
      expect(t).toContain(s);
    }
    expect(t).not.toContain('eBay');
  });

  it('EU-Lieferung nennt die Steuerbefreiung und beide USt-IdNr.', async () => {
    const d = buildB2bInvoiceData(input({ buyer: { ...input().buyer, country: 'AT', vatId: 'ATU12345678' }, taxCase: 'eu_supply' }), SELLER, { number: 'X-1', date: '2026-10-09T09:00:00Z', orderId: 'B2B-y' });
    const { text } = await extractText(await getDocumentProxy(await renderInvoicePdf(d)), { mergePages: true });
    const t = (Array.isArray(text) ? text.join(' ') : text).replace(/\s+/g, ' ');
    expect(t).toContain('Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1 Buchst. b');
    expect(t).toContain('USt-IdNr. Empfänger: ATU12345678 (Österreich)');
  });
});
