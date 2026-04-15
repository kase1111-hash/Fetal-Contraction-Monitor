import { buildSessionHtml } from '../../src/export/pdf';
import { emptySession } from '../../src/storage/session-store';
import type { ContractionResponse } from '../../src/types';

function ctx(i: number, nadir: number, recovery: number): ContractionResponse {
  return {
    id: `c${i}`,
    timestamp: 0,
    contractionPeakTime: 1_700_000_000_000 + i * 60_000,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: nadir,
    nadirTiming: 10,
    recoveryTime: recovery,
    responseArea: -100,
    fhrQuality: 0.95,
    qualityGrade: 'good',
  };
}

describe('buildSessionHtml', () => {
  test('contains status pill and disclaimer', () => {
    const s = emptySession('s', Date.now());
    s.status = 'green';
    const html = buildSessionHtml(s);
    expect(html).toContain('GREEN');
    expect(html).toContain('Not a medical device');
  });

  test('includes one table row per contraction', () => {
    const s = emptySession('s', Date.now());
    s.contractions = [ctx(0, -20, 30), ctx(1, -22, 32), ctx(2, -24, 34)];
    const html = buildSessionHtml(s);
    const rows = html.match(/<tr>/g) ?? [];
    // header row + 3 body rows
    expect(rows.length).toBe(4);
  });

  test('includes an inline SVG trend chart', () => {
    const s = emptySession('s', Date.now());
    s.contractions = [ctx(0, -20, 30), ctx(1, -22, 32)];
    const html = buildSessionHtml(s);
    expect(html).toContain('<svg');
    expect(html).toContain('polyline');
  });

  test('escapes HTML-special characters in ids and titles', () => {
    const s = emptySession('abc<script>alert(1)</script>', Date.now());
    const html = buildSessionHtml(s, { title: '<evil>&co"' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;evil&gt;');
  });

  test('produces valid-looking HTML5 doctype', () => {
    const s = emptySession('s', Date.now());
    const html = buildSessionHtml(s);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});
