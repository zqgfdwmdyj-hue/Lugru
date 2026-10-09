import { formatInvoiceNumber } from './build';
import type { InvoiceSettings } from './types';

/*
 * Rechnungsnummern. Standard: Präfix + Jahr + vierstellige Nummer (RE-2026-0001), jedes Jahr
 * neu. Wer aus einem anderen Programm (z. B. Stotax Select) umsteigt, übernimmt dessen Format:
 * `numberFormat` mit {JJJJ} (Jahr) und {NR} bzw. {NR:4} (laufende Nummer, mit Nullen
 * aufgefüllt). Ohne {JJJJ} läuft die Nummer über die Jahre durch.
 */

const NR = /\{NR(?::(\d))?\}/;

export function formatNumber(s: InvoiceSettings, year: number, seq: number): string {
  if (!s.numberFormat) return formatInvoiceNumber(s.prefix ?? 'RE-', year, seq);
  return s.numberFormat.replaceAll('{JJJJ}', String(year)).replace(NR, (_, w: string | undefined) => String(seq).padStart(Number(w ?? 0), '0'));
}

/** Beginnt die Nummer jedes Jahr neu? */
export const yearlyNumbers = (s: InvoiceSettings) => !s.numberFormat || s.numberFormat.includes('{JJJJ}');

export function validNumberFormat(f: string): boolean {
  return f.length <= 40 && (f.match(/\{NR(?::\d)?\}/g) ?? []).length === 1 && !/\{(?!JJJJ\}|NR(?::\d)?\})/.test(f) && /^[\w\-/.{}:]*$/.test(f);
}

export type DerivedNumbering = { numberFormat: string; nextNumber: number; year: number | null };

/**
 * Aus der letzten Rechnungsnummer des bisherigen Programms Format und nächste Nummer ableiten:
 * „2026-0815“ → {JJJJ}-{NR:4}, weiter mit 816; „RE-123“ → RE-{NR:3}, durchlaufend, weiter mit 124.
 */
export function deriveNumbering(last: string): DerivedNumbering | null {
  const t = last.trim();
  if (!t || t.length > 30 || !/^[\w\-/.]+$/.test(t)) return null;
  const m = /^(.*?)(\d+)(\D*)$/.exec(t);
  if (!m) return null;
  const [, head, digits, tail] = m;
  const width = digits.length <= 6 ? digits.length : 0;
  // Jahr im vorderen Teil (die letzte Jahreszahl 2000–2099) → Nummer beginnt jedes Jahr neu.
  const y = /^(.*)(20\d{2})(?!.*20\d{2})(.*)$/.exec(head);
  const numberFormat = `${y ? `${y[1]}{JJJJ}${y[3]}` : head}{NR${width > 1 ? `:${width}` : ''}}${tail}`;
  return { numberFormat, nextNumber: Number(digits) + 1, year: y ? Number(y[2]) : null };
}
