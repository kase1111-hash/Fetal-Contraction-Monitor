import { CtgParseError, importCtgCsv } from '../../src/study/import-ctg';
import { streamToFhrCsv } from '../../src/study/raw-capture';
import { StudyRecorder } from '../../src/study/raw-capture';
import { makeSample } from '../../src/ble/quality-gate';

const T0 = 1_700_000_000_000;

describe('importCtgCsv', () => {
  test('parses a simple two-column CSV with header', () => {
    const csv = `timestamp_ms,fhr_bpm
${T0},140
${T0 + 500},142
${T0 + 1000},141
`;
    const r = importCtgCsv(csv);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[0]).toEqual({
      timestamp: T0,
      fhr: 140,
      source: 'hr',
      valid: true,
    });
    expect(r.skipped).toBeGreaterThanOrEqual(1); // at least the header
    expect(r.invalid).toBe(0);
  });

  test('tolerates CRLF', () => {
    const csv = `timestamp_ms,fhr_bpm\r\n${T0},140\r\n${T0 + 500},145\r\n`;
    const r = importCtgCsv(csv);
    expect(r.samples).toHaveLength(2);
  });

  test('skips blank lines and comments', () => {
    const csv = `# recorded 2024-01-01
timestamp_ms,fhr_bpm

${T0},140
# mid-session note
${T0 + 500},142
`;
    const r = importCtgCsv(csv);
    expect(r.samples).toHaveLength(2);
    expect(r.skipped).toBeGreaterThanOrEqual(3);
  });

  test('marks out-of-range samples invalid but keeps them', () => {
    const csv = `${T0},79
${T0 + 500},140
${T0 + 1000},201
`;
    const r = importCtgCsv(csv);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[0]!.valid).toBe(false);
    expect(r.samples[1]!.valid).toBe(true);
    expect(r.samples[2]!.valid).toBe(false);
    expect(r.invalid).toBe(2);
  });

  test('throws with line number on non-numeric data', () => {
    const csv = `timestamp_ms,fhr_bpm
${T0},140
${T0 + 500},oops
`;
    expect(() => importCtgCsv(csv)).toThrow(CtgParseError);
    try {
      importCtgCsv(csv);
    } catch (e) {
      expect((e as CtgParseError).line).toBe(3);
    }
  });

  test('throws on single-column rows', () => {
    expect(() => importCtgCsv(`${T0}\n`)).toThrow(CtgParseError);
  });

  test('sorts samples chronologically', () => {
    const csv = `${T0 + 1000},141
${T0},140
${T0 + 500},142
`;
    const r = importCtgCsv(csv);
    expect(r.samples.map((s) => s.timestamp)).toEqual([
      T0,
      T0 + 500,
      T0 + 1000,
    ]);
  });

  test('roundtrips through streamToFhrCsv', () => {
    // Capture some samples, serialize, re-import — samples match exactly.
    const rec = new StudyRecorder();
    rec.open('s', T0);
    for (let i = 0; i < 10; i++) {
      rec.sample('s', makeSample(140 + i, T0 + i * 500, 'hr'));
    }
    const csv = streamToFhrCsv(rec.stream('s')!);
    const imported = importCtgCsv(csv);
    expect(imported.samples).toHaveLength(10);
    expect(imported.samples[0]!.timestamp).toBe(T0);
    expect(imported.samples[9]!.fhr).toBe(149);
  });
});
