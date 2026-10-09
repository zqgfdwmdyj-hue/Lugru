import { roundCents } from '../pipeline/money';
import { missingSellerData } from './build';
import type { B2bDetails, B2bLine, InvoiceData, InvoiceLine, InvoiceSettings, TaxCase } from './types';

/*
 * Rechnungen an Firmenkunden, frei geschrieben: Preise netto, Umsatzsteuer je Satz, Liefer-/
 * Leistungsdatum, Zahlungsziel und Steuerfall (§ 14 UStG). Gleicher Nummernkreis und gleiche
 * Tabelle wie die eBay-Rechnungen – eine lückenlose Folge für die Buchhaltung.
 */

export const EU_COUNTRIES = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];

export const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', NL: 'Niederlande', BE: 'Belgien', LU: 'Luxemburg', FR: 'Frankreich', IT: 'Italien', ES: 'Spanien',
  PL: 'Polen', CZ: 'Tschechien', DK: 'Dänemark', SE: 'Schweden', FI: 'Finnland', IE: 'Irland', PT: 'Portugal', GR: 'Griechenland', HU: 'Ungarn',
  SK: 'Slowakei', SI: 'Slowenien', HR: 'Kroatien', RO: 'Rumänien', BG: 'Bulgarien', EE: 'Estland', LV: 'Lettland', LT: 'Litauen', MT: 'Malta', CY: 'Zypern',
  GB: 'Vereinigtes Königreich', NO: 'Norwegen', US: 'USA', TR: 'Türkei',
};

export const TAX_CASE_LABEL: Record<TaxCase, string> = {
  domestic: 'Inland (mit Umsatzsteuer)',
  eu_supply: 'EU-Firmenkunde: innergemeinschaftliche Lieferung (steuerfrei)',
  reverse_charge: 'EU-Firmenkunde: Leistung, Steuerschuld beim Kunden (§ 13b)',
  export: 'Drittland: Ausfuhrlieferung (steuerfrei)',
};

/** Pflichthinweis auf der Rechnung je Steuerfall. */
export function taxNote(taxCase: TaxCase, kleinunternehmer: boolean): string | null {
  if (kleinunternehmer) return 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';
  if (taxCase === 'eu_supply') return 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1 Buchst. b i. V. m. § 6a UStG.';
  if (taxCase === 'reverse_charge') return 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG) – Reverse Charge.';
  if (taxCase === 'export') return 'Steuerfreie Ausfuhrlieferung gemäß § 4 Nr. 1 Buchst. a i. V. m. § 6 UStG.';
  return null;
}

/*
 * § 13b Abs. 2 Nr. 10 UStG: Lieferungen von Mobilfunkgeräten, Tablet-Computern, Spielekonsolen und
 * integrierten Schaltkreisen (vor Einbau) an Unternehmer im Inland – ab 5.000 € netto für diese
 * Waren in einem wirtschaftlichen Vorgang schuldet der Kunde die Steuer. Andere Positionen derselben
 * Rechnung bleiben normal besteuert. Nicht für Kleinunternehmer.
 */
export const RC13B_THRESHOLD = 5000;
export const RC13B_NOTE = 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b Abs. 2 Nr. 10 UStG.';

/** Vorschlag: Bezeichnung klingt nach Handy, Tablet, Spielekonsole oder Prozessor – nicht nach Zubehör oder Spielen. */
export function looksLikeRc13bGoods(description: string): boolean {
  if (/(hülle|huelle|case\b|cover|kabel|ladeger|netzteil|panzerglas|schutzfolie|folie|halter|controller|spiel(?!ekonsole)|headset|tasche|ständer|staender|ladestation|adapter)/i.test(description)) return false;
  return /\b(i ?phone|smartphones?|handys?|mobiltelefon\w*|galaxy [asz]\d+|pixel \d+|ipad|tablets?|playstation|ps[45]\b|xbox|nintendo switch|switch (oled|lite|2)|spielekonsolen?|konsolen?|steam deck|prozessor\w*|cpu)\b/i.test(description);
}

/** Vorschlag für den Steuerfall aus Land und USt-IdNr. des Kunden. */
export function suggestTaxCase(country: string, buyerVatId?: string | null): TaxCase {
  const c = country.trim().toUpperCase();
  if (!c || c === 'DE') return 'domestic';
  if (EU_COUNTRIES.includes(c)) return buyerVatId?.trim() ? 'eu_supply' : 'domestic';
  return 'export';
}

