/**
 * Personal baseline — computed from the first MIN_CONTRACTIONS responses
 * and then FROZEN for the remainder of the session.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §5.3 (lines 316–333).
 *
 * "Baseline is frozen once established (does not update with new
 *  contractions). This ensures that late-labor deterioration is measured
 *  against early-labor baseline, not a drifting reference."
 */

import { MIN_CONTRACTIONS, LAST5_RED, LAST5_YELLOW } from '../constants';
import { mean, std } from '../extraction/statistics';
import type { ContractionResponse, PersonalBaseline } from '../types';

/**
 * Compute the personal baseline from the first MIN_CONTRACTIONS contractions.
 * Returns null if insufficient data.
 *
 * Pure — does not mutate state. Callers are responsible for storing the
 * result on the session and NOT recomputing it as new contractions arrive.
 */
export function establishBaseline(
  contractions: readonly ContractionResponse[],
): PersonalBaseline | null {
  if (contractions.length < MIN_CONTRACTIONS) return null;
  const first = contractions.slice(0, MIN_CONTRACTIONS);
  const recoveries = first.map((c) => c.recoveryTime);
  const nadirs = first.map((c) => c.nadirDepth);
  return {
    recoveryMean: mean(recoveries),
    recoverySd: std(recoveries),
    nadirMean: mean(nadirs),
    nadirSd: std(nadirs),
  };
}

/**
 * Adaptive thresholds derived from the personal baseline.
 *
 * Per SPEC.md §5.1:
 *   yellowRecovery = min(LAST5_YELLOW, baseline.recoveryMean + baseline.recoverySd)
 *   redRecovery    = min(LAST5_RED,    baseline.recoveryMean + 2 * baseline.recoverySd)
 *
 * I.e. the population thresholds act as a FLOOR — a person whose baseline is
 * already elevated never has their yellow/red thresholds pushed above the
 * population values. A person whose baseline is quiet gets tighter personal
 * thresholds.
 *
 * If no baseline has been established (n < MIN_CONTRACTIONS), the population
 * thresholds are returned unchanged.
 */
export function adaptiveRecoveryThresholds(
  baseline: PersonalBaseline | null,
): { yellow: number; red: number } {
  if (baseline === null) {
    return { yellow: LAST5_YELLOW, red: LAST5_RED };
  }
  return {
    yellow: Math.min(LAST5_YELLOW, baseline.recoveryMean + baseline.recoverySd),
    red: Math.min(LAST5_RED, baseline.recoveryMean + 2 * baseline.recoverySd),
  };
}
