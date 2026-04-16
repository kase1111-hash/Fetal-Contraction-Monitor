import { buildEquivalenceHtml } from '../../src/study/report';
import type { EquivalenceSummary } from '../../src/study/equivalence';

function fakeSummary(): EquivalenceSummary {
  return {
    fhr: {
      n: 240,
      bias: -0.42,
      sd: 3.1,
      loaLow: -6.5,
      loaHigh: 5.66,
      pearsonR: 0.91,
      rmse: 3.12,
    },
    features: {
      byFeature: [
        { feature: 'baselineFHR', n: 10, bias: -0.5, meanAbsDiff: 1.2, meanPctDiff: 0.009 },
        { feature: 'nadirDepth', n: 10, bias: 1.1, meanAbsDiff: 2.4, meanPctDiff: 0.12 },
        { feature: 'recoveryTime', n: 10, bias: 0.3, meanAbsDiff: 1.8, meanPctDiff: 0.06 },
        { feature: 'responseArea', n: 10, bias: 3.4, meanAbsDiff: 12, meanPctDiff: 0.045 },
      ],
      pairs: [],
    },
    status: {
      n: 10,
      accuracy: 0.9,
      kappa: 0.82,
      confusion: {
        grey: { grey: 2, green: 0, yellow: 0, red: 0 },
        green: { grey: 0, green: 5, yellow: 1, red: 0 },
        yellow: { grey: 0, green: 0, yellow: 2, red: 0 },
        red: { grey: 0, green: 0, yellow: 0, red: 0 },
      },
    },
    counts: { nA: 10, nB: 10, matched: 10 },
  };
}

describe('buildEquivalenceHtml', () => {
  test('contains required sections', () => {
    const html = buildEquivalenceHtml([], fakeSummary(), { dateIso: '2026-04-16' });
    expect(html).toContain('Equivalence report');
    expect(html).toContain('Sample-level FHR agreement');
    expect(html).toContain('Per-contraction feature agreement');
    expect(html).toContain('Alert-status concordance');
    // Contains the fake numbers.
    expect(html).toContain('-0.42'); // bias
    expect(html).toContain('0.91'); // Pearson r
  });

  test('includes custom labels', () => {
    const html = buildEquivalenceHtml([], fakeSummary(), {
      labelA: 'BabyTone BT',
      labelB: 'Philips Avalon',
    });
    expect(html).toContain('BabyTone BT');
    expect(html).toContain('Philips Avalon');
  });

  test('escapes HTML in labels', () => {
    const html = buildEquivalenceHtml([], fakeSummary(), {
      labelA: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('renders inline SVG for Bland-Altman', () => {
    const aligned = Array.from({ length: 20 }, (_, i) => ({
      t: i,
      fhrA: 140 + i,
      fhrB: 139 + i,
    }));
    const html = buildEquivalenceHtml(aligned, fakeSummary());
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  test('confusion matrix rows + cells render', () => {
    const html = buildEquivalenceHtml([], fakeSummary());
    // Four status rows expected.
    const rowCount = (html.match(/<tr><th style="text-align:left/g) ?? []).length;
    expect(rowCount).toBe(4);
  });

  test('starts with HTML5 doctype and has a disclaimer', () => {
    const html = buildEquivalenceHtml([], fakeSummary());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/not a validation of clinical use/i);
  });
});