export interface B2bInput {
  buyer: { name: string; contact?: string; street: string; zip: string; city: string; country: string; vatId?: string; email?: string; customerNumber?: string };
  taxCase: TaxCase;
  serviceDate: string;
  serviceDateTo?: string;
  paymentDays: number;
  reference?: string;
  note?: string;
  lines: { description: string; quantity: number; unit?: string; unitNet: number; vatRate: number; device?: boolean }[];
  /** Teil eines größeren Vorgangs (z. B. Teillieferung), der für § 13b-Ware insgesamt ≥ 5.000 € netto hat. */
  rcWhole?: boolean;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const VAT_ID = /^[A-Z]{2}[A-Z0-9+*.]{2,13}$/;

/** Was an der Eingabe fehlt oder nicht passt – leer heißt: Rechnung kann erstellt werden. */
export function checkB2bInput(input: B2bInput, s: InvoiceSettings): string[] {
  const p: string[] = [];
  const missing = missingSellerData(s);
  if (missing.length) p.push(`Absenderdaten fehlen (Einstellungen → Rechnungen): ${missing.join(', ')}.`);
  const b = input.buyer;
  if (!b.name.trim()) p.push('Firmenname des Kunden fehlt.');
  if (!b.street.trim() || !b.zip.trim() || !b.city.trim()) p.push('Anschrift des Kunden unvollständig (Straße, PLZ, Ort).');
  const country = b.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) p.push('Land bitte als Länderkürzel angeben (z. B. DE, AT, NL).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) p.push('Liefer-/Leistungsdatum fehlt.');
  if (input.serviceDateTo && input.serviceDateTo < input.serviceDate) p.push('Ende des Leistungszeitraums liegt vor dem Beginn.');
  if (!(Number.isInteger(input.paymentDays) && input.paymentDays >= 0 && input.paymentDays <= 365)) p.push('Zahlungsziel bitte in Tagen (0–365).');
  const lines = input.lines.filter((l) => l.description.trim() || l.unitNet);
  if (!lines.length) p.push('Mindestens eine Position eintragen.');
  lines.forEach((l, i) => {
    if (!l.description.trim()) p.push(`Position ${i + 1}: Bezeichnung fehlt.`);
    if (!Number.isFinite(l.quantity) || l.quantity === 0) p.push(`Position ${i + 1}: Menge fehlt.`);
    if (!Number.isFinite(l.unitNet)) p.push(`Position ${i + 1}: Preis fehlt.`);
    if (![0, 7, 19].includes(l.vatRate)) p.push(`Position ${i + 1}: USt-Satz 19, 7 oder 0 %.`);
  });
  const vat = b.vatId?.replace(/\s+/g, '').toUpperCase();
  if (vat && !VAT_ID.test(vat)) p.push('USt-IdNr. des Kunden sieht nicht gültig aus (z. B. ATU12345678).');
  if (input.taxCase === 'eu_supply' || input.taxCase === 'reverse_charge') {
    if (!EU_COUNTRIES.includes(country) || country === 'DE') p.push('Innergemeinschaftlich nur für Kunden in einem anderen EU-Land.');
    if (!vat) p.push('Für die steuerfreie EU-Rechnung ist die USt-IdNr. des Kunden Pflicht.');
    if (!s.vatId?.trim()) p.push('Für die steuerfreie EU-Rechnung ist deine eigene USt-IdNr. Pflicht (Einstellungen → Rechnungen).');
  }
  if (input.taxCase === 'export' && EU_COUNTRIES.includes(country)) p.push('Ausfuhrlieferung nur für Kunden außerhalb der EU.');
  if (computeB2b(input, Boolean(s.kleinunternehmer)).rc13b.applies && !vat) {
    p.push('§ 13b (Handys/Tablets/Konsolen ab 5.000 €): die USt-IdNr. des Kunden muss auf die Rechnung.');
  }
  return p;
}

/** Steuersatz je Position nach Steuerfall (steuerfrei → 0 %). */
const effectiveRate = (rate: number, taxCase: TaxCase, kleinunternehmer: boolean) => (kleinunternehmer || taxCase !== 'domestic' ? 0 : rate);

/**
 * Positionen und Summen: Netto je Zeile, Umsatzsteuer je Satz aus der Summe (keine Rundungscents).
 * § 13b-Ware im Inland ab 5.000 € (oder als Teil eines solchen Vorgangs): diese Zeilen 0 %, Kunde schuldet die Steuer.
 */
export function computeB2b(input: Pick<B2bInput, 'lines' | 'taxCase' | 'rcWhole'>, kleinunternehmer: boolean) {
  const base = input.lines
    .filter((l) => l.description.trim() || l.unitNet)
    .map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity,
      unit: l.unit?.trim() || 'Stk',
      unitNet: roundCents(l.unitNet),
      vatRate: effectiveRate(l.vatRate, input.taxCase, kleinunternehmer),
      totalNet: roundCents(l.quantity * roundCents(l.unitNet)),
      device: Boolean(l.device),
    }));
  const deviceNet = roundCents(base.filter((l) => l.device).reduce((s, l) => s + l.totalNet, 0));
  const applies = input.taxCase === 'domestic' && !kleinunternehmer && deviceNet > 0 && (deviceNet >= RC13B_THRESHOLD || Boolean(input.rcWhole));
  const lines: B2bLine[] = base.map(({ device, ...l }) => ({
    ...l,
    ...(device ? { device: true } : {}),
    ...(device && applies ? { vatRate: 0, rc: true } : {}),
  }));
  const groups = [...new Map(lines.map((l) => [`${l.vatRate}|${l.rc ? 1 : 0}`, { rate: l.vatRate, rc: Boolean(l.rc) }])).values()].sort((a, b) => b.rate - a.rate || Number(a.rc) - Number(b.rc));
  const vat = groups.map(({ rate, rc }) => {
    const net = roundCents(lines.filter((l) => l.vatRate === rate && Boolean(l.rc) === rc).reduce((s, l) => s + l.totalNet, 0));
    return { rate, net, vat: roundCents((net * rate) / 100), ...(rc ? { rc: true } : {}) };
  });
  const totalNet = roundCents(vat.reduce((s, v) => s + v.net, 0));
  const totalVat = roundCents(vat.reduce((s, v) => s + v.vat, 0));
  return { lines, vat, totalNet, totalVat, totalGross: roundCents(totalNet + totalVat), rc13b: { applies, deviceNet } };
}

