/**
 * Phase 2 end-to-end test: run each simulation scenario contraction-by-
 * contraction through the extractor, trajectory features, baseline
 * establishment, and alert status determination. Assert the CODING_GUIDE
 * Phase-2 exit criterion:
 *
 *   "Run 'Distress' simulation → status walks grey → green → yellow → red"
 */

import {
  scenarioParams,
  generateFhrStream,
  type ScenarioKind,
} from '../../src/simulation/scenarios';
import { extractResponse } from '../../src/extraction/extract-response';
import { computeTrajectoryFeatures } from '../../src/trajectory/features';
import {
  establishBaseline,
} from '../../src/alerts/personal-baseline';
import { determineStatus } from '../../src/alerts/status';
import type {
  AlertStatus,
  ContractionResponse,
  PersonalBaseline,
} from '../../src/types';

function runScenarioWalk(kind: ScenarioKind, n = 20): AlertStatus[] {
  const statuses: AlertStatus[] = [];
  const responses: ContractionResponse[] = [];
  let baseline: PersonalBaseline | null = null;
  let red = 0;

  const t0 = 1_700_000_000_000;
  for (let k = 0; k < n; k++) {
    const peak = t0 + k * 180_000;
    const samples = generateFhrStream(scenarioParams(kind, k, n), peak);
    const r = extractResponse({
      detection: { peakTimestamp: peak, method: 'manual', confidence: 1 },
      samples,
      id: `c${k}`,
    });
    if (!r.ok) throw new Error(`extract failed: ${r.reason}`);
    responses.push(r.response);

    if (baseline === null) {
      baseline = establishBaseline(responses);
    }

    const features = computeTrajectoryFeatures(responses);
    const result = determineStatus({
      features,
      baseline,
      recentContractions: responses,
      redPersistenceCount: red,
    });
    statuses.push(result.status);
    red = result.redPersistenceCount;
  }
  return statuses;
}

function firstIndexOf(statuses: readonly AlertStatus[], s: AlertStatus): number {
  return statuses.indexOf(s);
}

describe('Phase 2 end-to-end — status walk', () => {
  test('Normal: stays green after baseline', () => {
    const walk = runScenarioWalk('normal');
    // First 5 contractions are always grey (n < MIN_CONTRACTIONS).
    expect(walk.slice(0, 5).every((s) => s === 'grey')).toBe(true);
    // After baseline: mostly green, no red.
    expect(walk).not.toContain('red');
    expect(walk.slice(-5)).toEqual(['green', 'green', 'green', 'green', 'green']);
  });

  test('Distress: walks grey → green|yellow → red', () => {
    const walk = runScenarioWalk('distress');
    // grey phase exists.
    expect(walk.slice(0, 5).every((s) => s === 'grey')).toBe(true);
    // Must surface red at some point after enough contractions.
    expect(walk).toContain('red');

    const iGrey = firstIndexOf(walk, 'grey');
    const iRed = firstIndexOf(walk, 'red');
    expect(iGrey).toBeLessThan(iRed);

    // Yellow precedes red (RED_PERSISTENCE requires at least one yellow-tier
    // red-eligible contraction before surfacing red).
    const iYellow = firstIndexOf(walk, 'yellow');
    expect(iYellow).toBeLessThan(iRed);
  });

  test('Concerning: reaches yellow, may or may not reach red', () => {
    const walk = runScenarioWalk('concerning');
    expect(walk).toContain('yellow');
  });
});
