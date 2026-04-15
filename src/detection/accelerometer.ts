/**
 * Accelerometer-based contraction detection.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §2.1 (lines 66–91).
 *
 * Pipeline:
 *   1. Downsample raw accel to 4 Hz by averaging each 250 ms window.
 *   2. 10 s causal moving-average low-pass on the 4 Hz stream.
 *   3. 30 s rolling std of the filtered signal.
 *   4. Adaptive threshold = CTX_PROMINENCE_FRACTION × (p95 − p5) of the last
 *      10 minutes of rolling-std, with a floor of 0.01 g.
 *   5. Peak detection: local max of rolling-std with prominence ≥ threshold
 *      and inter-peak distance ≥ CTX_MIN_DISTANCE.
 *   6. Confidence = clip(prominence / (2·threshold), 0.3, 0.9), plus timing
 *      bonus (+0.1 if inter-peak within ±30% of running mean interval), plus
 *      FHR-confirmation bonus (+0.2), clipped to [0, 1].
 *
 * The detector is implemented as a streaming state machine — call `push()`
 * for each raw sample, and `finalize()` once when the stream ends. This
 * matches how the expo-sensors subscription will deliver data in production
 * and keeps the detector fully unit-testable by shoveling synthetic data in.
 *
 * IMPORTANT: The FHR-confirmation bonus is applied AFTER detection by the
 * fusion layer, which has access to the FHR stream. `push()` returns the
 * raw, unconfirmed detection; fusion.ts upgrades it.
 */

import {
  CTX_MIN_DISTANCE,
  CTX_PROMINENCE_FRACTION,
  CTX_SMOOTHING_WINDOW,
} from '../constants';
import { mean, percentile, std } from '../extraction/statistics';
import type { ContractionDetection } from '../types';

export interface RawAccelSample {
  /** Unix ms. */
  t: number;
  /** Z-axis acceleration in g (gravity units). */
  z: number;
}

/** Tuning knobs with defaults matching SPEC.md §2.1. */
export interface DetectorOptions {
  /** Target downsample rate. Defaults to 4 Hz. */
  downsampleHz?: number;
  /** Low-pass window in seconds. Defaults to CTX_SMOOTHING_WINDOW (10 s). */
  lowpassSeconds?: number;
  /** Rolling-std window in seconds. Defaults to 30 s (per spec). */
  stdWindowSeconds?: number;
  /** Lookback for adaptive threshold. Defaults to 10 minutes. */
  adaptiveLookbackSeconds?: number;
  /** Minimum prominence (g) floor. Defaults to 0.01. */
  minProminence?: number;
  /** Minimum inter-peak distance. Defaults to CTX_MIN_DISTANCE. */
  minDistanceSeconds?: number;
}

export class AccelDetector {
  private readonly opts: Required<DetectorOptions>;

  /** Downsample accumulator. */
  private bucketStart = 0;
  private bucketSum = 0;
  private bucketCount = 0;
  /** Downsampled series: {t, z}. */
  private downs: { t: number; z: number }[] = [];
  /** Low-pass filtered series: {t, lp}. */
  private lp: { t: number; lp: number }[] = [];
  /** Rolling-std series: {t, s}. */
  private rstd: { t: number; s: number }[] = [];

  /** Accepted peak timestamps (ms) — for minimum-distance gating. */
  private acceptedPeakTs: number[] = [];
  /** Inter-peak intervals in seconds. Used for the timing bonus. */
  private peakIntervals: number[] = [];

  /** Per-bucket index within rstd we've advanced the peak scan through. */
  private scanCursor = 0;

  constructor(opts: DetectorOptions = {}) {
    this.opts = {
      downsampleHz: opts.downsampleHz ?? 4,
      lowpassSeconds: opts.lowpassSeconds ?? CTX_SMOOTHING_WINDOW,
      stdWindowSeconds: opts.stdWindowSeconds ?? 30,
      adaptiveLookbackSeconds: opts.adaptiveLookbackSeconds ?? 600,
      minProminence: opts.minProminence ?? 0.01,
      minDistanceSeconds: opts.minDistanceSeconds ?? CTX_MIN_DISTANCE,
    };
  }

  /**
   * Push a raw sample. May emit 0+ contraction detections as new peaks clear
   * their prominence window.
   */
  push(sample: RawAccelSample): ContractionDetection[] {
    this.ingestDownsample(sample);
    // After each push, advance the pipeline and emit any new peaks.
    return this.scanForPeaks();
  }

  /** Flush any in-flight downsample bucket. Call once at end-of-stream. */
  finalize(): ContractionDetection[] {
    this.flushBucket();
    return this.scanForPeaks();
  }

  /** Expose internals for testing. */
  _debug(): {
    downs: readonly { t: number; z: number }[];
    lp: readonly { t: number; lp: number }[];
    rstd: readonly { t: number; s: number }[];
    acceptedPeakTs: readonly number[];
  } {
    return {
      downs: this.downs,
      lp: this.lp,
      rstd: this.rstd,
      acceptedPeakTs: this.acceptedPeakTs,
    };
  }

  // ----- Downsample ---------------------------------------------------------

