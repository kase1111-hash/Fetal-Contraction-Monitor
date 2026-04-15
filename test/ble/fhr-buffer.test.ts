import { FhrBuffer } from '../../src/ble/fhr-buffer';
import { makeSample } from '../../src/ble/quality-gate';

const t0 = 1_700_000_000_000;

describe('FhrBuffer', () => {
  test('push + all returns samples in order', () => {
    const buf = new FhrBuffer();
    buf.push(makeSample(140, t0, 'rr'));
    buf.push(makeSample(145, t0 + 1000, 'rr'));
    const all = buf.all();
    expect(all).toHaveLength(2);
    expect(all[0]!.fhr).toBe(140);
    expect(all[1]!.fhr).toBe(145);
  });

  test('evicts samples older than 120 s horizon', () => {
    const buf = new FhrBuffer();
    buf.push(makeSample(140, t0, 'rr'));
    // Push a sample 130 s later — everything older than 120 s should drop.
    buf.push(makeSample(150, t0 + 130_000, 'rr'));
    expect(buf.size()).toBe(1);
    expect(buf.all()[0]!.fhr).toBe(150);
  });

  test('retains samples at the 120 s boundary', () => {
    const buf = new FhrBuffer();
    buf.push(makeSample(140, t0, 'rr'));
    buf.push(makeSample(150, t0 + 119_000, 'rr'));
    expect(buf.size()).toBe(2);
  });

  test('slice returns samples in [from, to] inclusive', () => {
    const buf = new FhrBuffer();
    for (let i = 0; i < 10; i++) {
      buf.push(makeSample(140, t0 + i * 1000, 'rr'));
    }
    const got = buf.slice(t0 + 3000, t0 + 6000);
    expect(got.map((s) => s.fhr)).toHaveLength(4); // t+3,4,5,6
  });

  test('onGap fires when spacing > 10 s', () => {
    const gaps: number[] = [];
    const buf = new FhrBuffer({ onGap: (dt) => gaps.push(dt) });
    buf.push(makeSample(140, t0, 'rr'));
    buf.push(makeSample(145, t0 + 10_100, 'rr'));
    expect(gaps).toEqual([10.1]);
  });

  test('latestValid skips invalid trailing samples', () => {
    const buf = new FhrBuffer();
    buf.push(makeSample(140, t0, 'rr'));
    buf.push(makeSample(210, t0 + 1000, 'rr')); // invalid (>200)
    expect(buf.latestValid()!.fhr).toBe(140);
  });

  test('clear empties the buffer', () => {
    const buf = new FhrBuffer();
    buf.push(makeSample(140, t0, 'rr'));
    buf.clear();
    expect(buf.size()).toBe(0);
  });
});
