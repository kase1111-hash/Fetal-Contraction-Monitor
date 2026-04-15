import { sessionToCsv, CSV_COLUMNS } from '../../src/export/csv';
import { emptySession } from '../../src/storage/session-store';
import type { ContractionResponse } from '../../src/types';

function ctx(i: number, nadir: number, recovery: number): ContractionResponse {
  return {
    id: `c${i}`,
    timestamp: 1,
    contractionPeakTime: 1_700_000_000_000 + i * 60_000,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: nadir,
    nadirTiming: 10,
    recoveryTime: recovery,
    responseArea: -100,
    fhrQuality: 1,
    qualityGrade: 'good',
  };
}

describe('sessionToCsv', () => {
  test('empty session → header only', () => {
    const s = emptySession('s', 1);
    const csv = sessionToCsv(s);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
  });

  test('one row per contraction', () => {
    const s = emptySession('s', 1);
    s.contractions.push(ctx(0, -20, 30), ctx(1, -22, 32), ctx(2, -24, 34));
    const lines = sessionToCsv(s).trim().split('\n');
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);
  });

  test('trajectory features are cumulative per row (slope grows across rows)', () => {
    const s = emptySession('s', 1);
    // Rising recovery → recovery trend slope starts at 0 (single ctx), then grows.
    for (let i = 0; i < 6; i++) {
      s.contractions.push(ctx(i, -20, 30 + i));
    }
    const lines = sessionToCsv(s).trim().split('\n');
    const header = lines[0]!.split(',');
    const idxSlope = header.indexOf('recovery_trend_slope_so_far');
    const row0 = lines[1]!.split(',');
    const row5 = lines[6]!.split(',');
    // First row: only one contraction ever → slope 0
    expect(parseFloat(row0[idxSlope]!)).toBeCloseTo(0, 6);
    // Last row: six contractions with recovery 30..35, slope = 1
    expect(parseFloat(row5[idxSlope]!)).toBeCloseTo(1, 6);
  });

  test('escapes fields containing commas / quotes / newlines', () => {
    const s = emptySession('s', 1);
    const evil = ctx(0, -20, 30);
    // Nothing in the real schema produces commas, but defensively:
    evil.id = 'weird,id';
    s.contractions.push(evil);
    const csv = sessionToCsv(s);
    expect(csv).toContain('"weird,id"');
  });

  test('ends with a trailing newline', () => {
    const s = emptySession('s', 1);
    s.contractions.push(ctx(0, -20, 30));
    const csv = sessionToCsv(s);
    expect(csv.endsWith('\n')).toBe(true);
  });
});
