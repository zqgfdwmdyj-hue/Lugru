import { formatPrice, parseAmount } from './api';

/**
 * Das Einkaufspreis-Feld der Vorschau als reine Zustandslogik — ohne React,
 * damit sie testbar ist.
 *
 * Das Feld zeigt normalerweise den gespeicherten Netto-Stückpreis. Die
 * Umschalter „gesamt" und „brutto" beschreiben eine **neue** Eingabe: Beim
 * Umschalten wird das Feld deshalb geleert und wartet (`pending`) auf einen
 * Betrag. Sonst ginge der schon umgerechnete Wert beim Verlassen des Feldes
 * ein zweites Mal durch die Umrechnung — aus 21,01 € netto würden still
 * 2,10 € „gesamt für zehn Stück".
 */
export type PriceMode = 'unit' | 'total';
export type VatMode = 'net' | 'gross';

export interface PurchaseEntry {
  /** Feldinhalt, wie getippt. */
  raw: string;
  mode: PriceMode;
  vat: VatMode;
  /** Nach einem Umschalten geleert — wartet auf eine Neueingabe. */
  pending: boolean;
  /** Gespeicherter Netto-Stückpreis. */
  stored?: number;
  /** Gekaufte Einheiten aus dem Formular, wie getippt. */
  unitsRaw: string;
}

export type PurchaseSavePlan =
  /** Nichts zu tun — der Wert ist schon gespeichert. */
  | { kind: 'skip' }
  /** Umschalten ohne Neueingabe: Feld und Umschalter auf den gespeicherten Stand zurück. */
  | { kind: 'restore' }
  /** Leeres Feld: den Einkaufspreis löschen. */
  | { kind: 'clear' }
  | { kind: 'error'; message: string }
  | { kind: 'save'; body: Record<string, unknown>; converting: boolean; entered: string };

export const asInput = (value: number | undefined): string =>
  value === undefined ? '' : String(value).replace('.', ',');

export function isPlain(mode: PriceMode, vat: VatMode): boolean {
  return mode === 'unit' && vat === 'net';
}

/** Feldzustand nach dem Umschalten: Standard zeigt den gespeicherten Wert, alles andere verlangt eine Neueingabe. */
export function fieldAfterToggle(
  mode: PriceMode,
  vat: VatMode,
  stored: number | undefined
): { raw: string; pending: boolean } {
  return isPlain(mode, vat) ? { raw: asInput(stored), pending: false } : { raw: '', pending: true };
}

export function placeholderFor(mode: PriceMode, vat: VatMode): string | undefined {
  if (isPlain(mode, vat)) return undefined;
  return `Betrag ${mode === 'total' ? 'gesamt' : 'je Stück'}${vat === 'gross' ? ', brutto' : ''} eingeben`;
}

export function planPurchaseSave(e: PurchaseEntry): PurchaseSavePlan {
  const trimmed = e.raw.trim();
  if (trimmed === '') {
    if (e.pending) return { kind: 'restore' };
    return e.stored === undefined ? { kind: 'skip' } : { kind: 'clear' };
  }
  const value = parseAmount(trimmed);
  if (value === undefined || value <= 0) {
    return { kind: 'error', message: `Einkaufspreis: „${trimmed}" ist keine gültige Zahl.` };
  }
  const plain = isPlain(e.mode, e.vat);
  if (value === e.stored && (plain || !e.pending)) {
    // Unverändert. Steht dabei ein Umschalter auf gesamt/brutto, ohne dass neu
    // eingegeben wurde, darf der gespeicherte Wert nicht noch einmal umgerechnet werden.
    return plain ? { kind: 'skip' } : { kind: 'restore' };
  }
  const body: Record<string, unknown> = { purchasePrice: value, purchasePriceMode: e.mode, purchasePriceVat: e.vat };
  if (e.mode === 'total') {
    // Die Einheiten aus dem Formular zählen, auch wenn ihr Blur noch nicht gespeichert hat.
    const units = parseAmount(e.unitsRaw);
    if (units === undefined || !Number.isInteger(units) || units < 1) {
      return { kind: 'error', message: 'Für einen Gesamtbetrag bitte die gekauften Einheiten angeben.' };
    }
    body.purchasedUnits = units;
  }
  const entered = `${formatPrice(value)} ${e.mode === 'total' ? 'gesamt' : 'je Stück'}${e.vat === 'gross' ? ', brutto' : ''}`;
  return { kind: 'save', body, converting: !plain, entered };
}
