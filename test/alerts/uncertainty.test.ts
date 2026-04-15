import {
  slopeStandardError,
  greyReason,
  describeGreyReason,
  recentQualityTrend,
  statusLabel,
} from '../../src/alerts/uncertainty';
import { MIN_CONTRACTIONS } from '../../src/constants';
import { emptySession } from '../../src/storage/session-store';
import type { ContractionResponse } from '../../src/types';

function ctx(
  id: string,
  recovery = 30,
  fhrQuality = 0.95,
  detectionConfidence = 1,
): ContractionResponse {
  return {
    id,
    timestamp: 0,
    contractionPeakTime: 0,
    detectionMethod: 'manual',
    detectionConfidence,
    baselineFHR: 140,
    nadirDepth: -20,
    nadirTiming: 10,
    recoveryTime: recovery,
    responseArea: -100,
    fhrQuality,
    qualityGrade: 'good',
  };
}

describe('slopeStandardError', () => {
  test('returns 0 for small samples', () => {
    expect(slopeStandardError([])).toBe(0);
    expect(slopeStandardError([1])).toBe(0);
    expect(slopeStandardError([1, 2])).toBe(0);
  });
  test('perfectly linear data → SE = 0', () => {
    const ys = [1, 2, 3, 4, 5, 6];
    expect(slopeStandardError(ys)).toBe(0);
  });
  test('noisy data → SE > 0', () => {
    const ys = [30, 35, 28, 40, 32, 45, 31, 50];
    expect(slopeStandardError(ys)).toBeGreaterThan(0);
  });
  test('SE shrinks as sample size grows (for fixed noise scale)', () => {
    // Same fixed-pattern noise, varying lengths.
    const patternN = (n: number) =>
      Array.from({ length: n }, (_, i) => i + (i % 2 === 0 ? 1 : -1));
    const se5 = slopeStandardError(patternN(5));
    const se20 = slopeStandardError(patternN(20));
    expect(se20).toBeLessThan(se5);
  });
});

describe('greyReason', () => {
  test('returns null when session is null', () => {
    expect(greyReason(null)).toBeNull();
  });

  test('returns null when status is not grey', () => {
    const s = emptySession('a', 0);
    s.status = 'green';
    expect(greyReason(s)).toBeNull();
  });

  test('awaiting-data reports remaining contractions needed', () => {
    const s = emptySession('a', 0);
    s.status = 'grey';
    s.contractions = [ctx('c0'), ctx('c1')];
    const r = greyReason(s);
    expect(r).toEqual({
      kind: 'awaiting-data',
      needed: MIN_CONTRACTIONS - 2,
    });
  });

  test('signal-quality when recent fhrQuality < 0.5', () => {
    const s = emptySession('a', 0);
    s.status = 'grey';
    s.contractions = Array.from({ length: MIN_CONTRACTIONS }, (_, i) =>
      ctx(`c${i}`, 30, i >= MIN_CONTRACTIONS - 2 ? 0.3 : 0.95),
    );
    const r = greyReason(s);
    expect(r?.kind).toBe('signal-quality');
  });

  test('low-confidence when recent detectionConfidence < 0.5', () => {
    const s = emptySession('a', 0);
    s.status = 'grey';
    s.contractions = Array.from({ length: MIN_CONTRACTIONS }, (_, i) =>
      ctx(`c${i}`, 30, 0.95, i === MIN_CONTRACTIONS - 1 ? 0.3 : 1),
    );
    const r = greyReason(s);
    expect(r?.kind).toBe('low-confidence');
  });
});

describe('describeGreyReason', () => {
  test('handles each kind and null', () => {
    expect(describeGreyReason(null)).toBe('');
    expect(describeGreyReason({ kind: 'awaiting-data', needed: 3 })).toMatch(/3/);
    expect(describeGreyReason({ kind: 'awaiting-data', needed: 1 })).toMatch(/1 more/);
    expect(describeGreyReason({ kind: 'signal-quality' })).toMatch(/probe/);
    expect(describeGreyReason({ kind: 'low-confidence' })).toMatch(/confidence/);
  });
});

describe('recentQualityTrend', () => {
  test('stable with < 4 contractions', () => {
    expect(recentQualityTrend([ctx('a'), ctx('b')])).toBe('stable');
  });

  test('stable with flat quality', () => {
    const xs = Array.from({ length: 8 }, (_, i) => ctx(`c${i}`, 30, 0.95));
    expect(recentQualityTrend(xs)).toBe('stable');
  });

  test('improving when quality trends up', () => {
    const qs = [0.5, 0.55, 0.6, 0.7, 0.85, 0.95];
    const xs = qs.map((q, i) => ctx(`c${i}`, 30, q));
    expect(recentQualityTrend(xs)).toBe('improving');
  });

  test('deteriorating when quality trends down', () => {
    const qs = [0.95, 0.9, 0.8, 0.7, 0.6, 0.5];
    const xs = qs.map((q, i) => ctx(`c${i}`, 30, q));
    expect(recentQualityTrend(xs)).toBe('deteriorating');
  });
});

describe('statusLabel', () => {
  test('maps each status to a human-readable string', () => {
    expect(statusLabel('grey')).toMatch(/Collecting/);
    expect(statusLabel('green')).toMatch(/Reassuring/);
    expect(statusLabel('yellow')).toMatch(/Concerning/);
    expect(statusLabel('red')).toMatch(/provider/);
  });
});
