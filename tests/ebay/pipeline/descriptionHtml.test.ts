import { describe, expect, it } from 'vitest';
import { parseDescriptionHtml } from '@/lib/ebay/pipeline/descriptionHtml';

describe('parseDescriptionHtml', () => {
  it('nimmt normales HTML getrimmt an', () => {
    expect(parseDescriptionHtml('  <h2>Hallo</h2><p style="color:red">Text</p>\n')).toBe(
      '<h2>Hallo</h2><p style="color:red">Text</p>'
    );
  });

  it('weist leere Beschreibungen ab', () => {
    expect(() => parseDescriptionHtml('   ')).toThrow(/leer/);
    expect(() => parseDescriptionHtml(undefined)).toThrow(/Text/);
  });

  it('weist aktive Inhalte ab und nennt sie', () => {
    expect(() => parseDescriptionHtml('<p>x</p><script>alert(1)</script>')).toThrow(/<script>/);
    expect(() => parseDescriptionHtml('<img src="a.jpg" onerror="x()">')).toThrow(/onclick=/);
    expect(() => parseDescriptionHtml('<a href="javascript:void(0)">x</a>')).toThrow(/javascript:/);
    expect(() => parseDescriptionHtml('<iframe src="https://x"></iframe>')).toThrow(/<iframe>/);
  });

  it('verwechselt Wörter mit „on" nicht mit Event-Attributen', () => {
    expect(parseDescriptionHtml('<p class="content">Monitor, online=ja</p>')).toContain('Monitor');
  });

  it('weist zu lange Beschreibungen ab', () => {
    expect(() => parseDescriptionHtml('x'.repeat(500_001))).toThrow(/zu lang/);
  });
});
