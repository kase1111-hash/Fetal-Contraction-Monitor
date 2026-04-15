/**
 * Response extraction tests. Covers SPEC.md §10:
 *   - "Recovery extraction: if FHR stays 20 bpm below baseline for entire window, recovery = 60s"
 *   - "Recovery extraction: if FHR returns immediately, recovery ≈ nadirTiming"
 */

import { extractResponse } from '../../src/extraction/extract-response';
import type {
  ContractionDetection,
  FHRSample,
} from '../../src/types';

const PEAK = 1_700_000_000_000;

function detection(overrides: Partial<ContractionDetection> = {}): ContractionDetection {
  return {
    peakTimestamp: PEAK,
    method: 'manual',
    confidence: 1.0,
    ...overrides,
  };
}

/**
 * Build an FHR stream at 2 Hz spanning [peak − 30 s, peak + 60 s].
 * `fhrAt(tSec)` returns the FHR at time `peak + tSec`.
 */
function buildStream(fhrAt: (tSec: number) => number, hz = 2): FHRSample[] {
  const out: FHRSample[] = [];
  const step = 1000 / hz;
  for (let t = -30_000; t <= 60_000; t += step) {
    const fhr = fhrAt(t / 1000);
    out.push({
      timestamp: PEAK + t,
      fhr,
      source: 'hr',
      valid: fhr >= 80 && fhr <= 200,
    });
  }
  return out;
}

describe('extractResponse — feature extraction', () => {
  test('flat baseline, no response → nadir 0, recovery 0', () => {
    const samples = buildStream(() => 140);
    const r = extractResponse({ detection: detection(), samples, id: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.baselineFHR).toBeCloseTo(140, 6);
    expect(r.response.nadirDepth).toBe(0);
    expect(r.response.nadirTiming).toBe(0);
    // A 5s window starting at t=0 stays within ±5 of baseline → recovery = 0
    expect(r.response.recoveryTime).toBeCloseTo(0, 6);
    expect(r.response.responseArea).toBeCloseTo(0, 6);
  });

  test('sustained 20 bpm drop for full window → recovery = RESPONSE_WINDOW (60s)', () => {
    const samples = buildStream((t) => (t < 0 ? 140 : 120));
    const r = extractResponse({ detection: detection(), samples, id: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.baselineFHR).toBe(140);
    expect(r.response.nadirDepth).toBe(-20);
    // Default recovery when FHR never returns within ±5 of baseline.
    expect(r.response.recoveryTime).toBe(60);
    // Response area ≈ -20 bpm × 60 s
    expect(r.response.responseArea).toBeCloseTo(-20 * 60, 0);
  });

  test('immediate drop + immediate return → recovery ≈ nadirTiming', () => {
    // Spike down at t=2s only, then back to baseline for the rest of the window.
    const samples = buildStream((t) => {
      if (t >= 1.5 && t <= 2.5) return 120; // brief dip
      return 140;
    });
    const r = extractResponse({ detection: detection(), samples, id: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.nadirDepth).toBeLessThan(0);
    // Recovery should be close to nadirTiming (≈ 2s) + the required 5s stability
    // — the implementation reports the start time of the first sustained window,
    // which begins once FHR comes back. Expect it within a few seconds of nadirTiming.
    expect(r.response.recoveryTime).toBeGreaterThanOrEqual(r.response.nadirTiming);
    expect(r.response.recoveryTime).toBeLessThan(r.response.nadirTiming + 3);
  });

  test('nadir at 25 bpm drop is reported faithfully', () => {
    const samples = buildStream((t) => {
      if (t >= 5 && t <= 10) return 115; // 25 bpm drop centered at t=7.5
      return 140;
    });
    const r = extractResponse({ detection: detection(), samples, id: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.nadirDepth).toBeCloseTo(-25, 6);
    expect(r.response.nadirTiming).toBeGreaterThanOrEqual(5);
    expect(r.response.nadirTiming).toBeLessThanOrEqual(10);
  });

  test('rejects when baseline window has too many invalid samples', () => {
    const samples = buildStream((t) => (t < 0 ? 999 : 140)); // all baseline invalid
    const r = extractResponse({ detection: detection(), samples, id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('baseline-insufficient-samples');
  });

  test('rejects when baseline is outside [100, 180]', () => {
    const samples = buildStream(() => 95);
    // Samples at 95 are still valid (>=80, <=200), but baseline < 100.
    // Need to make them valid so we hit the range-check, not the insufficiency check.
    const r = extractResponse({ detection: detection(), samples, id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('baseline-out-of-range');
  });

  test('quality grade: good requires conf ≥ 0.7, fhrQuality ≥ 0.8, baseline in range', () => {
    const samples = buildStream(() => 140);
    const r = extractResponse({
      detection: detection({ confidence: 0.9 }),
      samples,
      id: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.qualityGrade).toBe('good');
    expect(r.response.fhrQuality).toBe(1);
  });

  test('quality grade: fair when confidence mid (0.5)', () => {
    const samples = buildStream(() => 140);
    const r = extractResponse({
      detection: detection({ confidence: 0.5 }),
      samples,
      id: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.qualityGrade).toBe('fair');
  });

  test('quality grade: poor when confidence low', () => {
    const samples = buildStream(() => 140);
    const r = extractResponse({
      detection: detection({ confidence: 0.2 }),
      samples,
      id: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.qualityGrade).toBe('poor');
  });
});
