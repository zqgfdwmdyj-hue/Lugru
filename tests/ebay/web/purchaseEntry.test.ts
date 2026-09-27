import { describe, expect, it } from 'vitest';
import { fieldAfterToggle, placeholderFor, planPurchaseSave, type PurchaseEntry } from '@/components/ebay/purchaseEntry';

const entry = (over: Partial<PurchaseEntry> = {}): PurchaseEntry => ({
  raw: '21,01',
  mode: 'unit',
  vat: 'net',
  pending: false,
  stored: 21.01,
  unitsRaw: '10',
  ...over,
});

describe('fieldAfterToggle', () => {
  it('leert das Feld für gesamt oder brutto und verlangt eine Neueingabe', () => {
    expect(fieldAfterToggle('total', 'net', 21.01)).toEqual({ raw: '', pending: true });
    expect(fieldAfterToggle('unit', 'gross', 21.01)).toEqual({ raw: '', pending: true });
    expect(placeholderFor('total', 'gross')).toBe('Betrag gesamt, brutto eingeben');
  });

  it('zeigt beim Zurückschalten wieder den gespeicherten Wert', () => {
    expect(fieldAfterToggle('unit', 'net', 21.01)).toEqual({ raw: '21,01', pending: false });
    expect(fieldAfterToggle('unit', 'net', undefined)).toEqual({ raw: '', pending: false });
    expect(placeholderFor('unit', 'net')).toBeUndefined();
  });
});

describe('planPurchaseSave', () => {
  it('unveränderter Wert bei pro Stück/netto → nichts zu tun', () => {
    expect(planPurchaseSave(entry())).toEqual({ kind: 'skip' });
  });

  it('Umschalten ohne Neueingabe rechnet nicht noch einmal um (Review P2)', () => {
    // Nach dem Speichern zeigt das Feld 21,01 netto/Stück; der Nutzer stellt auf
    // „gesamt" und verlässt das Feld — 21,01 darf nicht durch zehn geteilt werden.
    expect(planPurchaseSave(entry({ mode: 'total' }))).toEqual({ kind: 'restore' });
    expect(planPurchaseSave(entry({ vat: 'gross' }))).toEqual({ kind: 'restore' });
    // Das geleerte Feld nach dem Umschalten ebenso: zurück auf den gespeicherten Stand, nichts löschen.
    expect(planPurchaseSave(entry({ raw: '', mode: 'total', pending: true }))).toEqual({ kind: 'restore' });
  });

  it('neu eingegebener Gesamtbetrag wird mit den Einheiten geschickt', () => {
    const plan = planPurchaseSave(entry({ raw: '120,50', mode: 'total', vat: 'gross', pending: true }));
    expect(plan).toMatchObject({
      kind: 'save',
      converting: true,
      body: { purchasePrice: 120.5, purchasePriceMode: 'total', purchasePriceVat: 'gross', purchasedUnits: 10 },
    });
    expect((plan as { entered: string }).entered).toMatch(/^120,50\s€ gesamt, brutto$/);
  });

  it('derselbe Betrag darf nach einer Neueingabe bewusst als brutto gelten', () => {
    // Gespeichert 25 netto — „das waren eigentlich 25 brutto": nach dem Umschalten neu getippt.
    const plan = planPurchaseSave(entry({ raw: '25', stored: 25, vat: 'gross', pending: true }));
    expect(plan).toMatchObject({ kind: 'save', converting: true, body: { purchasePrice: 25, purchasePriceVat: 'gross' } });
  });

  it('leeres Feld löscht den gespeicherten Preis — aber nur, wenn es nicht vom Umschalten kommt', () => {
    expect(planPurchaseSave(entry({ raw: '' }))).toEqual({ kind: 'clear' });
    expect(planPurchaseSave(entry({ raw: '', stored: undefined }))).toEqual({ kind: 'skip' });
  });

  it('weist Unsinn und Gesamtbeträge ohne Einheiten ab, statt sie zu senden', () => {
    expect(planPurchaseSave(entry({ raw: '8,5o' }))).toMatchObject({ kind: 'error' });
    expect(planPurchaseSave(entry({ raw: '0' }))).toMatchObject({ kind: 'error' });
    expect(planPurchaseSave(entry({ raw: '120,50', mode: 'total', pending: true, unitsRaw: '' }))).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Einheiten'),
    });
  });

  it('geänderter Wert bei pro Stück/netto wird ohne Umrechnung gespeichert', () => {
    expect(planPurchaseSave(entry({ raw: '22' }))).toMatchObject({
      kind: 'save',
      converting: false,
      body: { purchasePrice: 22, purchasePriceMode: 'unit', purchasePriceVat: 'net' },
    });
  });
});
