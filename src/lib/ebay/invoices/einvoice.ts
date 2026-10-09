import { COUNTRY_NAMES, taxNote } from './b2b';
import type { InvoiceData, TaxCase } from './types';

/*
 * E-Rechnung nach EN 16931 in der Syntax UN/CEFACT CII (wie ZUGFeRD/Factur-X Profil EN16931).
 * Seit 2025 müssen Firmen E-Rechnungen empfangen können; ab 2027/2028 sind sie im Inland
 * zwischen Unternehmen Pflicht. Nur für B2B-Rechnungen – Privatkunden (eBay) brauchen keine.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const qty = (n: number) => String(Math.round(n * 10000) / 10000);
const day = (iso: string) => iso.slice(0, 10).replaceAll('-', '');
const date102 = (iso: string) => `<udt:DateTimeString format="102">${day(iso)}</udt:DateTimeString>`;

/** Einheit → UN/ECE-Code (Rec. 20). */
export function unitCode(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, '');
  if (/^(stk|stück|stck|st)$/.test(u)) return 'H87';
  if (/^(std|h|stunde|stunden)$/.test(u)) return 'HUR';
  if (u === 'kg') return 'KGM';
  if (u === 'g') return 'GRM';
  if (/^(m|meter)$/.test(u)) return 'MTR';
  if (/^(l|liter)$/.test(u)) return 'LTR';
  if (/^(karton|kt|ktn)$/.test(u)) return 'CT';
  if (/^(paket|pkt|pck)$/.test(u)) return 'PK';
  if (/^(pal|palette)$/.test(u)) return 'PF';
  if (/^(pauschal|psch|pausch)$/.test(u)) return 'LS';
  return 'C62';
}

type Category = { code: 'S' | 'Z' | 'E' | 'K' | 'AE' | 'G'; reason?: string; reasonCode?: string };

export function vatCategory(taxCase: TaxCase, kleinunternehmer: boolean, rate: number): Category {
  if (kleinunternehmer) return { code: 'E', reason: 'Kleinunternehmer gemäß § 19 UStG' };
  if (taxCase === 'eu_supply') return { code: 'K', reason: 'Steuerfreie innergemeinschaftliche Lieferung', reasonCode: 'VATEX-EU-IC' };
  if (taxCase === 'reverse_charge') return { code: 'AE', reason: 'Umkehrung der Steuerschuldnerschaft', reasonCode: 'VATEX-EU-AE' };
  if (taxCase === 'export') return { code: 'G', reason: 'Steuerfreie Ausfuhrlieferung', reasonCode: 'VATEX-EU-G' };
  return { code: rate > 0 ? 'S' : 'Z' };
}

const countryIso = (name: string | undefined) => {
  const n = (name ?? '').trim();
  if (/^[A-Z]{2}$/.test(n)) return n;
  return Object.entries(COUNTRY_NAMES).find(([, v]) => v.toLowerCase() === n.toLowerCase())?.[0] ?? 'DE';
};

