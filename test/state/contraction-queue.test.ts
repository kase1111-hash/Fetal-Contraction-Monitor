import { ContractionQueue } from '../../src/state/contraction-queue';
import { generateFhrStream, scenarioParams } from '../../src/simulation/scenarios';

const PEAK = 1_700_000_000_000;

describe('ContractionQueue', () => {
  test('does not extract before RESPONSE_WINDOW has elapsed', () => {
    const q = new ContractionQueue();
    q.enqueue({ peakTimestamp: PEAK, method: 'manual', confidence: 1 });
    const samples = generateFhrStream(scenarioParams('normal', 0, 1), PEAK);
    // tick 30 s after peak — still pending
    const r = q.tick(PEAK + 30_000, samples);
    expect(r.extracted).toHaveLength(0);
    expect(q.size()).toBe(1);
  });

  test('extracts after 60 s', () => {
    const q = new ContractionQueue();
    q.enqueue({ peakTimestamp: PEAK, method: 'manual', confidence: 1 });
    const samples = generateFhrStream(scenarioParams('normal', 0, 1), PEAK);
    const r = q.tick(PEAK + 60_001, samples);
    expect(r.extracted).toHaveLength(1);
    expect(q.size()).toBe(0);
    expect(r.extracted[0]!.baselineFHR).toBeCloseTo(140, 5);
  });

  test('records rejections when extraction fails (insufficient samples)', () => {
    const q = new ContractionQueue();
    q.enqueue({ peakTimestamp: PEAK, method: 'manual', confidence: 1 });
    const r = q.tick(PEAK + 60_001, []); // no samples → baseline fails
    expect(r.extracted).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toBe('baseline-insufficient-samples');
  });

  test('ids are unique across extractions', () => {
    const q = new ContractionQueue();
    q.enqueue({ peakTimestamp: PEAK, method: 'manual', confidence: 1 });
    q.enqueue({ peakTimestamp: PEAK + 180_000, method: 'manual', confidence: 1 });
    const s1 = generateFhrStream(scenarioParams('normal', 0, 2), PEAK);
    const s2 = generateFhrStream(scenarioParams('normal', 1, 2), PEAK + 180_000);
    const r = q.tick(PEAK + 180_000 + 60_001, [...s1, ...s2]);
    expect(r.extracted).toHaveLength(2);
    expect(r.extracted[0]!.id).not.toBe(r.extracted[1]!.id);
  });
});
