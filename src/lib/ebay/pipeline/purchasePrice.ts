import { roundCents } from './money';

/**
 * Bringt die Einkaufspreis-Eingabe auf die Speicherform: **Netto-Stückpreis**.
 *
 * Der Betrag kommt wahlweise als Gesamtsumme und wahlweise brutto herein.
 * Beide Umrechnungen laufen in einem Schritt mit **einer** Rundung — sonst
 * summieren sich zwei Rundungen zu einem Cent Abweichung.
 *
 * Fehlt die Grundlage für eine Umrechnung, fliegt ein Fehler statt eines
 * stillen Ersatzwerts: Ein Gesamtbetrag ohne Stückzahl würde sonst als
 * Stückpreis gespeichert, ein Bruttobetrag ohne USt-Satz als netto — beides
 * fiele erst in einer falschen Gewinnzeile auf.
 *
 * Liegt bewusst in der Pipeline und nicht in den Routen: Das Anlegen-Formular
 * muss beim Tippen dieselbe Zahl (und denselben Fehler) zeigen, die der Server
 * anschließend speichert, und importiert diese Funktion deshalb direkt.
 */
export interface PurchasePriceInput {
  /** `'total'` = der Betrag gilt für alle Einheiten zusammen. */
  mode?: unknown;
  units?: number;
  /** `'gross'` = der Betrag enthält Umsatzsteuer. */
  vatMode?: unknown;
  vatPercentage?: number;
}

/**
 * Merge der Gewinnrechnung (PR #6), ab dem der Einkaufspreis als Nettobetrag
 * gespeichert wird. Nur ein Hinweis für die Oberfläche: Ein Versuch von davor
 * ist mit hoher Wahrscheinlichkeit brutto erfasst. Verbindlich ist allein die
 * Markierung `purchasePriceBasis` am Versuch.
 */
export const NET_BASIS_SINCE = '2026-09-01T14:20:21.000Z';

export const TOTAL_NEEDS_UNITS = 'Für einen Gesamtbetrag bitte die gekauften Einheiten angeben.';
export const GROSS_NEEDS_VAT = 'Für einen Bruttobetrag muss in den Einstellungen ein USt-Satz hinterlegt sein.';

export function purchaseUnitNet(
  value: number | undefined,
  opts: PurchasePriceInput
): number | undefined {
  if (value === undefined) return undefined;
  let v = value;
  if (opts.mode === 'total') {
    if (!opts.units || opts.units < 1) throw new Error(TOTAL_NEEDS_UNITS);
    v = v / opts.units;
  }
  if (opts.vatMode === 'gross') {
    if (!opts.vatPercentage || opts.vatPercentage <= 0) throw new Error(GROSS_NEEDS_VAT);
    v = v / (1 + opts.vatPercentage / 100);
  }
  return roundCents(v);
}