/** E-Rechnung (CII-XML) zu einer B2B-Rechnung oder ihrem Storno (als Gutschrift 381 mit Bezug). */
export function buildCiiXml(inv: InvoiceData): string {
  const b = inv.b2b;
  if (!b) throw new Error('E-Rechnung gibt es nur für B2B-Rechnungen.');
  const storno = inv.kind === 'storno';
  // Storno als Gutschrift: Beträge positiv, Verweis auf die Originalrechnung.
  const sg = storno ? -1 : 1;
  const s = inv.seller;
  const [sellerZip, ...sellerCity] = (s.addressLines[1] ?? '').split(' ');
  const sellerCountry = countryIso(s.addressLines[2]);
  const a = b.buyerAddress;
  const notes = [taxNote(b.taxCase, inv.kleinunternehmer), storno && inv.cancels ? `Storno zur Rechnung ${inv.cancels}.` : null, b.note ?? null].filter((x): x is string => Boolean(x));

  const lines = b.lines
    .map((l, i) => {
      // Preis darf nicht negativ sein (BR-27): Rabattzeilen über negative Menge.
      let price = l.unitNet * sg;
      let q = l.quantity;
      if (price < 0) {
        price = -price;
        q = -q;
      }
      const cat = vatCategory(b.taxCase, inv.kleinunternehmer, l.vatRate);
      return `<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct><ram:Name>${esc(l.description)}</ram:Name></ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(l.unit)}">${qty(q)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement>
<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat.code}</ram:CategoryCode><ram:RateApplicablePercent>${amt(l.vatRate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.totalNet * sg)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
</ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join('\n');

  const taxes = b.vat
    .map((v) => {
      const cat = vatCategory(b.taxCase, inv.kleinunternehmer, v.rate);
      return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(v.vat * sg)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${cat.reason ? `<ram:ExemptionReason>${esc(cat.reason)}</ram:ExemptionReason>` : ''}<ram:BasisAmount>${amt(v.net * sg)}</ram:BasisAmount><ram:CategoryCode>${cat.code}</ram:CategoryCode>${cat.reasonCode ? `<ram:ExemptionReasonCode>${cat.reasonCode}</ram:ExemptionReasonCode>` : ''}<ram:RateApplicablePercent>${amt(v.rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
    })
    .join('\n');

  const sellerTax = [s.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(s.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : '', s.taxNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(s.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''].join('');
  const buyerAddressXml = `<ram:PostalTradeAddress>${a ? `<ram:PostcodeCode>${esc(a.zip)}</ram:PostcodeCode><ram:LineOne>${esc(a.street)}</ram:LineOne><ram:CityName>${esc(a.city)}</ram:CityName>` : ''}<ram:CountryID>${b.buyerCountry}</ram:CountryID></ram:PostalTradeAddress>`;
  const lineTotal = b.lines.reduce((sum, l) => sum + l.totalNet * sg, 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${esc(inv.number)}</ram:ID>
<ram:TypeCode>${storno ? '381' : '380'}</ram:TypeCode>
<ram:IssueDateTime>${date102(inv.date)}</ram:IssueDateTime>
${notes.map((n) => `<ram:IncludedNote><ram:Content>${esc(n)}</ram:Content></ram:IncludedNote>`).join('\n')}
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lines}
<ram:ApplicableHeaderTradeAgreement>
${b.reference ? `<ram:BuyerReference>${esc(b.reference)}</ram:BuyerReference>` : ''}
<ram:SellerTradeParty>
<ram:Name>${esc(s.companyName)}</ram:Name>
<ram:PostalTradeAddress><ram:PostcodeCode>${esc(sellerZip ?? '')}</ram:PostcodeCode><ram:LineOne>${esc(s.addressLines[0] ?? '')}</ram:LineOne><ram:CityName>${esc(sellerCity.join(' '))}</ram:CityName><ram:CountryID>${sellerCountry}</ram:CountryID></ram:PostalTradeAddress>
${s.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(s.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
${sellerTax}
</ram:SellerTradeParty>
<ram:BuyerTradeParty>
${b.customerNumber ? `<ram:ID>${esc(b.customerNumber)}</ram:ID>` : ''}
<ram:Name>${esc(inv.buyer.name)}</ram:Name>
${a?.contact ? `<ram:DefinedTradeContact><ram:PersonName>${esc(a.contact)}</ram:PersonName></ram:DefinedTradeContact>` : ''}
${buyerAddressXml}
${b.buyerEmail ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(b.buyerEmail)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
${b.buyerVatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(b.buyerVatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
</ram:BuyerTradeParty>
${b.reference ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${esc(b.reference)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>
${b.taxCase === 'eu_supply' || b.taxCase === 'export' ? `<ram:ShipToTradeParty><ram:Name>${esc(inv.buyer.name)}</ram:Name>${buyerAddressXml}</ram:ShipToTradeParty>` : ''}
<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date102(b.serviceDate)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:PaymentReference>${esc(inv.number)}</ram:PaymentReference>
<ram:InvoiceCurrencyCode>${inv.currency}</ram:InvoiceCurrencyCode>
${b.bank?.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(b.bank.iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${b.bank.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(b.bank.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
${taxes}
${b.serviceDateTo ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime>${date102(b.serviceDate)}</ram:StartDateTime><ram:EndDateTime>${date102(b.serviceDateTo)}</ram:EndDateTime></ram:BillingSpecifiedPeriod>` : ''}
${storno ? '' : `<ram:SpecifiedTradePaymentTerms><ram:Description>${esc(b.paymentDays === 0 ? 'Zahlbar sofort ohne Abzug' : `Zahlbar ohne Abzug innerhalb von ${b.paymentDays} Tagen`)}</ram:Description><ram:DueDateDateTime>${date102(b.dueDate)}</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${amt(lineTotal)}</ram:LineTotalAmount>
<ram:TaxBasisTotalAmount>${amt(inv.totalNet * sg)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="${inv.currency}">${amt(inv.totalVat * sg)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${amt(inv.totalGross * sg)}</ram:GrandTotalAmount>
<ram:DuePayableAmount>${amt(inv.totalGross * sg)}</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${storno && inv.cancels ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(inv.cancels)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/\n\s*\n/g, '\n');
}