export function buildB2bInvoiceData(input: B2bInput, s: InvoiceSettings, opts: { number: string; date: string; orderId: string }): InvoiceData {
  const kleinunternehmer = Boolean(s.kleinunternehmer);
  const c = computeB2b(input, kleinunternehmer);
  const b = input.buyer;
  const country = b.country.trim().toUpperCase();
  const due = new Date(`${opts.date.slice(0, 10)}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + input.paymentDays);
  // Brutto-Zeilen nur für Übersichten (eBay-Liste); maßgeblich sind die Netto-Angaben in `b2b`.
  const lines: InvoiceLine[] = c.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitGross: roundCents(l.unitNet * (1 + l.vatRate / 100)),
    totalGross: roundCents(l.totalNet * (1 + l.vatRate / 100)),
  }));
  const b2b: B2bDetails = {
    taxCase: input.taxCase,
    serviceDate: input.serviceDate,
    ...(input.serviceDateTo && input.serviceDateTo !== input.serviceDate ? { serviceDateTo: input.serviceDateTo } : {}),
    dueDate: isoDay(due),
    paymentDays: input.paymentDays,
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    ...(b.customerNumber?.trim() ? { customerNumber: b.customerNumber.trim() } : {}),
    ...(b.vatId?.trim() ? { buyerVatId: b.vatId.replace(/\s+/g, '').toUpperCase() } : {}),
    buyerCountry: country,
    buyerAddress: { street: b.street.trim(), zip: b.zip.trim(), city: b.city.trim(), ...(b.contact?.trim() ? { contact: b.contact.trim() } : {}) },
    ...(b.email?.trim() ? { buyerEmail: b.email.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    lines: c.lines,
    vat: c.vat,
    ...(c.rc13b.applies ? { domesticRc: true } : {}),
    ...(s.iban?.trim() ? { bank: { iban: s.iban.replace(/\s+/g, '').toUpperCase(), bic: s.bic?.trim() || undefined, bankName: s.bankName?.trim() || undefined } } : {}),
  };
  return {
    kind: 'invoice',
    number: opts.number,
    date: opts.date,
    orderId: opts.orderId,
    orderDate: opts.date,
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
    buyer: {
      name: b.name.trim(),
      lines: [b.contact?.trim() ? `z. Hd. ${b.contact.trim()}` : '', b.street.trim(), `${b.zip.trim()} ${b.city.trim()}`, country === 'DE' ? '' : (COUNTRY_NAMES[country] ?? country)].filter(Boolean),
    },
    buyerEmail: b.email?.trim() || undefined,
    currency: 'EUR',
    lines,
    kleinunternehmer,
    vatRate: c.vat.length === 1 ? c.vat[0].rate : Math.max(0, ...c.vat.map((v) => v.rate)),
    totalGross: c.totalGross,
    totalNet: c.totalNet,
    totalVat: c.totalVat,
    b2b,
  };
}

/** Storno einer B2B-Rechnung: Netto-Positionen und Steuer mit umgekehrtem Vorzeichen. */
export function negateB2b(d: B2bDetails): B2bDetails {
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return {
    ...d,
    lines: d.lines.map((l) => ({ ...l, unitNet: neg(l.unitNet), totalNet: neg(l.totalNet) })),
    vat: d.vat.map((v) => ({ ...v, net: neg(v.net), vat: neg(v.vat) })),
  };
}

export const B2B_EMAIL_SUBJECT = 'Rechnung {nummer} von {firma}';
export const B2B_EMAIL_TEXT = 'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Rechnung {nummer} als PDF und als E-Rechnung (XML).\n\nMit freundlichen Grüßen\n{firma}';
