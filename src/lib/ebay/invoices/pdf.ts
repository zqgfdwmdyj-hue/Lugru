import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { COUNTRY_NAMES, RC13B_NOTE, taxNote } from './b2b';
import type { InvoiceData } from './types';

/**
 * Rechnung als PDF (A4). Gebaut mit den PDF-Standardschriften — die brauchen
 * keine eingebettete Schriftdatei, können aber nur den Windows-1252-Zeichensatz
 * (Umlaute, ß und € gehen). Alles andere ersetzt `safe()`.
 */

const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function encodable(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch);
}

/** Text auf den Zeichensatz der Standardschrift bringen: Akzente abstreifen, Rest durch „?" ersetzen. */
export function safe(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC').replace(/[\t\r\n]+/g, ' ')) {
    if (encodable(ch)) out += ch;
    else {
      const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
      out += [...base].every(encodable) && base !== '' ? base : '?';
    }
  }
  return out;
}

export function formatEuro(n: number, currency = 'EUR'): string {
  // Intl setzt geschützte Leerzeichen — im PDF genügt ein normales.
  return n.toLocaleString('de-DE', { style: 'currency', currency }).replace(/[\u00a0\u202f]/g, ' ');
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(text).split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    // Überlange Wörter (z.B. Artikelnummern ohne Leerzeichen) hart umbrechen.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let cut = rest.length;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const A4 = { w: 595.28, h: 841.89 };
const M = { left: 56, right: 48, top: 48, bottom: 90 };
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.82, 0.84, 0.88);

