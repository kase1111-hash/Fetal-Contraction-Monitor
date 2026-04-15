import {
  establishBaseline,
  adaptiveRecoveryThresholds,
} from '../../src/alerts/personal-baseline';
import { LAST5_RED, LAST5_YELLOW, MIN_CONTRACTIONS } from '../../src/constants';
import type { ContractionResponse } from '../../src/types';

function ctx(nadir: number, recovery: number): ContractionResponse {
  return {
    id: Math.random().toString(36),
    timestamp: 0,
    contractionPeakTime: 0,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: nadir,
    nadirTiming: 10,
    recoveryTime: recovery,
    responseArea: -100,
    fhrQuality: 1,
    qualityGrade: 'good',
  };
}

describe('establishBaseline', () => {
  test('returns null below MIN_CONTRACTIONS', () => {
    const few = Array.from({ length: MIN_CONTRACTIONS - 1 }, () => ctx(-20, 30));
    expect(establishBaseline(few)).toBeNull();
  });

  test('uses first MIN_CONTRACTIONS only', () => {
    // First 6: recovery 30..35; later entries (should be ignored) have wild values.
    const first = [ctx(-20, 30), ctx(-20, 31), ctx(-20, 32), ctx(-20, 33), ctx(-20, 34), ctx(-20, 35)];
    const later = [ctx(-50, 99), ctx(-50, 99)];
    const b = establishBaseline([...first, ...later])!;
    expect(b.recoveryMean).toBeCloseTo(32.5, 6);
    expect(b.nadirMean).toBeCloseTo(-20, 6);
  });

  test('computes population SD', () => {
    const six = [ctx(-20, 30), ctx(-20, 30), ctx(-20, 30), ctx(-20, 30), ctx(-20, 30), ctx(-20, 30)];
    const b = establishBaseline(six)!;
    expect(b.recoverySd).toBe(0);
    expect(b.nadirSd).toBe(0);
  });
});

describe('adaptiveRecoveryThresholds', () => {
  test('null baseline → population floors', () => {
    expect(adaptiveRecoveryThresholds(null)).toEqual({
      yellow: LAST5_YELLOW,
      red: LAST5_RED,
    });
  });

  test('personal thresholds below population → tighter (personal wins)', () => {
    const base = { recoveryMean: 28, recoverySd: 2, nadirMean: -20, nadirSd: 4 };
    const t = adaptiveRecoveryThresholds(base);
    expect(t.yellow).toBe(30); // 28 + 2
    expect(t.red).toBe(32);    // 28 + 2*2
  });

  test('personal thresholds above population → population floor caps them', () => {
    const base = { recoveryMean: 50, recoverySd: 10, nadirMean: -20, nadirSd: 4 };
    // personal yellow = 60, personal red = 70 — both above population.
    const t = adaptiveRecoveryThresholds(base);
    expect(t.yellow).toBe(LAST5_YELLOW);
    expect(t.red).toBe(LAST5_RED);
  });
});
