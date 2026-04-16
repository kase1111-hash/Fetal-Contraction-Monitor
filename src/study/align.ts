/**
 * Stream alignment for equivalence analysis.
 *
 * Given two FHRSample[] arrays (A = consumer, B = clinical) that may
 * have different sample rates, different start offsets, and independent
 * dropouts, produce a pair of aligned series on a common uniform grid
 * suitable for Bland-Altman and feature-level comparison.
 *
 * Strategy:
 *   1. Pick a common target rate (default 2 Hz — matches consumer Doppler
 *      typical rate and down-samples clinical 4 Hz CTG by a factor of 2).
 *   2. Determine the overlap window [max(startA, startB), min(endA, endB)].
 *   3. For every grid tick in the overlap, pull the nearest valid sample
 *      from each stream. If the nearest valid sample is farther than
 *      `maxLagMs` (default 2 seconds), the tick is dropped.
 *   4. Emit aligned (t, fhrA, fhrB) triples.
 *
 * The nearest-valid-within-lag policy handles dropouts gracefully: a gap
 * in either stream becomes missing alignment ticks, not interpolated
 * values. Interpolation would introduce synthetic agreement that would
 * bias equivalence statistics.
 */

import type { FHRSample } from '../types';

export interface AlignedPoint {
  t: number;
  fhrA: number;
  fhrB: number;
}

export interface AlignOptions {
  /** Target sample rate in Hz. Default 2. */
  targetHz?: number;
  /** Maximum lag (ms) between grid tick and nearest valid sample. Default 2000. */
  maxLagMs?: number;
}

export interface AlignmentReport {
  aligned: AlignedPoint[];
  /** Overlap window start (Unix ms). */
  from: number;
  /** Overlap window end (Unix ms). */
  to: number;
  /** Number of grid ticks in the overlap. */
  gridTicks: number;
  /** Number of ticks dropped because one or both streams lacked a valid sample. */
  dropped: number;
}

/**
 * Binary search: return the index of the first sample with timestamp >= t.
 * Returns samples.length if t is past the last sample.
 */
function lowerBound(samples: readonly FHRSample[], t: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid]!.timestamp < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Nearest valid sample to `t` within ±maxLagMs, or null if none.
 * Uses binary search so each lookup is O(log n).
 */
function nearestValid(
  samples: readonly FHRSample[],
  t: number,
  maxLagMs: number,
): FHRSample | null {
  if (samples.length === 0) return null;
  const idx = lowerBound(samples, t);
  // Candidates: idx-1 (last sample before t) and idx (first at or after t).
  // Scan outward from there, skipping invalid samples.
  let bestDt = Infinity;
  let best: FHRSample | null = null;
  for (let delta = 0; delta < samples.length; delta++) {
    const left = idx - 1 - delta;
    const right = idx + delta;
    const left_sample = left >= 0 ? samples[left] : undefined;
    const right_sample = right < samples.length ? samples[right] : undefined;

    // Early termination: if both current candidates are out of range
    // (or past-lag), no closer candidate exists further out.
    let progressed = false;
    if (left_sample !== undefined) {
      const dt = Math.abs(t - left_sample.timestamp);
      if (dt <= maxLagMs && left_sample.valid && dt < bestDt) {
        bestDt = dt;
        best = left_sample;
        progressed = true;
      } else if (dt <= maxLagMs) {
        progressed = true;
      }
    }
    if (right_sample !== undefined) {
      const dt = Math.abs(right_sample.timestamp - t);
      if (dt <= maxLagMs && right_sample.valid && dt < bestDt) {
        bestDt = dt;
        best = right_sample;
        progressed = true;
      } else if (dt <= maxLagMs) {
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return best;
}

function span(samples: readonly FHRSample[]): { from: number; to: number } | null {
  if (samples.length === 0) return null;
  return {
    from: samples[0]!.timestamp,
    to: samples[samples.length - 1]!.timestamp,
  };
}

export function alignStreams(
  a: readonly FHRSample[],
  b: readonly FHRSample[],
  opts: AlignOptions = {},
): AlignmentReport {
  const targetHz = opts.targetHz ?? 2;
  const maxLagMs = opts.maxLagMs ?? 2000;
  const stepMs = Math.round(1000 / targetHz);

  const spanA = span(a);
  const spanB = span(b);

  if (spanA === null || spanB === null) {
    return { aligned: [], from: 0, to: 0, gridTicks: 0, dropped: 0 };
  }

  const from = Math.max(spanA.from, spanB.from);
  const to = Math.min(spanA.to, spanB.to);
  if (to < from) {
    return { aligned: [], from, to, gridTicks: 0, dropped: 0 };
  }

  const aligned: AlignedPoint[] = [];
  let gridTicks = 0;
  let dropped = 0;
  for (let t = from; t <= to; t += stepMs) {
    gridTicks += 1;
    const sa = nearestValid(a, t, maxLagMs);
    const sb = nearestValid(b, t, maxLagMs);
    if (sa === null || sb === null) {
      dropped += 1;
      continue;
    }
    aligned.push({ t, fhrA: sa.fhr, fhrB: sb.fhr });
  }

  return { aligned, from, to, gridTicks, dropped };
}
