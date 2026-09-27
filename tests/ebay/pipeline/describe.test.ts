import { describe, it, expect } from 'vitest';
import { buildDescription } from '@/lib/ebay/pipeline/describe';

describe('buildDescription', () => {
  it('nutzt die Katalogbeschreibung, wenn vorhanden', () => {
    const html = buildDescription('Bosch GSR', { Marke: ['Bosch'] }, 'Der kompakte Bohrschrauber.');
    expect(html).toContain('<h2>Bosch GSR</h2>');
    expect(html).toContain('Der kompakte Bohrschrauber.');
    expect(html).toContain('Marke');
  });

  it('baut ohne Katalogbeschreibung eine Aspekte-Tabelle', () => {
    const html = buildDescription('Bosch GSR', { Marke: ['Bosch'], Spannung: ['12 V'] });
    expect(html).toContain('<h2>Bosch GSR</h2>');
    expect(html).toContain('<table');
    expect(html).toContain('Marke');
    expect(html).toContain('Bosch');
    expect(html).toContain('12 V');
  });

  it('mehrere Aspektwerte werden mit Komma verbunden', () => {
    const html = buildDescription('T', { Produktart: ['Bohrschrauber', 'Schrauber'] });
    expect(html).toContain('Bohrschrauber, Schrauber');
  });

  it('escaped HTML-Sonderzeichen', () => {
    const html = buildDescription('A <b> & B', { 'Größe <XL>': ['1 & 2'] }, 'x < y & z');
    expect(html).not.toContain('<b>');
    expect(html).toContain('A &lt;b&gt; &amp; B');
    expect(html).toContain('Größe &lt;XL&gt;');
    expect(html).toContain('1 &amp; 2');
    expect(html).toContain('x &lt; y &amp; z');
  });

  it('leere Aspekte ergeben keine Tabelle', () => {
    const html = buildDescription('T', {});
    expect(html).toContain('<h2>T</h2>');
    expect(html).not.toContain('<table');
  });
});
