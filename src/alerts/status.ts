/**
 * Alert status determination.
 *
 * Reference:
 *  - fetal-contraction-monitor-CLAUDE.md §"Alert Logic" (lines 168–191)
 *  - fetal-contraction-monitor-SPEC.md §5.1 (lines 254–302)
 *
 * Decision tree (ordered):
 *   1. n < MIN_CONTRACTIONS                                 → grey
 *   2. Recent signal quality too low OR detection conf low  → grey
 *   3. recoverySlope ≥ SLOPE_RED
 *      AND recoveryLast5Mean ≥ red_threshold
 *      AND redPersistenceCount ≥ RED_PERSISTENCE             → red
 *   4. recoverySlope ≥ SLOPE_YELLOW
 *      OR  recoveryLast5Mean ≥ yellow_threshold
 *      OR  nadirAcceleration > 0                             → yellow
 *   5. otherwise                                             → green
 *
 * Thresholds come from `adaptiveRecoveryThresholds(baseline)`, which floors
 * at the population values (SPEC.md §5.3).
 *
 * Persistence: RED only surfaces after the trajectory has been red-eligible
 * for RED_PERSISTENCE consecutive contractions. The caller owns the
 * persistence counter on the session so it survives reloads.
 */

import {
  CTX_CONFIDENCE_FLOOR,
  MIN_CONTRACTIONS,
  RED_PERSISTENCE,
  SLOPE_RED,
  SLOPE_YELLOW,
} from '../constants';
import { adaptiveRecoveryThresholds } from './personal-baseline';
import type {
  AlertStatus,
  ContractionResponse,
  PersonalBaseline,
  TrajectoryFeatures,
} from '../types';

export interface StatusInputs {
  features: TrajectoryFeatures;
  baseline: PersonalBaseline | null;
  /** Last few contractions — used for recent signal-quality gate. */
  recentContractions: readonly ContractionResponse[];
  /** Existing redPersistenceCount (from session state) going into this evaluation. */
  redPersistenceCount: number;
}

export interface StatusResult {
  status: AlertStatus;
  /** Updated redPersistenceCount to write back to the session. */
  redPersistenceCount: number;
  /** Reasons that triggered the status (for UI display / logging). */
  reasons: string[];
}

/**
 * Pure function. Does not mutate inputs.
 */
export function determineStatus(inputs: StatusInputs): StatusResult {
  const { features, baseline, recentContractions, redPersistenceCount } = inputs;
  const reasons: string[] = [];

  // 1. Insufficient-data gate.
  if (features.contractionCount < MIN_CONTRACTIONS) {
    reasons.push(`n=${features.contractionCount} < ${MIN_CONTRACTIONS}`);
    return { status: 'grey', redPersistenceCount: 0, reasons };
  }

  // 2. Quality gate. Check the last 3 contractions' FHR quality + confidence.
  const lastThree = recentContractions.slice(-3);
  const badQuality = lastThree.some((c) => c.fhrQuality < 0.5);
  const lowConfidence = lastThree.some(
    (c) => c.detectionConfidence < CTX_CONFIDENCE_FLOOR,
  );
  if (badQuality || lowConfidence) {
    if (badQuality) reasons.push('recent fhrQuality < 0.5');
    if (lowConfidence) reasons.push('recent detectionConfidence < floor');
    // Preserve persistence counter across quality blackouts — if we were on
    // track to surface RED, we don't want a single bad reading to reset it.
    return { status: 'grey', redPersistenceCount, reasons };
  }

  const thresholds = adaptiveRecoveryThresholds(baseline);

  const redEligible =
    features.recoveryTrendSlope >= SLOPE_RED &&
    features.recoveryLast5Mean >= thresholds.red;

  // Small tolerance on nadirAcceleration — with floating-point arithmetic
  // values like 1e-17 are spuriously "> 0". 0.05 depth-bpm/ctx² is the
  // smallest clinically meaningful change.
  const NADIR_ACCEL_EPS = 0.05;

  const yellowEligible =
    features.recoveryTrendSlope >= SLOPE_YELLOW ||
    features.recoveryLast5Mean >= thresholds.yellow ||
    features.nadirAcceleration > NADIR_ACCEL_EPS;

  if (redEligible) {
    const nextCount = redPersistenceCount + 1;
    if (nextCount >= RED_PERSISTENCE) {
      reasons.push(
        `slope ${features.recoveryTrendSlope.toFixed(2)} ≥ ${SLOPE_RED}`,
        `last5 ${features.recoveryLast5Mean.toFixed(1)} ≥ ${thresholds.red.toFixed(1)}`,
        `persistence ${nextCount}/${RED_PERSISTENCE}`,
      );
      return { status: 'red', redPersistenceCount: nextCount, reasons };
    }
    // Red-eligible but not yet sustained → fall through to yellow.
    reasons.push(`red-eligible (${nextCount}/${RED_PERSISTENCE})`);
    return { status: 'yellow', redPersistenceCount: nextCount, reasons };
  }

  if (yellowEligible) {
    if (features.recoveryTrendSlope >= SLOPE_YELLOW) {
      reasons.push(`slope ${features.recoveryTrendSlope.toFixed(2)} ≥ ${SLOPE_YELLOW}`);
    }
    if (features.recoveryLast5Mean >= thresholds.yellow) {
      reasons.push(
        `last5 ${features.recoveryLast5Mean.toFixed(1)} ≥ ${thresholds.yellow.toFixed(1)}`,
      );
    }
    if (features.nadirAcceleration > 0) {
      reasons.push(`nadirAccel ${features.nadirAcceleration.toFixed(2)} > 0`);
    }
    // Reset persistence counter — we dropped out of red-eligibility.
    return { status: 'yellow', redPersistenceCount: 0, reasons };
  }

  // Green: reset persistence.
  return { status: 'green', redPersistenceCount: 0, reasons: ['all indicators nominal'] };
}
