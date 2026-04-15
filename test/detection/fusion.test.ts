import {
  fuse,
  applyFhrConfirmation,
  MERGE_WINDOW_S,
} from '../../src/detection/fusion';
import type { ContractionDetection, ContractionResponse } from '../../src/types';

const T0 = 1_700_000_000_000;

function accel(ts: number, conf = 0.6): ContractionDetection {
  return {
    peakTimestamp: ts,
    method: 'accelerometer',
    confidence: conf,
    prominenceRaw: 0.02,
    fhrConfirmed: false,
  };
}
function manual(ts: number): ContractionDetection {
  return { peakTimestamp: ts, method: 'manual', confidence: 1 };
}
function toco(ts: number, conf = 0.95): ContractionDetection {
  return { peakTimestamp: ts, method: 'toco', confidence: conf };
}

function resp(overrides: Partial<ContractionResponse> = {}): ContractionResponse {
  return {
    id: 'c',
    timestamp: T0,
    contractionPeakTime: T0,
    detectionMethod: 'accelerometer',
    detectionConfidence: 0.6,
    baselineFHR: 140,
    nadirDepth: -15,
    nadirTiming: 10,
    recoveryTime: 30,
    responseArea: -300,
    fhrQuality: 0.95,
    qualityGrade: 'good',
    ...overrides,
  };
}

describe('fuse', () => {
  test('manual + nearby accel merge to single detection at manual timestamp, conf=1', () => {
    const m = manual(T0);
    const a = accel(T0 + 10_000, 0.5);
    const fused = fuse({ manual: [m], accelerometer: [a], toco: [] });
    expect(fused).toHaveLength(1);
    expect(fused[0]!.peakTimestamp).toBe(T0);
    expect(fused[0]!.method).toBe('manual');
    expect(fused[0]!.confidence).toBe(1);
    expect(fused[0]!.prominenceRaw).toBe(0.02); // picked up from accel
  });

  test('manual and accel outside MERGE_WINDOW_S remain separate', () => {
    const m = manual(T0);
    const a = accel(T0 + (MERGE_WINDOW_S + 5) * 1000, 0.5);
    const fused = fuse({ manual: [m], accelerometer: [a], toco: [] });
    expect(fused).toHaveLength(2);
  });

  test('accel-only survives unchanged', () => {
    const a = accel(T0, 0.55);
    const fused = fuse({ manual: [], accelerometer: [a], toco: [] });
    expect(fused).toHaveLength(1);
    expect(fused[0]!.method).toBe('accelerometer');
    expect(fused[0]!.confidence).toBe(0.55);
  });

  test('TOCO absorbs nearby accel/manual', () => {
    const t = toco(T0);
    const m = manual(T0 + 5000);
    const a = accel(T0 + 10_000);
    const fused = fuse({ manual: [m], accelerometer: [a], toco: [t] });
    expect(fused).toHaveLength(1);
    expect(fused[0]!.method).toBe('toco');
  });

  test('output is sorted by peakTimestamp', () => {
    const a1 = accel(T0 + 200_000);
    const a2 = accel(T0 + 60_000);
    const m = manual(T0 + 400_000);
    const fused = fuse({ manual: [m], accelerometer: [a1, a2], toco: [] });
    expect(fused.map((d) => d.peakTimestamp)).toEqual([
      T0 + 60_000,
      T0 + 200_000,
      T0 + 400_000,
    ]);
  });

  test('manual alone → confidence 1 preserved', () => {
    const fused = fuse({ manual: [manual(T0)], accelerometer: [], toco: [] });
    expect(fused[0]!.confidence).toBe(1);
  });
});

describe('applyFhrConfirmation', () => {
  test('manual detections are not modified', () => {
    const m = manual(T0);
    const r = resp();
    expect(applyFhrConfirmation(m, r)).toEqual(m);
  });

  test('accel + qualifying deceleration → fhrConfirmed true, +0.2 confidence', () => {
    const a = accel(T0, 0.6);
    const r = resp({ nadirDepth: -15, responseArea: -300 }); // qualifies
    const out = applyFhrConfirmation(a, r);
    expect(out.fhrConfirmed).toBe(true);
    expect(out.confidence).toBeCloseTo(0.8, 10);
  });

  test('accel + non-qualifying response → fhrConfirmed false, halved', () => {
    const a = accel(T0, 0.6);
    const r = resp({ nadirDepth: -5, responseArea: -50 }); // does not qualify
    const out = applyFhrConfirmation(a, r);
    expect(out.fhrConfirmed).toBe(false);
    expect(out.confidence).toBeCloseTo(0.3, 10);
  });

  test('accel + null response (no window) → halved, fhrConfirmed false', () => {
    const a = accel(T0, 0.6);
    const out = applyFhrConfirmation(a, null);
    expect(out.fhrConfirmed).toBe(false);
    expect(out.confidence).toBeCloseTo(0.3, 10);
  });

  test('confidence is clipped at 1.0 after bonus', () => {
    const a = accel(T0, 0.9);
    const r = resp({ nadirDepth: -15, responseArea: -300 });
    expect(applyFhrConfirmation(a, r).confidence).toBe(1);
  });
});
