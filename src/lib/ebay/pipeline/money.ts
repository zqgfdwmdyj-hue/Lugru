/**
 * Kaufmännisches Runden auf Cent — an einer Stelle für Gebühr, USt, Einkauf
 * und Gewinn, damit überall dieselbe Regel gilt.
 *
 * `Math.round(v * 100) / 100` allein kippt Halb-Cent-Fälle durch
 * Gleitkomma-Artefakte mal nach unten: 8,50 × 5 % + 0,35 ergibt im Rechner
 * 0,7749999…, also 0,77 statt 0,78. Der Zuschlag von 1e-9 fängt genau diese
 * Artefakte ab, ohne echte Werte zu verfälschen — Beträge aus Cent-Preisen und
 * Prozentsätzen liegen nie absichtlich so knapp neben der halben Cent-Grenze.
 * Gerundet wird vom Betrag weg von null, wie es die Buchhaltung erwartet.
 */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  const scaled = Math.round(Math.abs(value) * factor + 1e-9);
  // Nicht `-0`: das würde formatiert zu „-0,00 €".
  if (scaled === 0) return 0;
  return (value < 0 ? -scaled : scaled) / factor;
}

export function roundCents(value: number): number {
  return roundTo(value, 2);
}
