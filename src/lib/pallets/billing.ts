// Abrechnung der Palettenstellplätze. Ohne Server-Abhängigkeiten, damit es testbar bleibt.
//
// Zählweise: Der Einlagerungstag ist Tag 1, der Auslagerungstag zählt noch mit.
// Kostenfrei sind die ersten `freeDays` Tage (Vorgabe 5) – kostenpflichtig ab Tag 6.
// Abgerechnet wird je Kalendermonat:
//  - "monat":    voller Monatspreis, sobald im Monat mindestens ein kostenpflichtiger Tag liegt
//  - "anteilig": Monatspreis / Tage des Monats × kostenpflichtige Tage im Monat

export type PalletBillingMode = "monat" | "anteilig";
export type PalletRates = { pricePerMonth: number; freeDays: number; mode: PalletBillingMode };
export type PalletLike = { inAt: string; outAt: string | null };

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Erster und letzter Tag eines Monats „JJJJ-MM“. */
export function monthRange(month: string): { first: string; last: string; days: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}

/** Ab welchem Tag die Palette Geld kostet. */
export function chargeableFrom(inAt: string, freeDays: number): string {
  return toIso(toMs(inAt) + Math.max(0, freeDays) * DAY);
}

/** Lagertage bis heute bzw. bis zum Auslagern (Einlagerungstag = Tag 1). */
export function storedDays(p: PalletLike, today: string): number {
  const end = p.outAt ?? today;
  return Math.max(0, Math.round((toMs(end) - toMs(p.inAt)) / DAY) + 1);
}

/**
 * Kostenpflichtige Tage im Monat. Noch eingelagerte Paletten zählen bis Monatsende
 * (so sieht man schon vorher, was am Monatsende abgerechnet wird).
 */
export function chargeableDaysInMonth(p: PalletLike, month: string, freeDays: number): number {
  const { first, last } = monthRange(month);
  const from = Math.max(toMs(chargeableFrom(p.inAt, freeDays)), toMs(first));
  const to = Math.min(p.outAt ? toMs(p.outAt) : Infinity, toMs(last));
  return to < from ? 0 : Math.round((to - from) / DAY) + 1;
}

export function amountForMonth(p: PalletLike, month: string, r: PalletRates): { days: number; amount: number } {
  const days = chargeableDaysInMonth(p, month, r.freeDays);
  if (days === 0) return { days, amount: 0 };
  if (r.mode === "monat") return { days, amount: r.pricePerMonth };
  return { days, amount: Math.round((r.pricePerMonth / monthRange(month).days) * days * 100) / 100 };
}

export type PalletBillLine<P extends PalletLike> = { pallet: P; days: number; amount: number };

/** Alle Paletten eines Monats mit Betrag > 0, gruppiert nach Kunde. */
export function monthlyBill<P extends PalletLike & { customer: string | null }>(pallets: P[], month: string, r: PalletRates) {
  const byCustomer = new Map<string, PalletBillLine<P>[]>();
  for (const p of pallets) {
    const { days, amount } = amountForMonth(p, month, r);
    if (days === 0) continue;
    const key = p.customer?.trim() || "Ohne Kunde";
    byCustomer.set(key, [...(byCustomer.get(key) ?? []), { pallet: p, days, amount }]);
  }
  const groups = [...byCustomer.entries()]
    .map(([customer, lines]) => ({ customer, lines, total: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100 }))
    .sort((a, b) => a.customer.localeCompare(b.customer, "de"));
  return { groups, total: Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100, count: groups.reduce((s, g) => s + g.lines.length, 0) };
}

/** Nächste freie automatische Nummer (P-0001, P-0002 …). */
export function nextPalletCodes(existing: string[], n: number): string[] {
  let max = 0;
  for (const c of existing) {
    const m = /^P-(\d+)$/i.exec(c.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: n }, (_, i) => `P-${String(max + i + 1).padStart(4, "0")}`);
}
