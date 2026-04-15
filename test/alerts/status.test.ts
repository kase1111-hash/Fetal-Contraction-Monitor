/**
 * Alert status tests. Covers SPEC.md §10:
 *   - grey when n < 6
 *   - green when slope flat, last-5 < 40
 *   - yellow when slope = 0.3
 *   - red when slope = 1.0 AND last-5 = 45s (sustained)
 */

import { determineStatus } from '../../src/alerts/status';
import {
  LAST5_RED,
  LAST5_YELLOW,
  MIN_CONTRACTIONS,
  RED_PERSISTENCE,
  SLOPE_RED,
  SLOPE_YELLOW,
} from '../../src/constants';
import type {
  ContractionResponse,
  TrajectoryFeatures,
} from '../../src/types';

function baseFeatures(
  overrides: Partial<TrajectoryFeatures> = {},
): TrajectoryFeatures {
  return {
    kappaMedian: 0,
    kappaGini: 0,
    recoveryTrendSlope: 0,
    nadirTrendSlope: 0,
    recoveryLast5Mean: 30,
    nadirAcceleration: 0,
    areaLast5Mean: -300,
    contractionCount: 8,
    ...overrides,
  };
}

function goodCtx(): ContractionResponse {
  return {
    id: Math.random().toString(36),
    timestamp: 0,
    contractionPeakTime: 0,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: -20,
    nadirTiming: 10,
    recoveryTime: 30,
    responseArea: -300,
    fhrQuality: 0.95,
    qualityGrade: 'good',
  };
}

describe('determineStatus — gates', () => {
  test('grey when below MIN_CONTRACTIONS', () => {
    const r = determineStatus({
      features: baseFeatures({ contractionCount: MIN_CONTRACTIONS - 1 }),
      baseline: null,
      recentContractions: [],
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('grey');
    expect(r.redPersistenceCount).toBe(0);
  });

  test('grey when recent fhrQuality < 0.5', () => {
    const poor = { ...goodCtx(), fhrQuality: 0.3 };
    const r = determineStatus({
      features: baseFeatures(),
      baseline: null,
      recentContractions: [poor, goodCtx(), goodCtx()],
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('grey');
  });

  test('grey when recent detection confidence below floor', () => {
    const sketchy = { ...goodCtx(), detectionConfidence: 0.4 };
    const r = determineStatus({
      features: baseFeatures(),
      baseline: null,
      recentContractions: [sketchy, goodCtx(), goodCtx()],
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('grey');
  });

  test('grey preserves incoming redPersistenceCount (no reset through bad readings)', () => {
    const poor = { ...goodCtx(), fhrQuality: 0.3 };
    const r = determineStatus({
      features: baseFeatures(),
      baseline: null,
      recentContractions: [poor, goodCtx(), goodCtx()],
      redPersistenceCount: 1,
    });
    expect(r.redPersistenceCount).toBe(1);
  });
});

describe('determineStatus — colors', () => {
  const recent = [goodCtx(), goodCtx(), goodCtx()];

  test('green when flat slope and last-5 below yellow', () => {
    const r = determineStatus({
      features: baseFeatures({ recoveryTrendSlope: 0, recoveryLast5Mean: 30 }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('green');
    expect(r.redPersistenceCount).toBe(0);
  });

  test('yellow when slope exactly SLOPE_YELLOW', () => {
    const r = determineStatus({
      features: baseFeatures({ recoveryTrendSlope: SLOPE_YELLOW, recoveryLast5Mean: 30 }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('yellow');
  });

  test('yellow on elevated last-5 alone', () => {
    const r = determineStatus({
      features: baseFeatures({
        recoveryTrendSlope: 0,
        recoveryLast5Mean: LAST5_YELLOW,
      }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('yellow');
  });

  test('yellow on nadirAcceleration above tolerance alone', () => {
    const r = determineStatus({
      features: baseFeatures({ nadirAcceleration: 0.5 }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('yellow');
  });

  test('tiny positive nadirAcceleration (float noise) does NOT trigger yellow', () => {
    const r = determineStatus({
      features: baseFeatures({ nadirAcceleration: 1e-15 }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('green');
  });

  test('red requires both slope AND last-5 AND persistence', () => {
    // First red-eligible contraction: yellow, counter 1.
    const r1 = determineStatus({
      features: baseFeatures({
        recoveryTrendSlope: SLOPE_RED,
        recoveryLast5Mean: LAST5_RED,
      }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r1.status).toBe('yellow');
    expect(r1.redPersistenceCount).toBe(1);

    // Second red-eligible: persistence reached → red.
    const r2 = determineStatus({
      features: baseFeatures({
        recoveryTrendSlope: SLOPE_RED,
        recoveryLast5Mean: LAST5_RED,
      }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: r1.redPersistenceCount,
    });
    expect(r2.status).toBe('red');
    expect(r2.redPersistenceCount).toBe(RED_PERSISTENCE);
  });

  test('dropping out of red-eligibility resets the counter', () => {
    const r1 = determineStatus({
      features: baseFeatures({
        recoveryTrendSlope: SLOPE_RED,
        recoveryLast5Mean: LAST5_RED,
      }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r1.redPersistenceCount).toBe(1);

    // Next contraction: slope drops below red but still yellow-eligible.
    const r2 = determineStatus({
      features: baseFeatures({
        recoveryTrendSlope: SLOPE_YELLOW,
        recoveryLast5Mean: 40,
      }),
      baseline: null,
      recentContractions: recent,
      redPersistenceCount: r1.redPersistenceCount,
    });
    expect(r2.status).toBe('yellow');
    expect(r2.redPersistenceCount).toBe(0);
  });

  test('adaptive thresholds bring yellow in earlier when personal baseline is tight', () => {
    // Tight baseline: mean 28, sd 2 → personal yellow = 30, red = 32.
    const baseline = { recoveryMean: 28, recoverySd: 2, nadirMean: -20, nadirSd: 4 };
    const r = determineStatus({
      features: baseFeatures({
        recoveryTrendSlope: 0,
        recoveryLast5Mean: 31, // below population yellow (40) but above personal (30)
      }),
      baseline,
      recentContractions: recent,
      redPersistenceCount: 0,
    });
    expect(r.status).toBe('yellow');
  });
});
