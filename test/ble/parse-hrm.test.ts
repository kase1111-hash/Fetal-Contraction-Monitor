import { parseHrm, deriveIntervalFromHr, hrmToSamples } from '../../src/ble/parse-hrm';
import { FhrBuffer } from '../../src/ble/fhr-buffer';

describe('parseHrm', () => {
  test('uint8 HR, no RR', () => {
    // flags=0x00 (uint8, no RR, no energy), hr=140
    const bytes = new Uint8Array([0x00, 140]);
    const p = parseHrm(bytes);
    expect(p.hr).toBe(140);
    expect(p.hr16).toBe(false);
    expect(p.rrMs).toEqual([]);
  });

  test('uint16 HR (bit 0 set)', () => {
    // flags=0x01, hr=300 little-endian (0x012C) — valid >255 value demands uint16
    const bytes = new Uint8Array([0x01, 0x2c, 0x01]);
    const p = parseHrm(bytes);
    expect(p.hr).toBe(300);
    expect(p.hr16).toBe(true);
    expect(p.rrMs).toEqual([]);
  });

  test('RR intervals (bit 4) parsed and converted from 1/1024 s to ms', () => {
    // flags=0x10 (RR present, uint8 HR), hr=140, then two RR values
    // 1024 raw → 1000 ms; 512 raw → 500 ms
    const bytes = new Uint8Array([0x10, 140, 0x00, 0x04, 0x00, 0x02]);
    const p = parseHrm(bytes);
    expect(p.hr).toBe(140);
    // 1024 / 1.024 == 1000
    expect(p.rrMs[0]).toBeCloseTo(1000, 9);
    // 512 / 1.024 == 500
    expect(p.rrMs[1]).toBeCloseTo(500, 9);
  });

  test('skips Energy Expended (bit 3) field', () => {
    // flags=0x18 → energy (bit 3) + RR (bit 4), uint8 HR
    // hr=140, energy=0xDEAD (2 bytes skipped), one RR=1024 (→ 1000 ms)
    const bytes = new Uint8Array([0x18, 140, 0xad, 0xde, 0x00, 0x04]);
    const p = parseHrm(bytes);
    expect(p.hr).toBe(140);
    expect(p.rrMs).toHaveLength(1);
    expect(p.rrMs[0]).toBeCloseTo(1000, 9);
  });

  test('sensorNoContact set when supported but not detected', () => {
    // flags bits 1,2: supported=1, detected=0 → noContact true
    // 0x04 = support, detected bit 1 cleared
    const bytes = new Uint8Array([0x04, 140]);
    const p = parseHrm(bytes);
    expect(p.sensorNoContact).toBe(true);
  });

  test('sensorNoContact false when contact detected', () => {
    // bits 1+2 both set → supported + detected
    const bytes = new Uint8Array([0x06, 140]);
    const p = parseHrm(bytes);
    expect(p.sensorNoContact).toBe(false);
  });

  test('throws on truncated packet', () => {
    expect(() => parseHrm(new Uint8Array([]))).toThrow();
    expect(() => parseHrm(new Uint8Array([0x00]))).toThrow();
  });

  test('throws if uint16 flag set but only one HR byte follows', () => {
    expect(() => parseHrm(new Uint8Array([0x01, 0x2c]))).toThrow();
  });
});

describe('deriveIntervalFromHr', () => {
  test('60 bpm → 1000 ms', () => {
    expect(deriveIntervalFromHr(60)).toBeCloseTo(1000, 10);
  });
  test('120 bpm → 500 ms', () => {
    expect(deriveIntervalFromHr(120)).toBeCloseTo(500, 10);
  });
  test('0 → 0 (guard)', () => {
    expect(deriveIntervalFromHr(0)).toBe(0);
  });
});

describe('hrmToSamples', () => {
  const NOW = 1_700_000_000_000;

  test('no RR intervals → one HR-derived sample stamped at now', () => {
    const p = parseHrm(new Uint8Array([0x00, 140]));
    const samples = hrmToSamples(p, NOW);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.fhr).toBe(140);
    expect(samples[0]!.timestamp).toBe(NOW);
    expect(samples[0]!.source).toBe('hr');
  });

  test('emits RR-derived samples oldest first', () => {
    // flags=0x10 (RR present), hr=140, three RR intervals of 400/430/410 raw.
    const bytes = new Uint8Array([0x10, 140, 0x90, 0x01, 0xae, 0x01, 0x9a, 0x01]);
    const p = parseHrm(bytes);
    expect(p.rrMs).toHaveLength(3);

    const samples = hrmToSamples(p, NOW);
    expect(samples).toHaveLength(3);

    const ts = samples.map((s) => s.timestamp);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    // The newest beat closes exactly at the notification time.
    expect(ts[ts.length - 1]).toBeCloseTo(NOW, 6);
    // Each beat is spaced by its own RR interval.
    expect(ts[1]! - ts[0]!).toBeCloseTo(p.rrMs[1]!, 6);
    expect(ts[2]! - ts[1]!).toBeCloseTo(p.rrMs[2]!, 6);
  });

  test('RR values convert to bpm', () => {
    // Single RR of 512 raw = 500 ms → 120 bpm.
    const bytes = new Uint8Array([0x10, 140, 0x00, 0x02]);
    const samples = hrmToSamples(parseHrm(bytes), NOW);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.fhr).toBeCloseTo(120, 6);
    expect(samples[0]!.source).toBe('rr');
    expect(samples[0]!.timestamp).toBeCloseTo(NOW, 6);
  });

  test('feeding a whole notification into FhrBuffer keeps it ordered', () => {
    const bytes = new Uint8Array([0x10, 140, 0x90, 0x01, 0xae, 0x01, 0x9a, 0x01]);
    const buf = new FhrBuffer();
    for (const s of hrmToSamples(parseHrm(bytes), NOW)) buf.push(s);
    const ts = buf.all().map((s) => s.timestamp);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(buf.latestValid()!.timestamp).toBeCloseTo(NOW, 6);
  });
});
