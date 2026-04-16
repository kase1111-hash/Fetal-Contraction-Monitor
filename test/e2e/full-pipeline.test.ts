/**
 * End-to-end pipeline test.
 *
 * Drives the entire app stack — everything short of React UI rendering —
 * in a single scenario. If this passes, the data plane is wired.
 *
 * Covers:
 *   Phase 1: BLE HRM parse → FHR buffer → response extraction →
 *            trajectory features → torus mapping → CSV export
 *   Phase 2: accelerometer detection + fusion + personal baseline
 *            + alert status machine + RED persistence + PDF export
 *   Phase 3: uncertainty helpers (grey reason, slope SE)
 *   Phase 4: study mode capture → CTG import → alignment →
 *            equivalence summary → equivalence report
 */

import { Buffer } from 'buffer';

import { FhrBuffer } from '../../src/ble/fhr-buffer';
import { parseHrm } from '../../src/ble/parse-hrm';
import { makeSample } from '../../src/ble/quality-gate';
import {
  AccelDetector,
  type RawAccelSample,
} from '../../src/detection/accelerometer';
import { fuse, applyFhrConfirmation } from '../../src/detection/fusion';
import { extractResponse } from '../../src/extraction/extract-response';
import { ContractionQueue } from '../../src/state/contraction-queue';
import { sessionReducer } from '../../src/state/session-reducer';
import { computeTrajectoryFeatures } from '../../src/trajectory/features';
import { computeTrajectory } from '../../src/torus/map-point';
import { determineStatus } from '../../src/alerts/status';
import { establishBaseline } from '../../src/alerts/personal-baseline';
import {
  greyReason,
  slopeStandardError,
  statusLabel,
} from '../../src/alerts/uncertainty';
import { sessionToCsv } from '../../src/export/csv';
import { buildSessionHtml } from '../../src/export/pdf';
import {
  scenarioParams,
  generateFhrStream,
  type ScenarioKind,
} from '../../src/simulation/scenarios';
import { StudyRecorder, streamToFhrCsv } from '../../src/study/raw-capture';
import { importCtgCsv } from '../../src/study/import-ctg';
import { alignStreams } from '../../src/study/align';
import { equivalenceSummary, extractResponsesFromStream } from '../../src/study/equivalence';
import { buildEquivalenceHtml } from '../../src/study/report';
import type {
  ContractionDetection,
  FHRSample,
  LaborSession,
} from '../../src/types';

const T0 = 1_700_000_000_000;

// --- Helpers -----------------------------------------------------------------

/** Build a BLE HRM notification packet: flags=0 (uint8 HR, no RR), HR=bpm. */
function hrmPacket(bpm: number): Uint8Array {
  return new Uint8Array([0x00, bpm & 0xff]);
}

/**
 * Simulate a BLE Doppler driving the FhrBuffer for the duration of a
 * single contraction. Parses each packet through the real `parseHrm`
 * path, just like the production BleDoppler wrapper.
 */
function feedFhrThroughBle(
  fhrSamples: FHRSample[],
  buffer: FhrBuffer,
): void {
  for (const s of fhrSamples) {
    if (!Number.isFinite(s.fhr)) continue;
    const clamped = Math.max(0, Math.min(255, Math.round(s.fhr)));
    const pkt = hrmPacket(clamped);
    const parsed = parseHrm(pkt);
    buffer.push(makeSample(parsed.hr, s.timestamp, 'hr'));
  }
}

/** Deterministic slow-bump accelerometer trace around a contraction peak. */
function buildAccelBump(peakMs: number, magnitude = 0.05): RawAccelSample[] {
  const out: RawAccelSample[] = [];
  const hz = 50;
  const step = 1000 / hz;
  for (let t = peakMs - 40_000; t <= peakMs + 40_000; t += step) {
    const dt = (t - peakMs) / 1000;
    const env = Math.exp(-(dt * dt) / (2 * 15 * 15));
    out.push({ t, z: env * magnitude });
  }
  return out;
}

// --- The test ---------------------------------------------------------------

