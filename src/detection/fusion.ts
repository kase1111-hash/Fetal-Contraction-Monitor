/**
 * Bayesian fusion of contraction detections.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §2.4 "Fusion" (lines 109–117)
 * and §2.1 "Confidence scoring" (FHR confirmation rule, lines 76–80).
 *
 * Rules:
 *   - Manual + accelerometer detections within MERGE_WINDOW_S are merged:
 *     timestamp = manual (user is ground truth), confidence = 1.0
 *     (max(accel, 1.0) = 1.0).
 *   - Accelerometer-only: keep as-is; may be upgraded later by FHR.
 *   - Manual-only: keep as-is (confidence 1).
 *   - TOCO: highest priority; not merged (external sensor is authoritative).
 *
 * FHR confirmation (deferred to a companion helper `applyFhrConfirmation`):
 *   - If FHR shows a deceleration (≥10 bpm below baseline for ≥10 s) within
 *     FHR_CONFIRM_WINDOW_S after the detection, confidence +0.2, fhrConfirmed=true.
 *   - If accelerometer fires but no FHR response follows within 90 s,
 *     confidence × 0.5 (halved), fhrConfirmed=false, prominenceRaw unchanged.
 *   - The confirmation happens AFTER the response window closes (i.e., after
 *     ContractionQueue.tick extracts the response), so it can read the
 *     ContractionResponse directly and doesn't need raw FHR samples here.
 */

import type { ContractionDetection, ContractionResponse } from '../types';

/** Window (seconds) within which a manual tap merges with an accel detection. */
export const MERGE_WINDOW_S = 30;

/** Window (seconds) after an accel peak within which FHR must confirm. */
export const FHR_CONFIRM_WINDOW_S = 90;

/** bpm below baseline that counts as a deceleration. */
export const DECEL_DEPTH_BPM = 10;

/** Seconds the deceleration must persist. */
export const DECEL_DURATION_S = 10;

/** Input with each detection's source kept explicit so fusion can prioritize. */
export interface DetectionSet {
  accelerometer: ContractionDetection[];
  manual: ContractionDetection[];
  toco: ContractionDetection[];
}

/**
 * Fuse a (time-sorted, or unsorted) set of same-moment detections.
 * Returns a single canonical list sorted by peakTimestamp.
 *
 * Merging respects the priority: TOCO > manual > accelerometer, but manual
 * + accelerometer merges bump confidence to 1.0 per the spec.
 */
export function fuse(set: DetectionSet): ContractionDetection[] {
  const out: ContractionDetection[] = [];

  // TOCO wins outright. Any accel/manual within MERGE_WINDOW_S of a TOCO
  // detection is absorbed by the TOCO timestamp.
  const consumed = new Set<number>(); // indexes into accelerometer/manual arrays
  // Encode (source, index) — we'll pack as `src*1e6+idx` to keep single set.

  for (const t of set.toco) {
    out.push({ ...t, confidence: Math.max(t.confidence, 1.0) });
    set.accelerometer.forEach((a, i) => {
      if (withinWindow(a.peakTimestamp, t.peakTimestamp, MERGE_WINDOW_S))
        consumed.add(idx('a', i));
    });
    set.manual.forEach((m, i) => {
      if (withinWindow(m.peakTimestamp, t.peakTimestamp, MERGE_WINDOW_S))
        consumed.add(idx('m', i));
    });
  }

  // Manual ⊕ accelerometer merges.
  set.manual.forEach((m, mi) => {
    if (consumed.has(idx('m', mi))) return;
    // Find an accel detection within window.
    let mergedConf = m.confidence;
    let prominence: number | undefined;
    let fhrConfirmed = m.fhrConfirmed;
    set.accelerometer.forEach((a, ai) => {
      if (consumed.has(idx('a', ai))) return;
      if (withinWindow(a.peakTimestamp, m.peakTimestamp, MERGE_WINDOW_S)) {
        consumed.add(idx('a', ai));
        mergedConf = Math.max(mergedConf, a.confidence);
        prominence = a.prominenceRaw;
        fhrConfirmed = fhrConfirmed || a.fhrConfirmed;
      }
    });
    out.push({
      ...m,
      confidence: Math.min(1, Math.max(1.0, mergedConf)), // manual pins floor at 1
      prominenceRaw: prominence,
      fhrConfirmed,
    });
  });

  // Surviving accelerometer-only.
  set.accelerometer.forEach((a, ai) => {
    if (consumed.has(idx('a', ai))) return;
    out.push({ ...a });
  });

  return out.sort((x, y) => x.peakTimestamp - y.peakTimestamp);
}

function withinWindow(a: number, b: number, seconds: number): boolean {
  return Math.abs(a - b) / 1000 <= seconds;
}

function idx(src: 'a' | 'm', i: number): number {
  return (src === 'a' ? 0 : 1) * 1e9 + i;
}

// ---------------------------------------------------------------------------
// FHR confirmation
// ---------------------------------------------------------------------------

/**
 * Apply FHR-based confidence adjustment to an accelerometer detection,
 * given the extracted response for that contraction (or null if no response
 * was produced within FHR_CONFIRM_WINDOW_S).
 *
 * Returns a *new* ContractionDetection with:
 *   - `fhrConfirmed = true`  + `confidence += 0.2` if a qualifying deceleration
 *     occurred within FHR_CONFIRM_WINDOW_S, else
 *   - `fhrConfirmed = false` + `confidence × 0.5` if accel-only and no
 *     qualifying response occurred within the window.
 *
 * Manual and TOCO detections are returned unchanged (they don't need
 * accelerometer corroboration).
 */
export function applyFhrConfirmation(
  detection: ContractionDetection,
  response: ContractionResponse | null,
): ContractionDetection {
  if (detection.method !== 'accelerometer') return detection;

  if (response === null) {
    // No extractable response within the window → accel is uncorroborated.
    return { ...detection, confidence: detection.confidence * 0.5, fhrConfirmed: false };
  }

  // Is there a qualifying deceleration? Response already measured nadir and
  // responseArea; use those. nadirDepth ≤ -DECEL_DEPTH_BPM is the depth test;
  // the duration test is conservatively approximated by the integrated area
  // (|area| ≥ depth * duration → at least ~100 bpm·s for 10 bpm × 10 s).
  const qualifies =
    response.nadirDepth <= -DECEL_DEPTH_BPM &&
    Math.abs(response.responseArea) >= DECEL_DEPTH_BPM * DECEL_DURATION_S;

  if (qualifies) {
    return {
      ...detection,
      confidence: Math.min(1, detection.confidence + 0.2),
      fhrConfirmed: true,
    };
  }
  return { ...detection, confidence: detection.confidence * 0.5, fhrConfirmed: false };
}
