/**
 * Simulation Mode scenarios.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §8 (lines 426–437).
 *
 *   Normal       Stable 28–35s recovery     Gradual deepening  −10 → −30 bpm
 *   Concerning   Rising 30s → 45s           Similar to normal
 *   Distress     Rising 35s → 55s, accel    Deepening faster   −10 → −40 bpm
 *
 * Each scenario generates a (contraction, FHR stream) pair for a given
 * contraction index. The FHR stream spans [peak − 30 s, peak + 60 s] at 2 Hz
 * and encodes the target nadir + recovery so that `extractResponse` recovers
 * features close to the scenario's parameters.
 */

import { makeSample } from '../ble/quality-gate';
import { extractResponse } from '../extraction/extract-response';
import { BASELINE_WINDOW, RESPONSE_WINDOW } from '../constants';
import type { ContractionResponse, FHRSample } from '../types';

export type ScenarioKind = 'normal' | 'concerning' | 'distress';

export interface ScenarioParams {
  /** bpm below baseline at nadir (a positive number; applied as a drop). */
  nadirDrop: number;
  /** seconds until recovery within ±5 bpm of baseline. */
  recoveryTime: number;
  /** baseline FHR (bpm). */
  baseline: number;
}

/** Clamp helper. */
const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Pattern for the k-th contraction in a scenario of length `total`.
 *
 * Progression is deliberately simple and monotone so the downstream
 * integration test is robust.
 */
export function scenarioParams(
  kind: ScenarioKind,
  k: number,
  total: number,
): ScenarioParams {
  const frac = total <= 1 ? 0 : clip(k / (total - 1), 0, 1);
  switch (kind) {
    case 'normal':
      return {
        baseline: 140,
        nadirDrop: 10 + 20 * frac, // -10 → -30 (gradual deepening per SPEC)
        // "Stable 28–35s recovery" → oscillate in band, no trend.
        recoveryTime: 31 + 3 * Math.sin(k * 1.3),
      };
    case 'concerning':
      return {
        baseline: 140,
        nadirDrop: 10 + 20 * frac,
        recoveryTime: 30 + 15 * frac, // 30 → 45
      };
    case 'distress':
      // Accelerating rise in recovery: use a quadratic component.
      return {
        baseline: 140,
        nadirDrop: 10 + 30 * Math.pow(frac, 1.2),
        recoveryTime: 35 + 20 * Math.pow(frac, 1.6),
      };
  }
}

/**
 * Generate an FHR stream spanning [peak − 30s, peak + 60s] at `hz` that
 * encodes the given scenario parameters around the contraction peak.
 *
 * Shape: trapezoidal dip
 *   - Flat baseline before contraction
 *   - 3 s linear ramp-in (0 → −nadirDrop)
 *   - Plateau at −nadirDrop
 *   - 3 s linear ramp-out (−nadirDrop → 0) ending exactly at `recoveryTime`
 *   - Flat baseline after
 *
 * This shape ensures the extractor's measured recovery time tracks the
 * scenario parameter to within a fraction of a second.
 */
export function generateFhrStream(
  params: ScenarioParams,
  peakMs: number,
  hz = 2,
): FHRSample[] {
  const out: FHRSample[] = [];
  const step = 1000 / hz;
  const RAMP = 3; // seconds on each side

  for (let t = -30_000; t <= 60_000; t += step) {
    const tSec = t / 1000;
    let dev = 0;
    if (tSec >= 0 && tSec < params.recoveryTime) {
      const rampOutStart = Math.max(RAMP, params.recoveryTime - RAMP);
      if (tSec < RAMP) {
        dev = -params.nadirDrop * (tSec / RAMP);
      } else if (tSec < rampOutStart) {
        dev = -params.nadirDrop;
      } else {
        const u = (params.recoveryTime - tSec) / RAMP;
        dev = -params.nadirDrop * clip(u, 0, 1);
      }
    }
    const fhr = params.baseline + dev;
    out.push(makeSample(fhr, peakMs + t, 'hr'));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Whole-session simulation
// ---------------------------------------------------------------------------

/**
 * Spacing between simulated contractions (3 min — typical active labor).
 *
 * Must exceed BASELINE_WINDOW + RESPONSE_WINDOW, or consecutive streams would
 * overlap and each extraction would read samples belonging to its neighbours.
 */
export const SIMULATION_SPACING_MS = 180_000;

export interface SimulateOptions {
  /** Number of contractions. Default 15. */
  count?: number;
  /** Peak time of the FIRST contraction. Default: back-dated so the last lands now. */
  startMs?: number;
  /** Gap between peaks. Default SIMULATION_SPACING_MS. */
  spacingMs?: number;
}

/**
 * Build a full set of extracted responses for a scenario.
 *
 * Each contraction is extracted from its OWN generated stream rather than from
 * a shared rolling buffer. That matters: a generated stream spans
 * [peak − BASELINE_WINDOW, peak + RESPONSE_WINDOW] — 90 s — so pouring several
 * of them into one buffer at demo-compressed spacing makes every extraction
 * read a blend of overlapping streams. Doing that produced a "normal" labor
 * showing −30 bpm nadirs and 60 s recoveries (the extractor's "never
 * recovered" fallback) on every contraction, for all three scenarios.
 *
 * This runs the real `extractResponse` — the same code the live queue uses —
 * so the features are genuinely measured off the synthetic trace. Only the
 * ring buffer and the queue's wall-clock delay are bypassed, and they have to
 * be: the buffer holds 120 s, while a realistic 15-contraction session spans
 * about 45 minutes.
 */
export function simulateResponses(
  kind: ScenarioKind,
  opts: SimulateOptions = {},
): ContractionResponse[] {
  const count = opts.count ?? 15;
  const spacingMs = opts.spacingMs ?? SIMULATION_SPACING_MS;
  const minSpacing = (BASELINE_WINDOW + RESPONSE_WINDOW) * 1000;
  if (spacingMs < minSpacing) {
    throw new Error(
      `simulateResponses: spacingMs must be at least ${minSpacing} ms so ` +
        `contraction windows do not overlap (got ${spacingMs})`,
    );
  }
  // Default: back-date the run so the newest contraction sits at "now" and the
  // session reads like one that has been going for a while.
  const startMs = opts.startMs ?? Date.now() - (count - 1) * spacingMs;

  const out: ContractionResponse[] = [];
  for (let k = 0; k < count; k++) {
    const peak = startMs + k * spacingMs;
    const samples = generateFhrStream(scenarioParams(kind, k, count), peak);
    const r = extractResponse({
      detection: { peakTimestamp: peak, method: 'manual', confidence: 1 },
      samples,
      id: `sim-${kind}-${k}`,
      now: () => peak,
    });
    if (r.ok) out.push(r.response);
  }
  return out;
}
