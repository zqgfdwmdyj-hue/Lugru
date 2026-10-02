// MHD-Angaben in ein Datum umwandeln – so wie sie auf Verpackungen stehen.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, mrz: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const year4 = (y: number) => (y < 100 ? 2000 + y : y);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m) || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * „12.10.26“, „12.10.2026“, „12/10/2026“, „2026-10-12“, „10.2026“ (= Monatsende), „OKT 2026“, „12 OCT 26“ → „2026-10-12“.
 * Gibt null zurück, wenn nichts Gültiges erkennbar ist.
 */
export function normalizeMhd(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (m) return iso(year4(+m[3]), +m[2], +m[1]);
  m = /(\d{1,2})\.? ?([a-zäöü]{3,})\.? ?(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3)]) return iso(year4(+m[3]), MONTHS[m[2].slice(0, 3)], +m[1]);
  m = /([a-zäöü]{3,})\.? ?(\d{2,4})/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3)]) {
    const y = year4(+m[2]);
    const mo = MONTHS[m[1].slice(0, 3)];
    return iso(y, mo, lastDay(y, mo));
  }
  m = /(?:^|\D)(\d{1,2})[./ ](\d{4}|\d{2})(?:\D|$)/.exec(s);
  if (m) {
    const y = year4(+m[2]);
    return iso(y, +m[1], lastDay(y, +m[1]));
  }
  return null;
}
