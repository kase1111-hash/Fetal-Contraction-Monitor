/**
 * Per-sample FHR quality gate.
 *
 * Reference: SPEC.md §1.2 "Quality gate (per sample)" (lines 51–56).
 *
 * - fhr < FHR_MIN || fhr > FHR_MAX  → invalid (artifact or maternal)
 * - Gap since last valid sample > FHR_GAP_THRESHOLD  → gap event
 * - Rolling CV in 5 s window > FHR_CV_THRESHOLD  → possibly maternal signal
 */

import { FHR_MIN, FHR_MAX, FHR_GAP_THRESHOLD, FHR_CV_THRESHOLD } from '../constants';
import type { FHRSample } from '../types';

/**
 * Bounds check for a single FHR reading. Used when constructing an FHRSample.
 * Boundary values are INCLUSIVE: 80 and 200 are accepted (SPEC.md §10 test).
 */
export function isFhrValueValid(bpm: number): boolean {
  if (!Number.isFinite(bpm)) return false;
  return bpm >= FHR_MIN && bpm <= FHR_MAX;
}

/**
 * Returns true if more than FHR_GAP_THRESHOLD seconds have passed between the
 * two samples. Uses a strict inequality so a gap of exactly 10.0 s is NOT
 * flagged (SPEC.md §10 boundary: 9.9 s vs 10.1 s).
 */
export function isGap(prev: FHRSample | null, next: FHRSample): boolean {
  if (prev === null) return false;
  const dtSeconds = (next.timestamp - prev.timestamp) / 1000;
  return dtSeconds > FHR_GAP_THRESHOLD;
}

/**
 * Coefficient of variation (std / mean) over the samples whose timestamps
 * fall within [now - 5s, now]. Returns 0 if fewer than 2 valid samples.
 *
 * A CV above FHR_CV_THRESHOLD indicates the signal may be tracking the
 * maternal heart rate rather than the fetal one.
 */
export function rollingCv(samples: readonly FHRSample[], nowMs: number): number {
  const windowStart = nowMs - 5_000;
  const xs: number[] = [];
  for (const s of samples) {
    if (!s.valid) continue;
    if (s.timestamp < windowStart) continue;
    if (s.timestamp > nowMs) continue;
    xs.push(s.fhr);
  }
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length;
  const sd = Math.sqrt(variance);
  return sd / mean;
}

export function isPossiblyMaternal(cv: number): boolean {
  return cv > FHR_CV_THRESHOLD;
}

/**
 * Build a quality-gated FHRSample from a raw reading.
 * Does NOT perform gap or CV checks — those require knowledge of the full
 * buffer and are evaluated by the buffer itself.
 */
export function makeSample(
  fhr: number,
  timestamp: number,
  source: 'rr' | 'hr',
): FHRSample {
  return {
    fhr,
    timestamp,
    source,
    valid: isFhrValueValid(fhr),
  };
}
