/**
 * End-to-end Phase-1 pipeline test.
 *
 * Feeds each simulation scenario into extract → trajectory-features and
 * checks that the computed features move in the expected direction.
 *
 * This does NOT yet exercise alert logic (that's Phase 2).
 */

import {
  scenarioParams,
  generateFhrStream,
  type ScenarioKind,
} from '../../src/simulation/scenarios';
import { extractResponse } from '../../src/extraction/extract-response';
import { computeTrajectoryFeatures } from '../../src/trajectory/features';
import type { ContractionResponse } from '../../src/types';

function runScenario(kind: ScenarioKind, n = 15): ContractionResponse[] {
  const responses: ContractionResponse[] = [];
  const start = 1_700_000_000_000;
  for (let k = 0; k < n; k++) {
    // Contractions spaced 3 minutes apart (typical active labor).
    const peak = start + k * 180_000;
    const params = scenarioParams(kind, k, n);
    const samples = generateFhrStream(params, peak);
    const r = extractResponse({
      detection: { peakTimestamp: peak, method: 'manual', confidence: 1 },
      samples,
      id: `ctx-${k}`,
    });
    expect(r.ok).toBe(true);
    if (r.ok) responses.push(r.response);
  }
  return responses;
}

describe('Simulation pipeline — Normal scenario', () => {
  const responses = runScenario('normal');

  test('all contractions extract successfully', () => {
    expect(responses).toHaveLength(15);
  });

  test('recovery trend is near flat (≤ 1 s/contraction)', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(Math.abs(f.recoveryTrendSlope)).toBeLessThanOrEqual(1);
  });

  test('last-5 recovery is below the YELLOW floor (40 s)', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(f.recoveryLast5Mean).toBeLessThan(40);
  });
});

describe('Simulation pipeline — Concerning scenario', () => {
  const responses = runScenario('concerning');

  test('recovery trend slope is positive (rising)', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(f.recoveryTrendSlope).toBeGreaterThan(0);
  });

  test('last-5 recovery approaches the YELLOW zone', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(f.recoveryLast5Mean).toBeGreaterThan(38);
  });
});

describe('Simulation pipeline — Distress scenario', () => {
  const responses = runScenario('distress');

  test('recovery trend slope is steep (positive, ≥ 1 s/contraction)', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(f.recoveryTrendSlope).toBeGreaterThanOrEqual(1);
  });

  test('last-5 recovery is in the RED range (≥ 45 s)', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(f.recoveryLast5Mean).toBeGreaterThanOrEqual(45);
  });

  test('nadirs deepen (trend slope negative)', () => {
    const f = computeTrajectoryFeatures(responses);
    expect(f.nadirTrendSlope).toBeLessThan(0);
  });
});
