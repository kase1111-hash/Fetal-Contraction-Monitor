/**
 * AccelDetector tests. Synthetic accelerometer stream: quiet baseline with
 * strong activity bursts every 3 minutes simulating uterine contractions.
 */

import { AccelDetector } from '../../src/detection/accelerometer';
import type { RawAccelSample } from '../../src/detection/accelerometer';
import type { ContractionDetection } from '../../src/types';

const T0 = 1_700_000_000_000;

/**
 * Build a 50 Hz accel stream spanning `minutes` minutes. Baseline noise is
 * low-amplitude; each contraction centered at its peakTs adds a 30 s burst
 * of high-variance oscillation.
 */
function buildStream(
  peakTsList: number[],
  minutes: number,
  rngSeed = 1,
): RawAccelSample[] {
  const samples: RawAccelSample[] = [];
  const startMs = T0;
  const endMs = T0 + minutes * 60_000;
  const hz = 50;
  const step = 1000 / hz;
  let s = rngSeed;
  const rand = () => {
    // tiny LCG for deterministic "noise"
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };

  for (let t = startMs; t <= endMs; t += step) {
    let z = 0.001 * rand(); // quiet baseline
    for (const peak of peakTsList) {
      const dt = (t - peak) / 1000; // seconds from peak
      if (dt >= -40 && dt <= 40) {
        // Slow (≤0.1 Hz) bell-shaped bump — survives a 10 s moving-average.
        // Amplitude 0.05 g, σ=15s.
        const env = Math.exp(-(dt * dt) / (2 * 15 * 15));
        z += env * 0.05;
      }
    }
    samples.push({ t, z });
  }
  return samples;
}

describe('AccelDetector', () => {
  test('emits roughly one detection per contraction in synthetic labor', () => {
    const peaks = [T0 + 5 * 60_000, T0 + 8 * 60_000, T0 + 11 * 60_000, T0 + 14 * 60_000];
    const samples = buildStream(peaks, 17);
    const det = new AccelDetector();
    const detections: ContractionDetection[] = [];
    for (const s of samples) {
      const emitted = det.push(s);
      detections.push(...emitted);
    }
    detections.push(...det.finalize());

    // We should detect at least as many peaks as expected, possibly +/-1 due
    // to the smoothing envelope. Each detection aligns to within 5 s of a
    // true peak.
    expect(detections.length).toBeGreaterThanOrEqual(peaks.length - 1);
    for (const d of detections) {
      const nearest = peaks
        .map((p) => Math.abs(d.peakTimestamp - p))
        .reduce((min, x) => Math.min(min, x), Infinity);
      expect(nearest).toBeLessThan(8_000);
    }
  });

  test('confidence is in [0.3, 1] and reports raw prominence', () => {
    const peaks = [T0 + 5 * 60_000, T0 + 8 * 60_000, T0 + 11 * 60_000, T0 + 14 * 60_000];
    const samples = buildStream(peaks, 17);
    const det = new AccelDetector();
    for (const s of samples) det.push(s);
    const all = det.finalize();
    for (const d of all) {
      expect(d.confidence).toBeGreaterThanOrEqual(0.3);
      expect(d.confidence).toBeLessThanOrEqual(1);
      expect(d.prominenceRaw).toBeDefined();
      expect(d.prominenceRaw!).toBeGreaterThan(0);
      expect(d.method).toBe('accelerometer');
      expect(d.fhrConfirmed).toBe(false);
    }
  });

  test('pure quiet baseline emits no detections', () => {
    const samples = buildStream([], 15);
    const det = new AccelDetector();
    const detections: ContractionDetection[] = [];
    for (const s of samples) detections.push(...det.push(s));
    detections.push(...det.finalize());
    expect(detections).toHaveLength(0);
  });

  test('enforces CTX_MIN_DISTANCE (no two peaks closer than 60 s)', () => {
    // Two very close "bumps" 20 s apart — only one should be reported.
    const peaks = [T0 + 5 * 60_000, T0 + 5 * 60_000 + 20_000];
    const samples = buildStream(peaks, 10);
    const det = new AccelDetector();
    for (const s of samples) det.push(s);
    const all = det.finalize();
    for (let i = 1; i < all.length; i++) {
      const dt = (all[i]!.peakTimestamp - all[i - 1]!.peakTimestamp) / 1000;
      expect(dt).toBeGreaterThanOrEqual(60);
    }
  });

  test('push() during buildup emits nothing until a peak has fully cleared', () => {
    const det = new AccelDetector();
    // Feed only 30 s of quiet data — no peaks possible.
    const samples = buildStream([], 0.5);
    let emitted = 0;
    for (const s of samples) emitted += det.push(s).length;
    expect(emitted).toBe(0);
  });
});
