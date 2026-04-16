import { alignStreams } from '../../src/study/align';
import { makeSample } from '../../src/ble/quality-gate';
import type { FHRSample } from '../../src/types';

const T0 = 1_700_000_000_000;

function stream(
  startMs: number,
  endMs: number,
  hz: number,
  valueAt: (tSec: number) => number,
): FHRSample[] {
  const step = 1000 / hz;
  const out: FHRSample[] = [];
  for (let t = startMs; t <= endMs; t += step) {
    out.push(makeSample(valueAt(t / 1000), t, 'hr'));
  }
  return out;
}

describe('alignStreams', () => {
  test('empty streams → empty result', () => {
    const r = alignStreams([], []);
    expect(r.aligned).toEqual([]);
    expect(r.gridTicks).toBe(0);
  });

  test('identical streams produce perfect alignment', () => {
    const a = stream(T0, T0 + 60_000, 4, () => 140);
    const b = stream(T0, T0 + 60_000, 4, () => 140);
    const r = alignStreams(a, b, { targetHz: 2 });
    expect(r.aligned.length).toBeGreaterThan(100);
    expect(r.dropped).toBe(0);
    for (const p of r.aligned) {
      expect(p.fhrA).toBeCloseTo(p.fhrB, 6);
    }
  });

  test('disjoint timeranges → empty alignment', () => {
    const a = stream(T0, T0 + 30_000, 2, () => 140);
    const b = stream(T0 + 60_000, T0 + 120_000, 2, () => 140);
    const r = alignStreams(a, b);
    expect(r.aligned).toEqual([]);
  });

  test('clinical 4 Hz vs consumer 2 Hz — downsamples both to target', () => {
    const a = stream(T0, T0 + 60_000, 4, () => 140); // clinical
    const b = stream(T0, T0 + 60_000, 2, () => 141); // consumer
    const r = alignStreams(a, b, { targetHz: 2 });
    // Grid: 60 s * 2 Hz = 121 ticks (inclusive).
    expect(r.gridTicks).toBe(121);
    expect(r.aligned).toHaveLength(121);
    expect(r.aligned[0]!.fhrA).toBeCloseTo(140, 3);
    expect(r.aligned[0]!.fhrB).toBeCloseTo(141, 3);
  });

  test('drop-outs in one stream produce dropped ticks', () => {
    // Stream B has a 30 s gap in the middle.
    const a = stream(T0, T0 + 60_000, 2, () => 140);
    const bBefore = stream(T0, T0 + 10_000, 2, () => 141);
    const bAfter = stream(T0 + 50_000, T0 + 60_000, 2, () => 141);
    const b = [...bBefore, ...bAfter];
    const r = alignStreams(a, b, { targetHz: 2, maxLagMs: 2000 });
    expect(r.dropped).toBeGreaterThan(0);
    // Non-dropped points have B values near 141.
    for (const p of r.aligned) {
      expect(Math.abs(p.fhrB - 141)).toBeLessThanOrEqual(1);
    }
  });

  test('ignores invalid samples when picking nearest', () => {
    const a = stream(T0, T0 + 10_000, 2, () => 140);
    // B: one valid 140, one invalid 999, one valid 142.
    const b: FHRSample[] = [
      { timestamp: T0, fhr: 140, source: 'hr', valid: true },
      { timestamp: T0 + 500, fhr: 999, source: 'hr', valid: false },
      { timestamp: T0 + 1000, fhr: 142, source: 'hr', valid: true },
    ];
    const r = alignStreams(a, b, { targetHz: 2, maxLagMs: 2000 });
    for (const p of r.aligned) {
      // Should never pick the 999.
      expect(p.fhrB).not.toBe(999);
    }
  });

  test('overlap window respects both streams', () => {
    const a = stream(T0, T0 + 60_000, 2, () => 140);
    const b = stream(T0 + 10_000, T0 + 70_000, 2, () => 141);
    const r = alignStreams(a, b, { targetHz: 2 });
    expect(r.from).toBe(T0 + 10_000);
    expect(r.to).toBe(T0 + 60_000);
  });
});
