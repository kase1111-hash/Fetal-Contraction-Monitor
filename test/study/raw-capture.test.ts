import {
  StudyRecorder,
  streamToFhrCsv,
} from '../../src/study/raw-capture';
import { makeSample } from '../../src/ble/quality-gate';

const T0 = 1_700_000_000_000;

describe('StudyRecorder', () => {
  test('open is idempotent', () => {
    const r = new StudyRecorder();
    r.open('consumer-doppler', T0);
    r.open('consumer-doppler', T0 + 100);
    expect(r.labels()).toEqual(['consumer-doppler']);
    expect(r.stream('consumer-doppler')!.startedAt).toBe(T0);
  });

  test('silently drops samples/detections for unopened streams', () => {
    const r = new StudyRecorder();
    r.sample('ghost', makeSample(140, T0, 'hr'));
    r.detect('ghost', {
      peakTimestamp: T0,
      method: 'manual',
      confidence: 1,
    });
    expect(r.labels()).toEqual([]);
  });

  test('captures samples and detections per stream', () => {
    const r = new StudyRecorder();
    r.open('consumer-doppler', T0);
    r.open('clinical-ctg', T0);
    r.sample('consumer-doppler', makeSample(140, T0, 'hr'));
    r.sample('consumer-doppler', makeSample(145, T0 + 500, 'hr'));
    r.sample('clinical-ctg', makeSample(138, T0, 'hr'));
    r.detect('consumer-doppler', {
      peakTimestamp: T0 + 60_000,
      method: 'accelerometer',
      confidence: 0.6,
    });

    const consumer = r.stream('consumer-doppler')!;
    expect(consumer.samples).toHaveLength(2);
    expect(consumer.detections).toHaveLength(1);
    expect(r.stream('clinical-ctg')!.samples).toHaveLength(1);
  });

  test('all() returns streams sorted by label', () => {
    const r = new StudyRecorder();
    r.open('zeta', T0);
    r.open('alpha', T0);
    expect(r.all().map((s) => s.label)).toEqual(['alpha', 'zeta']);
  });

  test('clear removes all streams', () => {
    const r = new StudyRecorder();
    r.open('consumer-doppler', T0);
    r.sample('consumer-doppler', makeSample(140, T0, 'hr'));
    r.clear();
    expect(r.labels()).toEqual([]);
  });
});

describe('streamToFhrCsv', () => {
  test('emits header + rows', () => {
    const r = new StudyRecorder();
    r.open('s', T0);
    r.sample('s', makeSample(140, T0, 'hr'));
    r.sample('s', makeSample(145, T0 + 500, 'hr'));
    const csv = streamToFhrCsv(r.stream('s')!);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('timestamp_ms,fhr_bpm');
    expect(lines).toHaveLength(3);
  });

  test('skips non-finite values', () => {
    const r = new StudyRecorder();
    r.open('s', T0);
    r.sample('s', { timestamp: T0, fhr: NaN, source: 'hr', valid: false });
    r.sample('s', makeSample(140, T0 + 500, 'hr'));
    const csv = streamToFhrCsv(r.stream('s')!);
    // Only the valid finite row + header.
    expect(csv.trim().split('\n')).toHaveLength(2);
  });

  test('ends with a trailing newline', () => {
    const r = new StudyRecorder();
    r.open('s', T0);
    r.sample('s', makeSample(140, T0, 'hr'));
    expect(streamToFhrCsv(r.stream('s')!).endsWith('\n')).toBe(true);
  });
});
