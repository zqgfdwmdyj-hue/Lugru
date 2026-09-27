import { describe, it, expect } from 'vitest';
import { parseSource } from '@/lib/ebay/pipeline/source';

describe('parseSource', () => {
  it('gibt null für leere Eingaben', () => {
    expect(parseSource('')).toBeNull();
    expect(parseSource('   ')).toBeNull();
  });

  it('reiner Freitext wird zum Händlernamen', () => {
    expect(parseSource('  Metro Düsseldorf ')).toEqual({
      text: 'Metro Düsseldorf',
      merchant: 'Metro Düsseldorf',
    });
  });

  it('erkennt eine vollständige URL und leitet den Händler ab', () => {
    expect(parseSource('https://www.metro.de/artikel/4711')).toEqual({
      text: 'https://www.metro.de/artikel/4711',
      url: 'https://www.metro.de/artikel/4711',
      merchant: 'Metro',
    });
  });

  it('erkennt eine Domain ohne Protokoll und ergänzt https', () => {
    const r = parseSource('kaufland.de/angebote');
    expect(r?.url).toBe('https://kaufland.de/angebote');
    expect(r?.merchant).toBe('Kaufland');
  });

  it('findet einen Link mitten im Text, behält aber den Rohtext', () => {
    const r = parseSource('Restposten bei metro.de gekauft');
    expect(r?.text).toBe('Restposten bei metro.de gekauft');
    expect(r?.url).toBe('https://metro.de');
    expect(r?.merchant).toBe('Metro');
  });

  it('ignoriert Subdomains beim Händlernamen', () => {
    expect(parseSource('https://shop.metro.de/x')?.merchant).toBe('Metro');
  });

  it('behandelt mehrteilige TLDs korrekt', () => {
    expect(parseSource('https://www.ebay.co.uk/itm/1')?.merchant).toBe('Ebay');
  });

  it('hält Datumsangaben nicht für Domains', () => {
    const r = parseSource('Flohmarkt am 12.Mai');
    expect(r?.url).toBeUndefined();
    expect(r?.merchant).toBe('Flohmarkt am 12.Mai');
  });
});
