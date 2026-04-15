/**
 * Trajectory features over a session of ContractionResponses.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §4.3 (lines 236–248) and §5.
 *
 * These features drive the alert logic. The slopes are plain OLS against a
 * unit-spaced contraction index (index 0, 1, 2, …), per SPEC.md §4.3:
 *   "Compute via standard linear regression (no library needed — OLS in ~10
 *    lines of TS)."
 *
 * `nadirAcceleration` requires ≥ 9 contractions; returns 0 below that.
 */

import {
  computeTrajectory,
} from '../torus/map-point';
import { giniCoefficient } from '../torus/math';
import { mean, median, olsSlope } from '../extraction/statistics';
import type { ContractionResponse, TrajectoryFeatures } from '../types';

/**
 * Compute trajectory features from a session's contraction list.
 *
 * Uses FIXED torus bounds for kappa computation — alert logic depends on
 * research-validated thresholds. See CLAUDE.md §"Critical Discovery".
 */
export function computeTrajectoryFeatures(
  contractions: readonly ContractionResponse[],
): TrajectoryFeatures {
  const n = contractions.length;
  if (n === 0) {
    return emptyFeatures();
  }

  const recoveries = contractions.map((c) => c.recoveryTime);
  const nadirs = contractions.map((c) => c.nadirDepth);
  const areas = contractions.map((c) => c.responseArea);

  // Kappa series from the fixed-bounds trajectory (endpoints are 0).
  const pts = computeTrajectory(contractions, 'fixed');
  // Drop the two endpoints (kappa = 0 by definition, not a real measurement).
  const kappas = pts.slice(1, -1).map((p) => p.kappa);

  return {
    kappaMedian: median(kappas),
    kappaGini: giniCoefficient(kappas),
    recoveryTrendSlope: olsSlope(recoveries),
    nadirTrendSlope: olsSlope(nadirs),
    recoveryLast5Mean: mean(recoveries.slice(-5)),
    nadirAcceleration: computeNadirAcceleration(nadirs),
    areaLast5Mean: mean(areas.slice(-5)),
    contractionCount: n,
  };
}

/**
 * SPEC.md §4.3: "slope(last third) − slope(first third), requires ≥9 ctx".
 * Returns 0 if too few contractions.
 *
 * Sign convention: the computation runs on DEPTH MAGNITUDES (|nadir|), so a
 * POSITIVE result means nadirs are deepening faster over time (i.e., the
 * concerning direction). This matches the spec's alert check
 * `nadirAcceleration > 0` (CLAUDE.md §"Alert Logic").
 */
export function computeNadirAcceleration(nadirs: readonly number[]): number {
  if (nadirs.length < 9) return 0;
  const depths = nadirs.map((n) => Math.abs(n));
  const third = Math.floor(depths.length / 3);
  const first = depths.slice(0, third);
  const last = depths.slice(-third);
  return olsSlope(last) - olsSlope(first);
}

function emptyFeatures(): TrajectoryFeatures {
  return {
    kappaMedian: 0,
    kappaGini: 0,
    recoveryTrendSlope: 0,
    nadirTrendSlope: 0,
    recoveryLast5Mean: 0,
    nadirAcceleration: 0,
    areaLast5Mean: 0,
    contractionCount: 0,
  };
}
