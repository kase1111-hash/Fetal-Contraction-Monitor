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
  simulateResponses,
  type ScenarioKind,
} from '../../src/simulation/scenarios';
import {
  BASELINE_WINDOW,
  LAST5_YELLOW,
  RESPONSE_WINDOW,
} from '../../src/constants';
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

/**
 * These exercise the whole-session helper the Settings screen calls, rather
 * than extracting each stream in isolation the way the tests above do.
 *
 * That distinction is the bug this guards. The screen used to feed every
 * scenario stream into the live FhrBuffer at 2 s spacing while each stream
 * spans BASELINE_WINDOW + RESPONSE_WINDOW = 90 s, so the streams overlapped
 * and every extraction read a blend of its neighbours. "Normal labor" came
 * back as -30 bpm nadirs and 60 s recoveries (the "never recovered" fallback)
 * on every contraction, for all three scenarios.
 */
describe('simulateResponses — whole-session scenarios', () => {
  test('produces the requested number of extracted contractions', () => {
    for (const kind of ['normal', 'concerning', 'distress'] as const) {
      expect(simulateResponses(kind, { count: 15 })).toHaveLength(15);
    }
  });

  test('normal labor stays inside reassuring bounds', () => {
    const responses = simulateResponses('normal', { count: 15 });
    const f = computeTrajectoryFeatures(responses);

    expect(f.recoveryLast5Mean).toBeLessThan(LAST5_YELLOW);
    expect(Math.abs(f.recoveryTrendSlope)).toBeLessThanOrEqual(1);
    // No contraction may sit at the "never recovered" ceiling.
    for (const c of responses) {
      expect(c.recoveryTime).toBeLessThan(RESPONSE_WINDOW);
      expect(c.recoveryTime).toBeGreaterThan(0);
    }
  });

  test('nadirs deepen gradually rather than pinning at the deepest value', () => {
    const responses = simulateResponses('normal', { count: 15 });
    const depths = responses.map((c) => c.nadirDepth);
    // The scenario ramps -10 -> -30 bpm; a flat series means the streams
    // bled into each other.
    expect(new Set(depths.map((d) => d.toFixed(1))).size).toBeGreaterThan(5);
    expect(depths[0]!).toBeGreaterThan(depths[depths.length - 1]!);
    expect(depths[0]!).toBeGreaterThan(-15);
  });

  test('the three scenarios are actually distinguishable', () => {
    const normal = computeTrajectoryFeatures(simulateResponses('normal'));
    const concerning = computeTrajectoryFeatures(simulateResponses('concerning'));
    const distress = computeTrajectoryFeatures(simulateResponses('distress'));

    expect(concerning.recoveryTrendSlope).toBeGreaterThan(normal.recoveryTrendSlope);
    expect(distress.recoveryTrendSlope).toBeGreaterThan(concerning.recoveryTrendSlope);
    expect(distress.recoveryLast5Mean).toBeGreaterThan(normal.recoveryLast5Mean);
  });

  test('contractions are spaced far enough apart not to overlap', () => {
    const responses = simulateResponses('normal', { count: 5 });
    const minGap = (BASELINE_WINDOW + RESPONSE_WINDOW) * 1000;
    for (let i = 1; i < responses.length; i++) {
      const gap =
        responses[i]!.contractionPeakTime - responses[i - 1]!.contractionPeakTime;
      expect(gap).toBeGreaterThanOrEqual(minGap);
    }
  });

  test('rejects a spacing that would let windows overlap', () => {
    // The old screen used 2 s. That must now be impossible to ask for.
    expect(() => simulateResponses('normal', { spacingMs: 2_000 })).toThrow(
      /spacingMs/,
    );
  });
});