  private ingestDownsample(s: RawAccelSample): void {
    const binMs = 1000 / this.opts.downsampleHz;
    if (this.bucketCount === 0) {
      this.bucketStart = s.t - (s.t % binMs);
    }
    const bucketEnd = this.bucketStart + binMs;
    if (s.t < bucketEnd) {
      this.bucketSum += s.z;
      this.bucketCount += 1;
    } else {
      // Close current bucket, open new one.
      this.flushBucket();
      this.bucketStart = s.t - (s.t % binMs);
      this.bucketSum = s.z;
      this.bucketCount = 1;
    }
  }

  private flushBucket(): void {
    if (this.bucketCount === 0) return;
    const binMs = 1000 / this.opts.downsampleHz;
    const t = this.bucketStart + binMs / 2;
    const z = this.bucketSum / this.bucketCount;
    this.downs.push({ t, z });
    this.bucketSum = 0;
    this.bucketCount = 0;
    this.bucketStart = 0;

    // Extend low-pass + rolling-std on the fly.
    this.extendLowPass();
    this.extendRollingStd();
  }

  // ----- Low-pass (causal moving average over `lowpassSeconds`) ------------

  private extendLowPass(): void {
    const win = this.opts.lowpassSeconds;
    const last = this.downs[this.downs.length - 1]!;
    const from = last.t - win * 1000;
    // Simple (but correct) re-computation: sum within window.
    let sum = 0;
    let count = 0;
    for (let i = this.downs.length - 1; i >= 0; i--) {
      const d = this.downs[i]!;
      if (d.t < from) break;
      sum += d.z;
      count += 1;
    }
    this.lp.push({ t: last.t, lp: count === 0 ? last.z : sum / count });
  }

  // ----- Rolling std over `stdWindowSeconds` on the low-passed signal ------

  private extendRollingStd(): void {
    const win = this.opts.stdWindowSeconds;
    const last = this.lp[this.lp.length - 1]!;
    const from = last.t - win * 1000;
    const values: number[] = [];
    for (let i = this.lp.length - 1; i >= 0; i--) {
      const p = this.lp[i]!;
      if (p.t < from) break;
      values.push(p.lp);
    }
    this.rstd.push({ t: last.t, s: std(values) });
  }

  // ----- Adaptive threshold + peak detection --------------------------------

  private adaptiveThreshold(atTs: number): number {
    const from = atTs - this.opts.adaptiveLookbackSeconds * 1000;
    const recent: number[] = [];
    for (let i = this.rstd.length - 1; i >= 0; i--) {
      const r = this.rstd[i]!;
      if (r.t < from) break;
      recent.push(r.s);
    }
    if (recent.length < 5) return this.opts.minProminence;
    const p5 = percentile(recent, 5);
    const p95 = percentile(recent, 95);
    const range = Math.max(0, p95 - p5);
    return Math.max(
      this.opts.minProminence,
      CTX_PROMINENCE_FRACTION * range,
    );
  }

  /**
   * Identify interior local maxima in rstd[] that we haven't yet emitted.
   * A sample at index i is a peak if rstd[i] > rstd[i-1] and rstd[i] > rstd[i+1].
   *
   * Prominence is the peak's height minus the higher of the two adjacent
   * trough minima within the past `stdWindowSeconds` window.
   */
  private scanForPeaks(): ContractionDetection[] {
    const emitted: ContractionDetection[] = [];
    // We can only evaluate peaks up to rstd.length - 2 (need a right neighbor).
    for (let i = Math.max(1, this.scanCursor); i < this.rstd.length - 1; i++) {
      const a = this.rstd[i - 1]!;
      const b = this.rstd[i]!;
      const c = this.rstd[i + 1]!;
      if (b.s <= a.s || b.s <= c.s) continue;

      // Trough search over the prior `stdWindowSeconds` around the peak.
      const lookback = this.opts.stdWindowSeconds * 1000;
      let troughMin = b.s;
      for (let j = i - 1; j >= 0; j--) {
        const p = this.rstd[j]!;
        if (p.t < b.t - lookback) break;
        if (p.s < troughMin) troughMin = p.s;
      }
      const prominence = b.s - troughMin;
      const threshold = this.adaptiveThreshold(b.t);
      if (prominence < threshold) continue;

      // Minimum inter-peak distance
      const lastAccepted = this.acceptedPeakTs[this.acceptedPeakTs.length - 1];
      if (
        lastAccepted !== undefined &&
        (b.t - lastAccepted) / 1000 < this.opts.minDistanceSeconds
      ) {
        continue;
      }

      // Base confidence
      let confidence = Math.max(0.3, Math.min(0.9, prominence / (2 * threshold)));

      // Timing bonus: within ±30% of the running mean interval.
      if (lastAccepted !== undefined && this.peakIntervals.length > 0) {
        const runningMean = mean(this.peakIntervals);
        const interval = (b.t - lastAccepted) / 1000;
        if (runningMean > 0 && Math.abs(interval - runningMean) / runningMean <= 0.3) {
          confidence = Math.min(1, confidence + 0.1);
        }
      }

      this.acceptedPeakTs.push(b.t);
      if (lastAccepted !== undefined) {
        this.peakIntervals.push((b.t - lastAccepted) / 1000);
      }

      emitted.push({
        peakTimestamp: b.t,
        method: 'accelerometer',
        confidence,
        prominenceRaw: prominence,
        fhrConfirmed: false,
      });
    }
    this.scanCursor = Math.max(1, this.rstd.length - 1);
    return emitted;
  }
}
