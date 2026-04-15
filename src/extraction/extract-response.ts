/**
 * Per-contraction FHR response extraction.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §3 (lines 126–180).
 *
 * Pipeline:
 *   1. Collect FHR samples in [peak − BASELINE_WINDOW, peak].
 *   2. Require MIN_BASELINE_VALID fraction to be valid; compute median baseline.
 *   3. Reject if baseline outside [BASELINE_RANGE_MIN, BASELINE_RANGE_MAX].
 *   4. Collect response window [peak, peak + RESPONSE_WINDOW].
 *   5. Compute deviation = fhr − baseline, then nadir depth, nadir timing,
 *      recovery time (first sustained 5 s inside ±RECOVERY_THRESHOLD), and
 *      response area (integral of deviations below baseline, bpm·s).
 *   6. Assign a quality grade.
 */

import {
  BASELINE_WINDOW,
  RESPONSE_WINDOW,
  RECOVERY_THRESHOLD,
  MIN_BASELINE_VALID,
  MIN_RESPONSE_VALID,
  BASELINE_RANGE_MIN,
  BASELINE_RANGE_MAX,
} from '../constants';
import { median } from './statistics';
import type {
  ContractionDetection,
  ContractionResponse,
  FHRSample,
  ResponseQuality,
} from '../types';

/** Result of an extraction attempt. */
export type ExtractionResult =
  | { ok: true; response: ContractionResponse }
  | { ok: false; reason: ExtractionRejection };

export type ExtractionRejection =
  | 'baseline-insufficient-samples'
  | 'baseline-out-of-range'
  | 'response-insufficient-samples';

export interface ExtractContext {
  /** Detection that triggered extraction. */
  detection: ContractionDetection;
  /** All FHR samples covering at least [peak − 30s, peak + 60s]. */
  samples: readonly FHRSample[];
  /** Unique id to assign to the resulting ContractionResponse. */
  id: string;
  /** Wall-clock now (for ContractionResponse.timestamp). Defaults to Date.now(). */
  now?: () => number;
}

export function extractResponse(ctx: ExtractContext): ExtractionResult {
  const { detection, samples } = ctx;
  const now = ctx.now ?? (() => Date.now());

  // 1–2. Baseline
  const baselineFrom = detection.peakTimestamp - BASELINE_WINDOW * 1000;
  const baselineWindow = samples.filter(
    (s) => s.timestamp >= baselineFrom && s.timestamp <= detection.peakTimestamp,
  );
  const baselineValid = baselineWindow.filter((s) => s.valid);
  const baselineQuality =
    baselineWindow.length === 0 ? 0 : baselineValid.length / baselineWindow.length;

  if (baselineQuality < MIN_BASELINE_VALID || baselineValid.length === 0) {
    return { ok: false, reason: 'baseline-insufficient-samples' };
  }

  const baselineFHR = median(baselineValid.map((s) => s.fhr));
  if (baselineFHR < BASELINE_RANGE_MIN || baselineFHR > BASELINE_RANGE_MAX) {
    return { ok: false, reason: 'baseline-out-of-range' };
  }

  // 4. Response window
  const responseTo = detection.peakTimestamp + RESPONSE_WINDOW * 1000;
  const responseWindow = samples.filter(
    (s) => s.timestamp >= detection.peakTimestamp && s.timestamp <= responseTo,
  );
  const responseValid = responseWindow.filter((s) => s.valid);
  const fhrQuality =
    responseWindow.length === 0 ? 0 : responseValid.length / responseWindow.length;

  if (fhrQuality < MIN_RESPONSE_VALID || responseValid.length < 2) {
    return { ok: false, reason: 'response-insufficient-samples' };
  }

  // 5. Features. We work in (t_offset_seconds, deviation) pairs over the valid
  // response samples — irregular sample rate friendly.
  const pairs = responseValid.map((s) => ({
    tSec: (s.timestamp - detection.peakTimestamp) / 1000,
    dev: s.fhr - baselineFHR,
  }));

  // Nadir: minimum deviation (most negative); timing = its tSec.
  let nadirDepth = 0; // a nadir of 0 means "no drop"
  let nadirTiming = 0;
  for (const p of pairs) {
    if (p.dev < nadirDepth) {
      nadirDepth = p.dev;
      nadirTiming = p.tSec;
    }
  }

  // Recovery time: first time t >= nadirTiming at which a 5-second window
  // starting at t is entirely within ±RECOVERY_THRESHOLD of baseline.
  // Default to RESPONSE_WINDOW if no such window exists.
  let recoveryTime = RESPONSE_WINDOW;
  for (let i = 0; i < pairs.length; i++) {
    const start = pairs[i]!;
    if (start.tSec < nadirTiming) continue;
    // Build a 5 s window
    let ok = true;
    let windowEndSeen = false;
    for (let j = i; j < pairs.length; j++) {
      const p = pairs[j]!;
      const dt = p.tSec - start.tSec;
      if (dt > 5) {
        windowEndSeen = true;
        break;
      }
      if (Math.abs(p.dev) >= RECOVERY_THRESHOLD) {
        ok = false;
        break;
      }
    }
    if (ok && windowEndSeen) {
      recoveryTime = start.tSec;
      break;
    }
  }

  // Response area: trapezoidal integral of deviation_below_baseline over tSec (bpm·s).
  let responseArea = 0;
  for (let i = 1; i < pairs.length; i++) {
    const a = pairs[i - 1]!;
    const b = pairs[i]!;
    const aBelow = Math.min(a.dev, 0);
    const bBelow = Math.min(b.dev, 0);
    const dt = b.tSec - a.tSec;
    responseArea += ((aBelow + bBelow) / 2) * dt;
  }

  // 6. Quality grade (SPEC.md §3.4)
  const qualityGrade = gradeQuality(detection.confidence, fhrQuality, baselineFHR);

  const response: ContractionResponse = {
    id: ctx.id,
    timestamp: now(),
    contractionPeakTime: detection.peakTimestamp,
    detectionMethod: detection.method,
    detectionConfidence: detection.confidence,
    baselineFHR,
    nadirDepth,
    nadirTiming,
    recoveryTime,
    responseArea,
    fhrQuality,
    qualityGrade,
  };

  return { ok: true, response };
}

/**
 * SPEC.md §3.4:
 *   good: confidence ≥ 0.7 AND fhrQuality ≥ 0.8 AND baseline in [100, 180]
 *   fair: confidence ≥ 0.5 AND fhrQuality ≥ 0.6
 *   poor: otherwise
 */
export function gradeQuality(
  detectionConfidence: number,
  fhrQuality: number,
  baselineFHR: number,
): ResponseQuality {
  const baselineOk =
    baselineFHR >= BASELINE_RANGE_MIN && baselineFHR <= BASELINE_RANGE_MAX;
  if (detectionConfidence >= 0.7 && fhrQuality >= 0.8 && baselineOk) return 'good';
  if (detectionConfidence >= 0.5 && fhrQuality >= 0.6) return 'fair';
  return 'poor';
}
