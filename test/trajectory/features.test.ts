import {
  computeTrajectoryFeatures,
  computeNadirAcceleration,
} from '../../src/trajectory/features';
import { olsSlope } from '../../src/extraction/statistics';
import type { ContractionResponse } from '../../src/types';

function ctx(
  id: string,
  nadirDepth: number,
  recoveryTime: number,
  responseArea = -100,
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
    responseArea,
    fhrQuality: 1,
    qualityGrade: 'good',
  };
}

describe('olsSlope sanity', () => {
  test('monotonically rising ys produce positive slope', () => {
    expect(olsSlope([1, 2, 3, 4, 5])).toBeCloseTo(1, 10);
  });
  test('flat ys → slope 0', () => {
    expect(olsSlope([3, 3, 3, 3])).toBeCloseTo(0, 10);
  });
  test('n < 2 → 0', () => {
    expect(olsSlope([])).toBe(0);
    expect(olsSlope([42])).toBe(0);
  });
});

describe('computeTrajectoryFeatures', () => {
  test('empty list → zeroed features', () => {
    const f = computeTrajectoryFeatures([]);
    expect(f.contractionCount).toBe(0);
    expect(f.recoveryTrendSlope).toBe(0);
    expect(f.nadirTrendSlope).toBe(0);
  });

  test('flat recovery → trendSlope = 0', () => {
    const cs = Array.from({ length: 10 }, (_, i) => ctx(String(i), -20, 30));
    const f = computeTrajectoryFeatures(cs);
    expect(f.recoveryTrendSlope).toBeCloseTo(0, 10);
    expect(f.recoveryLast5Mean).toBe(30);
  });

  test('linearly rising recovery → positive trendSlope', () => {
    // recovery: 30, 31, 32, ... → slope 1
    const cs = Array.from({ length: 8 }, (_, i) => ctx(String(i), -20, 30 + i));
    const f = computeTrajectoryFeatures(cs);
    expect(f.recoveryTrendSlope).toBeCloseTo(1, 10);
    // last-5 mean = mean(33, 34, 35, 36, 37) = 35
    expect(f.recoveryLast5Mean).toBeCloseTo(35, 10);
  });

  test('deepening nadir → nadirTrendSlope negative (more negative later)', () => {
    const cs = Array.from({ length: 8 }, (_, i) => ctx(String(i), -10 - 2 * i, 30));
    const f = computeTrajectoryFeatures(cs);
    expect(f.nadirTrendSlope).toBeLessThan(0);
  });

  test('contractionCount reflects input length', () => {
    const cs = Array.from({ length: 12 }, (_, i) => ctx(String(i), -20, 30));
    const f = computeTrajectoryFeatures(cs);
    expect(f.contractionCount).toBe(12);
  });
});

describe('computeNadirAcceleration', () => {
  test('< 9 samples → 0', () => {
    expect(computeNadirAcceleration([-10, -12, -14, -16, -18, -20, -22, -24])).toBe(0);
  });

  test('steady deepening → acceleration near 0', () => {
    // Slope is same first-third and last-third.
    const xs = Array.from({ length: 12 }, (_, i) => -10 - i);
    expect(computeNadirAcceleration(xs)).toBeCloseTo(0, 8);
  });

  test('accelerating deepening → positive acceleration (on depth magnitudes)', () => {
    // First third stable, last third dropping fast. Nadirs get more negative.
    // With the depth-magnitude convention, acceleration is POSITIVE here.
    const xs = [
      -10, -10, -10, -10, // first third flat → slope ≈ 0
      -11, -13, -15, -17, // middle decelerates
      -20, -26, -35, -45, // last third depths grow faster → positive slope
    ];
    expect(computeNadirAcceleration(xs)).toBeGreaterThan(0);
  });

});
