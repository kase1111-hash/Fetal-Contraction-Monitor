/**
 * Quality-gate boundary tests.
 * Covers SPEC.md §10 items:
 *  - "Quality gate rejects FHR = 79 and FHR = 201"
 *  - "Quality gate accepts FHR = 80 and FHR = 200"
 *  - Gap threshold behavior at 9.9 s vs 10.1 s
 */

import {
  isFhrValueValid,
  isGap,
  isPossiblyMaternal,
  rollingCv,
  makeSample,
} from '../../src/ble/quality-gate';
import type { FHRSample } from '../../src/types';

const t0 = 1_700_000_000_000; // reference timestamp

function sample(overrides: Partial<FHRSample> = {}): FHRSample {
  return {
    timestamp: t0,
    fhr: 140,
    source: 'rr',
    valid: true,
    ...overrides,
  };
}

describe('isFhrValueValid', () => {
  test('rejects FHR = 79 (below FHR_MIN)', () => {
    expect(isFhrValueValid(79)).toBe(false);
  });
  test('accepts FHR = 80 (inclusive lower bound)', () => {
    expect(isFhrValueValid(80)).toBe(true);
  });
  test('accepts FHR = 200 (inclusive upper bound)', () => {
    expect(isFhrValueValid(200)).toBe(true);
  });
  test('rejects FHR = 201 (above FHR_MAX)', () => {
    expect(isFhrValueValid(201)).toBe(false);
  });
  test('rejects NaN / Infinity', () => {
    expect(isFhrValueValid(NaN)).toBe(false);
    expect(isFhrValueValid(Infinity)).toBe(false);
    expect(isFhrValueValid(-Infinity)).toBe(false);
  });
});

describe('makeSample', () => {
  test('marks in-range values valid', () => {
    const s = makeSample(140, t0, 'rr');
    expect(s.valid).toBe(true);
  });
  test('marks out-of-range values invalid', () => {
    expect(makeSample(79, t0, 'hr').valid).toBe(false);
    expect(makeSample(201, t0, 'hr').valid).toBe(false);
  });
});

describe('isGap', () => {
  test('no previous sample → not a gap', () => {
    expect(isGap(null, sample())).toBe(false);
  });
  test('9.9 s gap → not flagged', () => {
    const prev = sample({ timestamp: t0 });
    const next = sample({ timestamp: t0 + 9_900 });
    expect(isGap(prev, next)).toBe(false);
  });
  test('exactly 10.0 s gap → not flagged (strict > comparison)', () => {
    const prev = sample({ timestamp: t0 });
    const next = sample({ timestamp: t0 + 10_000 });
    expect(isGap(prev, next)).toBe(false);
  });
  test('10.1 s gap → flagged', () => {
    const prev = sample({ timestamp: t0 });
    const next = sample({ timestamp: t0 + 10_100 });
    expect(isGap(prev, next)).toBe(true);
  });
});

describe('rollingCv', () => {
  test('fewer than 2 valid samples → 0', () => {
    expect(rollingCv([], t0)).toBe(0);
    expect(rollingCv([sample()], t0)).toBe(0);
  });

  test('constant FHR → CV = 0', () => {
    const xs: FHRSample[] = [];
    for (let i = 0; i < 5; i++) {
      xs.push(sample({ timestamp: t0 - i * 1000, fhr: 140 }));
    }
    expect(rollingCv(xs, t0)).toBeCloseTo(0, 10);
  });

  test('very noisy FHR → CV > threshold', () => {
    const xs: FHRSample[] = [
      sample({ timestamp: t0 - 4000, fhr: 80 }),
      sample({ timestamp: t0 - 3000, fhr: 200 }),
      sample({ timestamp: t0 - 2000, fhr: 80 }),
      sample({ timestamp: t0 - 1000, fhr: 200 }),
      sample({ timestamp: t0, fhr: 80 }),
    ];
    const cv = rollingCv(xs, t0);
    expect(cv).toBeGreaterThan(0.3);
    expect(isPossiblyMaternal(cv)).toBe(true);
  });

  test('ignores samples outside the 5 s window', () => {
    const xs: FHRSample[] = [
      sample({ timestamp: t0 - 10_000, fhr: 50 }), // ignored: outside window
      sample({ timestamp: t0 - 1000, fhr: 140 }),
      sample({ timestamp: t0, fhr: 140 }),
    ];
    expect(rollingCv(xs, t0)).toBeCloseTo(0, 10);
  });

  test('ignores invalid samples', () => {
    const xs: FHRSample[] = [
      sample({ timestamp: t0 - 1000, fhr: 300, valid: false }),
      sample({ timestamp: t0, fhr: 140 }),
    ];
    // Only one valid → returns 0.
    expect(rollingCv(xs, t0)).toBe(0);
  });
});
