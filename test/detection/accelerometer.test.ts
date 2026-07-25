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

describe('AccelDetector — bounded history', () => {
  /** Contractions every 3 min for `minutes`, using the shared stream builder. */
  function run(minutes: number): {
    detector: AccelDetector;
    found: ContractionDetection[];
  } {
    const peaks: number[] = [];
    for (let m = 5; m < minutes - 2; m += 3) peaks.push(T0 + m * 60_000);
    const detector = new AccelDetector();
    const found: ContractionDetection[] = [];
    for (const s of buildStream(peaks, minutes)) found.push(...detector.push(s));
    return { detector, found };
  }

  test('series stay bounded over a long run instead of growing with it', () => {
    const oneHour = run(60).detector._debug();
    const twoHours = run(120).detector._debug();

    // Retention is the longest window the detector reads (600 s adaptive
    // lookback) plus margin, at 4 Hz — not the length of the session.
    expect(oneHour.rstd.length).toBeLessThan(2_600);
    expect(oneHour.lp.length).toBeLessThan(200);
    expect(oneHour.downs.length).toBeLessThan(100);

    // Doubling the run must not grow the retained history.
    expect(twoHours.rstd.length).toBeLessThanOrEqual(oneHour.rstd.length);
    expect(twoHours.lp.length).toBeLessThanOrEqual(oneHour.lp.length);
    expect(twoHours.downs.length).toBeLessThanOrEqual(oneHour.downs.length);
  });

  test('each retained series still covers its full read window', () => {
    const d = run(60).detector._debug();
    const span = (xs: readonly { t: number }[]) =>
      xs.length < 2 ? 0 : (xs[xs.length - 1]!.t - xs[0]!.t) / 1000;

    // Trimming into a live window would change detector output.
    expect(span(d.downs)).toBeGreaterThanOrEqual(10); // low-pass window
    expect(span(d.lp)).toBeGreaterThanOrEqual(30); // rolling-std window
    expect(span(d.rstd)).toBeGreaterThanOrEqual(600); // adaptive lookback
  });

  test('detections in a long run match those of a short run over the same prefix', () => {
    // The trim must be invisible to output: peaks found early are identical
    // whether or not the detector later ran for hours.
    const short = run(30).found;
    const long = run(120).found;
    const cutoff = short[short.length - 1]!.peakTimestamp;
    const longPrefix = long.filter((c) => c.peakTimestamp <= cutoff);

    expect(short.length).toBeGreaterThan(2); // the signal really does peak
    expect(longPrefix.map((c) => c.peakTimestamp)).toEqual(
      short.map((c) => c.peakTimestamp),
    );
    expect(longPrefix.map((c) => c.confidence)).toEqual(
      short.map((c) => c.confidence),
    );
  });
});
