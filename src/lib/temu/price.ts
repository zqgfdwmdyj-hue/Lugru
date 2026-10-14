// Temu-Basispreis nach dem Basispreis-Kalkulator (Non-Food / Food): Referenzpreis (brutto, z. B.
// der eBay-Preis) × Faktor; liegt das bei 30 € oder darunter, gehen 2,99 € Versand ab; zuletzt
// ohne Mehrwertsteuer (19 %, Lebensmittel 7 %). Reine Logik – auch für die Oberfläche.

export type TemuPriceRule = { /** z. B. 0,85 */ factor: number; /** Lebensmittel: 7 % statt 19 % MwSt. */ food: boolean };

export const TEMU_PRICE_RULE: TemuPriceRule = { factor: 0.85, food: false };
export const TEMU_SHIPPING_DEDUCTION = 2.99;
export const TEMU_SHIPPING_THRESHOLD = 30;

export const temuVat = (food: boolean) => (food ? 0.07 : 0.19);

/** Wird der Versandabzug fällig (Referenz × Faktor bis 30 €)? */
export const temuWithShipping = (ref: number, rule: TemuPriceRule = TEMU_PRICE_RULE) => !(ref * rule.factor > TEMU_SHIPPING_THRESHOLD);

/** Empfohlener Temu-Basispreis in Euro, auf Cent gerundet. 0 oder weniger: zu billig für Temu. */
export function temuBasePrice(ref: number, rule: TemuPriceRule = TEMU_PRICE_RULE): number {
  if (!(ref > 0) || !(rule.factor > 0)) return 0;
  const gross = ref * rule.factor;
  const net = (temuWithShipping(ref, rule) ? gross - TEMU_SHIPPING_DEDUCTION : gross) / (1 + temuVat(rule.food));
  // Gegen Binärbruch-Reste (z. B. 2.675 → 2.67) vor dem Runden auf 6 Stellen glätten.
  return Math.round(Number(net.toFixed(6)) * 100) / 100;
}

/** Hinweis wie im Kalkulator. */
export const temuPriceNote = (ref: number, rule: TemuPriceRule = TEMU_PRICE_RULE) =>
  temuWithShipping(ref, rule) ? "30 € oder darunter – inkl. 2,99 € Versandabzug" : "Über 30 € – ohne 2,99 € Versandabzug";

/** Faktor aus einer Prozent-Eingabe (85 → 0,85); unplausible Werte → null. */
export function temuFactor(percent: unknown): number | null {
  const n = Number(percent);
  return Number.isFinite(n) && n >= 10 && n <= 300 ? n / 100 : null;
}
