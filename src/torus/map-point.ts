/**
 * Map a ContractionResponse onto the flat torus T².
 *
 * Reference: fetal-contraction-monitor-SPEC.md §4.1 (lines 188–217) and
 * fetal-contraction-monitor-CLAUDE.md §"Critical Discovery: Fixed vs Adaptive
 * Normalization".
 *
 * Two normalization modes:
 *  - "adaptive": 2nd–98th percentile of session data (visualization)
 *  - "fixed":   population bounds (NADIR_MAP_*, RECOVERY_MAP_*) (alert-logic features)
 *
 * The default mode picks adaptive once we have ≥ MIN_CONTRACTIONS; fixed below.
 * Callers who need research-aligned trajectory features for alert thresholds
 * must explicitly request "fixed".
 *
 * Note on nadir bounds: `NADIR_MAP_MIN=0` is the numerically larger bound
 * (no drop), `NADIR_MAP_MAX=-50` is the smaller bound (max drop). `toAngle`
 * requires `min < max` numerically, so we pass (−50, 0).
 */

import { mengerCurvature } from './math';
import { toAngle } from './math';
import {
  MIN_CONTRACTIONS,
  NADIR_MAP_MAX,
  NADIR_MAP_MIN,
  RECOVERY_MAP_MAX,
  RECOVERY_MAP_MIN,
} from '../constants';
import { percentile } from '../extraction/statistics';
import type { ContractionResponse, TorusPoint } from '../types';

export type NormalizationMode = 'adaptive' | 'fixed' | 'auto';

export interface Bounds {
  nadirMin: number;
  nadirMax: number;
  recoveryMin: number;
  recoveryMax: number;
}

/** The research-validated population bounds (Paper V). */
export const FIXED_BOUNDS: Bounds = {
  nadirMin: NADIR_MAP_MAX, // -50 (most-negative bound passed as `min`)
  nadirMax: NADIR_MAP_MIN, // 0
  recoveryMin: RECOVERY_MAP_MIN,
  recoveryMax: RECOVERY_MAP_MAX,
};

/**
 * Compute adaptive 2nd–98th percentile bounds with a ±1 margin, per SPEC.md §4.1.
 * Caller must ensure `contractions` has enough points (≥ MIN_CONTRACTIONS) for
 * this to be meaningful; if fewer are passed, FIXED_BOUNDS is returned.
 */
export function adaptiveBounds(contractions: readonly ContractionResponse[]): Bounds {
  if (contractions.length < MIN_CONTRACTIONS) return FIXED_BOUNDS;
  const nadirs = contractions.map((c) => c.nadirDepth);
  const recoveries = contractions.map((c) => c.recoveryTime);
  return {
    nadirMin: percentile(nadirs, 2) - 1,
    nadirMax: percentile(nadirs, 98) + 1,
    recoveryMin: percentile(recoveries, 2) - 1,
    recoveryMax: percentile(recoveries, 98) + 1,
  };
}

/** Resolve the bounds according to `mode`. */
export function resolveBounds(
  contractions: readonly ContractionResponse[],
  mode: NormalizationMode,
): Bounds {
  if (mode === 'fixed') return FIXED_BOUNDS;
  if (mode === 'adaptive') return adaptiveBounds(contractions);
  // auto
  return contractions.length >= MIN_CONTRACTIONS
    ? adaptiveBounds(contractions)
    : FIXED_BOUNDS;
}

/**
 * Build a single TorusPoint for `contraction`. The returned point has `kappa = 0`;
 * curvature is filled in by `updateKappa` once three consecutive points exist.
 */
export function computeTorusPoint(
  contraction: ContractionResponse,
  bounds: Bounds,
): TorusPoint {
  return {
    theta1: toAngle(contraction.nadirDepth, bounds.nadirMin, bounds.nadirMax),
    theta2: toAngle(contraction.recoveryTime, bounds.recoveryMin, bounds.recoveryMax),
    kappa: 0,
    contractionId: contraction.id,
  };
}

/**
 * Build the full TorusPoint sequence from a list of responses, back-filling
 * `kappa` on every middle point via Menger curvature.
 *
 * Mode semantics:
 *   - "fixed":    use population bounds (for alert-logic features)
 *   - "adaptive": use session percentile bounds (for visualization)
 *   - "auto":     adaptive if n ≥ MIN_CONTRACTIONS, fixed otherwise
 */
export function computeTrajectory(
  contractions: readonly ContractionResponse[],
  mode: NormalizationMode = 'auto',
): TorusPoint[] {
  const bounds = resolveBounds(contractions, mode);
  const pts = contractions.map((c) => computeTorusPoint(c, bounds));

  // Fill kappa for interior points (indices 1..n-2).
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    b.kappa = mengerCurvature(
      [a.theta1, a.theta2],
      [b.theta1, b.theta2],
      [c.theta1, c.theta2],
    );
  }
  return pts;
}

/**
 * Incremental update: given an existing trajectory and a newly appended
 * contraction, return the new trajectory with the previously-last point's
 * kappa back-filled (SPEC.md §4.2).
 */
export function appendAndUpdateKappa(
  existingPts: readonly TorusPoint[],
  contractions: readonly ContractionResponse[],
  mode: NormalizationMode = 'auto',
): TorusPoint[] {
  // For simplicity and correctness, recompute from the full list. In a production
  // app with large session counts we'd cache bounds; for typical labor
  // sessions (20–40 contractions) this is trivial cost.
  void existingPts;
  return computeTrajectory(contractions, mode);
}
