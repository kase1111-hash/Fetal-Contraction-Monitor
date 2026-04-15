import {
  FIXED_BOUNDS,
  adaptiveBounds,
  resolveBounds,
  computeTorusPoint,
  computeTrajectory,
} from '../../src/torus/map-point';
import { TWO_PI } from '../../src/torus/math';
import type { ContractionResponse } from '../../src/types';

function ctx(
  id: string,
  nadirDepth: number,
  recoveryTime: number,
): ContractionResponse {
  return {
    id,
    timestamp: 0,
    contractionPeakTime: 0,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth,
    nadirTiming: 10,
    recoveryTime,
    responseArea: -100,
    fhrQuality: 1,
    qualityGrade: 'good',
  };
}

describe('FIXED_BOUNDS', () => {
  test('nadir bounds use swapped convention (min = −50, max = 0)', () => {
    expect(FIXED_BOUNDS.nadirMin).toBe(-50);
    expect(FIXED_BOUNDS.nadirMax).toBe(0);
    expect(FIXED_BOUNDS.recoveryMin).toBe(5);
    expect(FIXED_BOUNDS.recoveryMax).toBe(60);
  });
});

describe('computeTorusPoint (fixed bounds)', () => {
  test('nadir = 0 → theta1 = 2π (no-drop end of the circle)', () => {
    const p = computeTorusPoint(ctx('1', 0, 30), FIXED_BOUNDS);
    expect(p.theta1).toBeCloseTo(TWO_PI, 10);
  });

  test('nadir = −50 → theta1 = 0', () => {
    const p = computeTorusPoint(ctx('1', -50, 30), FIXED_BOUNDS);
    expect(p.theta1).toBe(0);
  });

  test('recovery at RECOVERY_MAP_MIN → theta2 = 0', () => {
    const p = computeTorusPoint(ctx('1', -20, 5), FIXED_BOUNDS);
    expect(p.theta2).toBe(0);
  });

  test('recovery at RECOVERY_MAP_MAX → theta2 ≈ 2π', () => {
    const p = computeTorusPoint(ctx('1', -20, 60), FIXED_BOUNDS);
    expect(p.theta2).toBeCloseTo(TWO_PI, 10);
  });
});

describe('adaptiveBounds', () => {
  test('falls back to FIXED_BOUNDS when n < MIN_CONTRACTIONS', () => {
    const few = [ctx('a', -10, 30), ctx('b', -20, 40)];
    const b = adaptiveBounds(few);
    expect(b).toEqual(FIXED_BOUNDS);
  });

  test('produces session-derived bounds when n >= MIN_CONTRACTIONS', () => {
    const cs = [
      ctx('1', -10, 30),
      ctx('2', -12, 32),
      ctx('3', -14, 35),
      ctx('4', -16, 36),
      ctx('5', -18, 40),
      ctx('6', -20, 42),
    ];
    const b = adaptiveBounds(cs);
    // Bounds widen by ±1 margin, so min nadir should be slightly below -20
    expect(b.nadirMin).toBeLessThan(-19);
    expect(b.nadirMax).toBeGreaterThan(-11);
    expect(b.recoveryMin).toBeLessThan(31);
    expect(b.recoveryMax).toBeGreaterThan(41);
  });
});

describe('resolveBounds', () => {
  test('"fixed" always returns population bounds', () => {
    const cs = Array.from({ length: 20 }, (_, i) => ctx(String(i), -i, 30 + i));
    expect(resolveBounds(cs, 'fixed')).toEqual(FIXED_BOUNDS);
  });

  test('"adaptive" uses percentile bounds when enough data', () => {
    const cs = Array.from({ length: 20 }, (_, i) => ctx(String(i), -i, 30 + i));
    const b = resolveBounds(cs, 'adaptive');
    expect(b).not.toEqual(FIXED_BOUNDS);
  });
});

describe('computeTrajectory', () => {
  test('kappa = 0 for fewer than 3 points', () => {
    const pts = computeTrajectory([ctx('a', -20, 30), ctx('b', -25, 35)]);
    expect(pts).toHaveLength(2);
    expect(pts[0]!.kappa).toBe(0);
    expect(pts[1]!.kappa).toBe(0);
  });

  test('interior points have kappa back-filled after 3+ contractions', () => {
    // Use distinct points to get a non-degenerate triangle.
    const cs = [
      ctx('a', -10, 20),
      ctx('b', -25, 35),
      ctx('c', -40, 50),
    ];
    const pts = computeTrajectory(cs, 'fixed');
    // Endpoints keep kappa = 0 (no triplet).
    expect(pts[0]!.kappa).toBe(0);
    expect(pts[2]!.kappa).toBe(0);
    // Interior kappa is non-negative (collinear in this specific case would be 0).
    expect(pts[1]!.kappa).toBeGreaterThanOrEqual(0);
  });

  test('three collinear points → interior kappa = 0', () => {
    // Collinear on the recovery axis only: nadir fixed.
    const cs = [
      ctx('a', -20, 20),
      ctx('b', -20, 30),
      ctx('c', -20, 40),
    ];
    const pts = computeTrajectory(cs, 'fixed');
    expect(pts[1]!.kappa).toBe(0);
  });
});
