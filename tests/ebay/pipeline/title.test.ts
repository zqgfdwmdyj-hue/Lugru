import { describe, it, expect } from 'vitest';
import { buildFactTitle, truncateTitle } from '@/lib/ebay/pipeline/title';

describe('truncateTitle', () => {
  it('lässt kurze Titel unverändert', () => {
    expect(truncateTitle('Bosch GSR 12V-15')).toBe('Bosch GSR 12V-15');
  });

  it('trimmt Whitespace', () => {
    expect(truncateTitle('  Bosch GSR  ')).toBe('Bosch GSR');
  });

  it('kürzt lange Titel auf max. 80 Zeichen an Wortgrenze', () => {
    const long =
      'Bosch Professional GSR 12V-15 Akku-Bohrschrauber 12 V mit 2 Akkus Ladegerät und Tasche Aktionsangebot';
    const result = truncateTitle(long);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toBe('Bosch Professional GSR 12V-15 Akku-Bohrschrauber 12 V mit 2 Akkus Ladegerät und');
    expect(result.endsWith(' ')).toBe(false);
  });

  it('exakt 80 Zeichen bleiben stehen', () => {
    const t = 'x'.repeat(80);
    expect(truncateTitle(t)).toBe(t);
  });

  it('ein einziges überlanges Wort wird hart geschnitten', () => {
    const t = 'y'.repeat(100);
    expect(truncateTitle(t)).toBe('y'.repeat(80));
  });
});

describe('buildFactTitle', () => {
  it('baut einen Titel aus Marke und priorisierten Merkmalen', () => {
    const t = buildFactTitle('STABILO', {
      Farbe: ['Grün'],
      Produktart: ['Fineliner'],
      Marke: ['STABILO'],
      Modell: ['point 88'],
      Strichstärke: ['0,4 mm'],
    });
    expect(t).toBe('STABILO Fineliner point 88 Grün 0,4 mm');
  });

  it('wiederholt die Marke nicht und lässt Fehlendes aus', () => {
    const t = buildFactTitle('Bosch', { Marke: ['Bosch'], Produktart: ['Bohrschrauber'] });
    expect(t).toBe('Bosch Bohrschrauber');
  });

  it('funktioniert ohne Marke und kürzt auf 80 Zeichen', () => {
    const t = buildFactTitle(undefined, { Produktart: ['X'.repeat(100)] });
    expect(t.length).toBeLessThanOrEqual(80);
  });

  it('leere Eingaben ergeben einen leeren Titel', () => {
    expect(buildFactTitle(undefined, {})).toBe('');
  });
});
