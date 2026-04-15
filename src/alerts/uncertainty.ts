/**
 * Uncertainty helpers — explicit human-readable "why is the status what it is?"
 * reasoning and statistical confidence helpers for the UI.
 *
 * Phase 3: "richer uncertainty display" (CODING_GUIDE §3 Phase 3).
 *
 * The core app never "fakes certainty" (CLAUDE.md §Architecture Principles).
 * These helpers let the UI say *exactly* what it knows and doesn't know:
 *   - How many contractions are needed before trajectory analysis kicks in.
 *   - The standard error on the recovery-trend slope.
 *   - Whether the grey state is "awaiting more data" vs. "signal too noisy".
 */

import { MIN_CONTRACTIONS } from '../constants';
import { mean, std } from '../extraction/statistics';
import type { AlertStatus, ContractionResponse, LaborSession } from '../types';

/**
 * Standard error of the OLS recovery-trend slope.
 *
 * SE_β = σ_residual / √(Σ(xᵢ − x̄)²)
 *
 * For a unit-spaced x axis of length n, Σ(xᵢ − x̄)² = n·(n² − 1)/12.
 * Returns 0 when the sample is too small (n < 3).
 */
export function slopeStandardError(ys: readonly number[]): number {
  const n = ys.length;
  if (n < 3) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);

  let num = 0;
  let denX = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    num += dx * (ys[i]! - yMean);
    denX += dx * dx;
  }
  if (denX === 0) return 0;
  const slope = num / denX;
  const intercept = yMean - slope * xMean;

  let residSq = 0;
  for (let i = 0; i < n; i++) {
    const yHat = intercept + slope * i;
    const r = ys[i]! - yHat;
    residSq += r * r;
  }
  const sigmaSq = residSq / (n - 2);
  if (sigmaSq <= 0) return 0;
  return Math.sqrt(sigmaSq / denX);
}

/**
 * Why is the session in a grey state right now?
 * Returns `null` if it is not grey (no uncertainty reason to show).
 */
export type GreyReason =
  | { kind: 'awaiting-data'; needed: number }
  | { kind: 'signal-quality' }
  | { kind: 'low-confidence' };

export function greyReason(session: LaborSession | null): GreyReason | null {
  if (session === null) return null;
  if (session.status !== 'grey') return null;

  const n = session.contractions.length;
  if (n < MIN_CONTRACTIONS) {
    return { kind: 'awaiting-data', needed: MIN_CONTRACTIONS - n };
  }

  const last3 = session.contractions.slice(-3);
  if (last3.some((c) => c.fhrQuality < 0.5)) {
    return { kind: 'signal-quality' };
  }
  if (last3.some((c) => c.detectionConfidence < 0.5)) {
    return { kind: 'low-confidence' };
  }
  // Should not happen — grey set for some other reason.
  return null;
}

export function describeGreyReason(r: GreyReason | null): string {
  if (r === null) return '';
  switch (r.kind) {
    case 'awaiting-data':
      return `Recording — ${r.needed} more contraction${r.needed === 1 ? '' : 's'} needed for trajectory analysis.`;
    case 'signal-quality':
      return 'Recent FHR signal quality is low — probe may be displaced.';
    case 'low-confidence':
      return 'Recent contraction detections had low confidence — add manual taps if needed.';
  }
}

/**
 * Summary of the recent FHR-quality trend across the last N contractions:
 *  "improving" | "stable" | "deteriorating".
 *
 * Uses a simple OLS slope of fhrQuality over the last 6 contractions.
 * Returns "stable" with fewer than 4 contractions (not enough signal).
 */
export type QualityTrend = 'improving' | 'stable' | 'deteriorating';

export function recentQualityTrend(
  contractions: readonly ContractionResponse[],
  window = 6,
): QualityTrend {
  const recent = contractions.slice(-window);
  if (recent.length < 4) return 'stable';
  const qs = recent.map((c) => c.fhrQuality);
  const m = mean(qs);
  const s = std(qs);
  // If samples are tightly clustered, call it stable.
  if (s < 0.02) return 'stable';

  // OLS slope
  const n = qs.length;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    num += dx * (qs[i]! - m);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  if (slope > 0.02) return 'improving';
  if (slope < -0.02) return 'deteriorating';
  return 'stable';
}

/**
 * Human-friendly description of the current alert status. The monitor screen
 * uses this for the subtitle — never "diagnoses", never recommends action
 * beyond "contact your provider" (CLAUDE.md §"What NOT To Build").
 */
export function statusLabel(status: AlertStatus): string {
  switch (status) {
    case 'grey':
      return 'Collecting data';
    case 'green':
      return 'Reassuring';
    case 'yellow':
      return 'Concerning';
    case 'red':
      return 'Alert — contact your provider';
  }
}