export async function renderInvoicePdf(inv: InvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`${inv.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'} ${inv.number}`));
  doc.setAuthor(safe(inv.seller.companyName));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const right = A4.w - M.right;
  const contentW = right - M.left;

  let page = doc.addPage([A4.w, A4.h]);
  const pages: PDFPage[] = [page];
  let y = A4.h - M.top;

  const text = (t: string, x: number, yy: number, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const s = safe(t);
    const xx = opts.alignRight ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: xx, y: yy, size, font: f, color: opts.color ?? INK });
  };

  // --- Kopf: Absender rechts oben ---
  text(inv.seller.companyName, right, y, { size: 14, f: bold, alignRight: true });
  y -= 16;
  for (const l of [...inv.seller.addressLines, inv.seller.email ?? '', inv.seller.phone ?? ''].filter(Boolean)) {
    text(l, right, y, { size: 9, color: MUTED, alignRight: true });
    y -= 12;
  }

  // --- Anschrift (Fensterposition DIN 5008 ungefähr) ---
  let ay = A4.h - 150;
  text(`${inv.seller.companyName} · ${inv.seller.addressLines.slice(0, 2).join(' · ')}`, M.left, ay, { size: 7, color: MUTED });
  ay -= 16;
  text(inv.buyer.name, M.left, ay, { size: 10.5 });
  for (const l of inv.buyer.lines) {
    ay -= 13;
    text(l, M.left, ay, { size: 10.5 });
  }

  // --- Rechnungsdaten rechts ---
  const b2b = inv.b2b;
  const meta: [string, string][] = b2b
    ? [
        [inv.kind === 'storno' ? 'Stornonummer' : 'Rechnungsnummer', inv.number],
        ['Rechnungsdatum', formatDate(inv.date)],
        [b2b.serviceDateTo ? 'Leistungszeitraum' : 'Liefer-/Leistungsdatum', b2b.serviceDateTo ? `${formatDate(b2b.serviceDate)} – ${formatDate(b2b.serviceDateTo)}` : formatDate(b2b.serviceDate)],
        ...(b2b.customerNumber ? [['Kundennummer', b2b.customerNumber] as [string, string]] : []),
        ...(b2b.reference ? [['Ihre Referenz', b2b.reference] as [string, string]] : []),
        ...(b2b.buyerVatId ? [['USt-IdNr. Kunde', b2b.buyerVatId] as [string, string]] : []),
        ...(inv.kind === 'invoice' ? [['Fällig am', formatDate(b2b.dueDate)] as [string, string]] : []),
      ]
    : [
        [inv.kind === 'storno' ? 'Stornonummer' : 'Rechnungsnummer', inv.number],
        ['Rechnungsdatum', formatDate(inv.date)],
        ['Lieferdatum', 'wie Rechnungsdatum'],
        ['eBay-Bestellnummer', inv.orderId],
        ['Bestelldatum', formatDate(inv.orderDate)],
      ];
  if (inv.buyerUsername) meta.push(['eBay-Mitglied', inv.buyerUsername]);
  let my = A4.h - 166;
  for (const [k, v] of meta) {
    text(k, right - 200, my, { size: 8.5, color: MUTED });
    text(v, right, my, { size: 8.5, alignRight: true });
    my -= 13;
  }

  // --- Titel ---
  y = Math.min(ay, my) - 40;
  text(inv.kind === 'storno' ? 'Stornorechnung' : 'Rechnung', M.left, y, { size: 18, f: bold });
  y -= 18;
  if (inv.kind === 'storno' && inv.cancels) {
    text(`Storno zur Rechnung ${inv.cancels}. Die Rechnung wird hiermit vollständig aufgehoben.`, M.left, y, { size: 9.5, color: MUTED });
    y -= 14;
  }
  y -= 10;

  // --- Positionen (B2B: netto, mit USt-Spalte) ---
  const col = { pos: M.left, qty: M.left + 30, desc: M.left + (b2b ? 78 : 70), vat: right - 150, unit: right - 80, total: right };
  const descW = (b2b ? col.vat - 36 : col.unit - 60) - col.desc;
  const header = () => {
    text('Pos.', col.pos, y, { size: 8.5, f: bold, color: MUTED });
    text('Menge', col.qty, y, { size: 8.5, f: bold, color: MUTED });
    text('Bezeichnung', col.desc, y, { size: 8.5, f: bold, color: MUTED });
    if (b2b) text('USt', col.vat, y, { size: 8.5, f: bold, color: MUTED, alignRight: true });
    text(b2b ? 'Preis netto' : 'Einzelpreis', col.unit, y, { size: 8.5, f: bold, color: MUTED, alignRight: true });
    text(b2b ? 'Gesamt netto' : 'Gesamt', col.total, y, { size: 8.5, f: bold, color: MUTED, alignRight: true });
    y -= 7;
    page.drawLine({ start: { x: M.left, y }, end: { x: right, y }, thickness: 0.8, color: LINE });
    y -= 14;
  };
  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - M.top - 10;
    header();
  };
  header();

  const qtyText = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
  if (b2b) {
    b2b.lines.forEach((l, i) => {
      const descLines = wrap(l.description, font, 9.5, descW);
      const h = descLines.length * 12 + 6;
      if (y - h < M.bottom + 90) newPage();
      text(String(i + 1), col.pos, y, { size: 9.5 });
      text(`${qtyText(l.quantity)} ${l.unit}`, col.qty, y, { size: 9.5 });
      descLines.forEach((d, j) => text(d, col.desc, y - j * 12, { size: 9.5 }));
      text(l.rc ? 'RC' : `${l.vatRate.toLocaleString('de-DE')} %`, col.vat, y, { size: 9.5, alignRight: true });
      text(formatEuro(l.unitNet, inv.currency), col.unit, y, { size: 9.5, alignRight: true });
      text(formatEuro(l.totalNet, inv.currency), col.total, y, { size: 9.5, alignRight: true });
      y -= h;
    });
  }
  if (!b2b) inv.lines.forEach((l, i) => {
    const descLines = wrap(l.description, font, 9.5, descW);
    const h = descLines.length * 12 + 6;
    if (y - h < M.bottom + 90) newPage();
    text(String(i + 1), col.pos, y, { size: 9.5 });
    text(String(l.quantity), col.qty, y, { size: 9.5 });
    descLines.forEach((d, j) => text(d, col.desc, y - j * 12, { size: 9.5 }));
    text(formatEuro(l.unitGross, inv.currency), col.unit, y, { size: 9.5, alignRight: true });
    text(formatEuro(l.totalGross, inv.currency), col.total, y, { size: 9.5, alignRight: true });
    y -= h;
  });
  page.drawLine({ start: { x: M.left, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 0.8, color: LINE });
  y -= 10;

  // --- Summen ---
  if (y < M.bottom + 90) newPage();
  const vatLabels = b2b && !inv.kleinunternehmer
    ? b2b.vat.map((v) => ({
        label: v.rc ? `Reverse Charge § 13b auf ${formatEuro(v.net, inv.currency)}` : v.rate > 0 ? `zzgl. USt ${v.rate.toLocaleString('de-DE')} % auf ${formatEuro(v.net, inv.currency)}` : 'Umsatzsteuer (steuerfrei)',
        value: formatEuro(v.vat, inv.currency),
      }))
    : [];
  // Summenblock so breit wie die längste Zeile (mind. 190 pt), damit nichts übereinanderläuft.
  const sumW = Math.max(190, ...vatLabels.map((v) => font.widthOfTextAtSize(safe(v.label), 9.5) + font.widthOfTextAtSize(safe(v.value), 9.5) + 16));
  const sum = (label: string, value: string, strong = false) => {
    text(label, right - sumW, y, { size: strong ? 11 : 9.5, f: strong ? bold : font });
    text(value, right, y, { size: strong ? 11 : 9.5, f: strong ? bold : font, alignRight: true });
    y -= strong ? 18 : 14;
  };
  if (b2b) {
    sum('Nettobetrag', formatEuro(inv.totalNet, inv.currency));
    for (const v of vatLabels) sum(v.label, v.value);
    page.drawLine({ start: { x: right - sumW, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.8, color: LINE });
    y -= 4;
    sum('Rechnungsbetrag', formatEuro(inv.totalGross, inv.currency), true);
  } else if (inv.kleinunternehmer) {
    sum('Gesamtbetrag', formatEuro(inv.totalGross, inv.currency), true);
  } else {
    sum('Nettobetrag', formatEuro(inv.totalNet, inv.currency));
    sum(`zzgl. Umsatzsteuer ${inv.vatRate.toLocaleString('de-DE')} %`, formatEuro(inv.totalVat, inv.currency));
    page.drawLine({ start: { x: right - 190, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.8, color: LINE });
    y -= 4;
    sum('Gesamtbetrag (brutto)', formatEuro(inv.totalGross, inv.currency), true);
  }
  y -= 10;

  // --- Hinweise ---
  const notes: string[] = [];
  if (b2b) {
    const tn = taxNote(b2b.taxCase, inv.kleinunternehmer);
    if (tn) notes.push(tn);
    if (b2b.domesticRc) notes.push(`${RC13B_NOTE} Die mit „RC“ gekennzeichneten Positionen werden ohne Umsatzsteuer berechnet; USt-IdNr. Leistungsempfänger: ${b2b.buyerVatId ?? '–'}.`);
    if (b2b.taxCase === 'eu_supply' || b2b.taxCase === 'reverse_charge') notes.push(`USt-IdNr. Leistender: ${inv.seller.vatId ?? '–'} · USt-IdNr. Empfänger: ${b2b.buyerVatId ?? '–'} (${COUNTRY_NAMES[b2b.buyerCountry] ?? b2b.buyerCountry})`);
    if (inv.kind === 'invoice') {
      notes.push(b2b.paymentDays === 0 ? 'Zahlbar sofort ohne Abzug.' : `Zahlbar ohne Abzug bis ${formatDate(b2b.dueDate)} (${b2b.paymentDays} Tage).`);
      if (b2b.bank?.iban) notes.push(`Bankverbindung: ${[b2b.bank.bankName, `IBAN ${b2b.bank.iban.replace(/(.{4})/g, '$1 ').trim()}`, b2b.bank.bic ? `BIC ${b2b.bank.bic}` : ''].filter(Boolean).join(' · ')} – Verwendungszweck: ${inv.number}`);
    }
    if (b2b.note) notes.push(...b2b.note.split(/\r?\n/));
  } else {
    if (inv.kleinunternehmer) notes.push('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    if (inv.kind === 'invoice') {
      notes.push(inv.paidAt ? `Der Betrag wurde am ${formatDate(inv.paidAt)} über eBay bezahlt.` : 'Die Zahlung erfolgt über eBay.');
    }
  }
  for (const n of notes) {
    for (const l of wrap(n, font, 9.5, contentW)) {
      if (y < M.bottom) newPage();
      text(l, M.left, y, { size: 9.5 });
      y -= 13;
    }
  }

  // --- Fuß auf jeder Seite ---
  const s = inv.seller;
  const footLeft = [s.companyName, s.ownerName ? `Inhaber: ${s.ownerName}` : '', ...s.addressLines.slice(0, 2)].filter(Boolean);
  const footMid = [s.taxNumber ? `Steuernummer: ${s.taxNumber}` : '', s.vatId ? `USt-IdNr.: ${s.vatId}` : '', s.email ?? '', s.phone ?? ''].filter(Boolean);
  const footRight = s.footerText ? s.footerText.split(/\r?\n/).flatMap((l) => wrap(l, font, 7.5, 150)) : [];
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: M.left, y: M.bottom - 16 }, end: { x: right, y: M.bottom - 16 }, thickness: 0.6, color: LINE });
    const columns: [string[], number][] = [[footLeft, M.left], [footMid, M.left + 175], [footRight, M.left + 340]];
    for (const [lines, x] of columns) {
      lines.slice(0, 5).forEach((l, i) => p.drawText(safe(l), { x, y: M.bottom - 30 - i * 10, size: 7.5, font, color: MUTED }));
    }
    const label = `Seite ${idx + 1} von ${pages.length}`;
    p.drawText(label, { x: right - font.widthOfTextAtSize(label, 7.5), y: 30, size: 7.5, font, color: MUTED });
  });

  return doc.save();
}