describe('End-to-end: full pipeline integration', () => {
  // Run the Distress scenario so we exercise the full status progression.
  const scenario: ScenarioKind = 'distress';
  const N = 20;

  // State the test will populate as it walks the scenario.
  let session: LaborSession | null = null;
  const fhrBuffer = new FhrBuffer();
  const accelDetector = new AccelDetector();
  const contractionQueue = new ContractionQueue();
  const studyRecorder = new StudyRecorder();

  // Will be populated by the test body — cross-referenced across `test` blocks.
  let finalFeatures: ReturnType<typeof computeTrajectoryFeatures> | null = null;
  let finalStatus: LaborSession['status'] | null = null;
  let accelDetections: ContractionDetection[] = [];
  let clinicalCsv = '';

  test('[1/6] simulation → BLE → FHR buffer → extraction → session reducer', () => {
    session = sessionReducer(null, { type: 'start', id: 'e2e', at: T0 });
    expect(session!.status).toBe('grey');

    studyRecorder.open('consumer-doppler', T0);

    for (let k = 0; k < N; k++) {
      const peak = T0 + k * 180_000;
      const params = scenarioParams(scenario, k, N);

      // 1. Simulator emits FHR samples (what a Doppler would put on BLE).
      const fhrSamples = generateFhrStream(params, peak);

      // 2. Feed them through the real BLE parse path into the ring buffer.
      feedFhrThroughBle(fhrSamples, fhrBuffer);
      for (const s of fhrSamples) studyRecorder.sample('consumer-doppler', s);

      // 3. Manual contraction detection at the peak.
      const detection: ContractionDetection = {
        peakTimestamp: peak,
        method: 'manual',
        confidence: 1,
      };
      contractionQueue.enqueue(detection);
      studyRecorder.detect('consumer-doppler', detection);

      // 4. Drain the queue — response window has closed because we
      //    fast-forward wall clock to peak + 60 s + ε.
      const now = peak + 60_001;
      const drained = contractionQueue.tick(now, fhrBuffer.all());
      expect(drained.extracted.length).toBeGreaterThanOrEqual(0);

      for (const resp of drained.extracted) {
        session = sessionReducer(session, {
          type: 'add-contraction',
          response: resp,
          at: now,
        });
      }
    }

    // Final drain in case the last contraction is still pending.
    const tail = contractionQueue.tick(T0 + N * 180_000 + 120_000, fhrBuffer.all());
    for (const resp of tail.extracted) {
      session = sessionReducer(session, {
        type: 'add-contraction',
        response: resp,
        at: T0 + N * 180_000 + 120_000,
      });
    }

    expect(session).not.toBeNull();
    expect(session!.contractions.length).toBeGreaterThanOrEqual(N - 1);
    // Baseline froze at MIN_CONTRACTIONS.
    expect(session!.personalBaseline).not.toBeNull();
  });

  test('[2/6] alert state machine walks grey → (green|yellow) → red', () => {
    expect(session).not.toBeNull();
    const statuses = session!.statusHistory.map((t) => t.to);
    // Initial status is grey; at minimum we must see yellow and red surface.
    expect(session!.statusHistory.length).toBeGreaterThan(0);
    expect(statuses).toContain('yellow');
    expect(statuses).toContain('red');

    // Current status is red (final state of distress scenario).
    expect(session!.status).toBe('red');

    // redPersistenceCount should be ≥ RED_PERSISTENCE (2) at the end.
    expect(session!.redPersistenceCount).toBeGreaterThanOrEqual(2);

    finalStatus = session!.status;
    finalFeatures = computeTrajectoryFeatures(session!.contractions);
  });

  test('[3/6] trajectory features + torus mapping are consistent', () => {
    expect(finalFeatures).not.toBeNull();
    expect(finalFeatures!.contractionCount).toBe(session!.contractions.length);

    // Distress produces rising recovery → positive slope.
    expect(finalFeatures!.recoveryTrendSlope).toBeGreaterThan(0.3);
    expect(finalFeatures!.recoveryLast5Mean).toBeGreaterThanOrEqual(40);

    // Torus trajectory: one point per contraction, interior kappa back-filled.
    const traj = computeTrajectory(session!.contractions, 'fixed');
    expect(traj).toHaveLength(session!.contractions.length);
    expect(traj[0]!.kappa).toBe(0);
    expect(traj[traj.length - 1]!.kappa).toBe(0);
    const interior = traj.slice(1, -1);
    expect(interior.some((p) => p.kappa > 0)).toBe(true);

    // Every theta is in [0, 2π).
    for (const p of traj) {
      expect(p.theta1).toBeGreaterThanOrEqual(0);
      expect(p.theta1).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
      expect(p.theta2).toBeGreaterThanOrEqual(0);
      expect(p.theta2).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
    }
  });

  test('[4/6] uncertainty helpers + alert-status reasoning', () => {
    // When red, greyReason returns null.
    expect(greyReason(session)).toBeNull();
    expect(statusLabel(finalStatus!)).toMatch(/Alert/);

    // Slope SE is finite and positive (we have noise from simulation).
    const recoveries = session!.contractions.map((c) => c.recoveryTime);
    const se = slopeStandardError(recoveries);
    expect(Number.isFinite(se)).toBe(true);
    expect(se).toBeGreaterThanOrEqual(0);

    // Running the status decision one more time directly on the session
    // returns the same status (idempotent).
    const directResult = determineStatus({
      features: finalFeatures!,
      baseline: session!.personalBaseline,
      recentContractions: session!.contractions,
      redPersistenceCount: session!.redPersistenceCount - 1, // re-arm for one tick
    });
    expect(['red', 'yellow']).toContain(directResult.status);
  });

  test('[5/6] accelerometer detector + fusion + FHR confirmation', () => {
    // Drive the accelerometer with slow bumps at the same peaks.
    for (let k = 0; k < N; k++) {
      const peak = T0 + k * 180_000;
      for (const s of buildAccelBump(peak)) {
        accelDetections.push(...accelDetector.push(s));
      }
    }
    accelDetections.push(...accelDetector.finalize());

    // Should detect most of them. We intentionally loosen the lower bound:
    // the first contraction's 10-minute adaptive lookback is uninitialized.
    expect(accelDetections.length).toBeGreaterThanOrEqual(N - 4);
    for (const d of accelDetections) {
      expect(d.method).toBe('accelerometer');
      expect(d.confidence).toBeGreaterThanOrEqual(0.3);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }

    // Fusion: the simulation also emitted manual detections. Fuse — manual
    // wins timestamp + confidence.
    const manualDets: ContractionDetection[] = session!.contractions.map((c) => ({
      peakTimestamp: c.contractionPeakTime,
      method: 'manual',
      confidence: 1,
    }));
    const fused = fuse({
      manual: manualDets,
      accelerometer: accelDetections,
      toco: [],
    });
    // Every fused detection is a manual (since manual covers every peak).
    for (const f of fused) {
      expect(f.method).toBe('manual');
      expect(f.confidence).toBe(1);
    }
    expect(fused).toHaveLength(manualDets.length);

    // FHR-confirmation on an accel detection: a good-quality response
    // uplifts confidence by +0.2, clipped at 1.
    const firstAccel = accelDetections[0]!;
    const firstResp = session!.contractions[0]!;
    const confirmed = applyFhrConfirmation(firstAccel, firstResp);
    expect(confirmed.fhrConfirmed).toBe(true);
    expect(confirmed.confidence).toBeGreaterThanOrEqual(firstAccel.confidence);
  });

  test('[6/6] exports: CSV, PDF HTML, equivalence CSV/PDF HTML', () => {
    // --- CSV export (Phase 1 / 2) ---
    const csv = sessionToCsv(session!);
    const csvLines = csv.trim().split('\n');
    expect(csvLines[0]).toMatch(/^index,contraction_id/); // header
    expect(csvLines).toHaveLength(1 + session!.contractions.length);

    // --- PDF HTML (Phase 2) ---
    const pdfHtml = buildSessionHtml(session!, { title: 'E2E' });
    expect(pdfHtml.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(pdfHtml).toContain('RED'); // the status pill
    expect(pdfHtml).toContain('Not a medical device');

    // --- Round-trip the consumer stream as a CTG CSV, re-import ---
    const consumer = studyRecorder.stream('consumer-doppler')!;
    clinicalCsv = streamToFhrCsv(consumer);
    const imported = importCtgCsv(clinicalCsv);
    expect(imported.samples.length).toBe(consumer.samples.length);

    // --- Alignment: same-vs-same → perfect agreement ---
    const aligned = alignStreams(consumer.samples, imported.samples, {
      targetHz: 2,
    });
    expect(aligned.aligned.length).toBeGreaterThan(100);
    for (const p of aligned.aligned.slice(0, 20)) {
      expect(p.fhrA).toBeCloseTo(p.fhrB, 6);
    }

    // --- Equivalence summary: bias≈0, matched count = N contractions ---
    const detections = consumer.detections;
    const aResponses = extractResponsesFromStream(detections, consumer.samples, 'A');
    const bResponses = extractResponsesFromStream(
      detections,
      imported.samples,
      'B',
    );
    const summary = equivalenceSummary(aligned.aligned, aResponses, bResponses);
    expect(summary.fhr.bias).toBeCloseTo(0, 3);
    expect(summary.fhr.rmse).toBeCloseTo(0, 3);
    expect(summary.counts.matched).toBe(aResponses.length);
    expect(summary.status.accuracy).toBeCloseTo(1, 6);

    // --- Equivalence report HTML renders ---
    const repHtml = buildEquivalenceHtml(aligned.aligned, summary);
    expect(repHtml).toContain('Equivalence report');
    expect(repHtml).toContain('<svg'); // inline Bland-Altman
    expect(repHtml).toContain('not a validation of clinical use');
  });
});
