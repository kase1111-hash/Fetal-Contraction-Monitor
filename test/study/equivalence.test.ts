import {
  equivalenceSummary,
  featureAgreement,
  fhrAgreement,
  pairContractions,
  statusConcordance,
  extractResponsesFromStream,
} from '../../src/study/equivalence';
import { alignStreams } from '../../src/study/align';
import {
  scenarioParams,
  generateFhrStream,
} from '../../src/simulation/scenarios';
import type {
  ContractionResponse,
  FHRSample,
} from '../../src/types';

const T0 = 1_700_000_000_000;

function ctx(
  id: string,
  peak: number,
  nadir = -20,
  recovery = 30,
  baseline = 140,
): ContractionResponse {
  return {
    id,
    timestamp: peak,
    contractionPeakTime: peak,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: baseline,
    nadirDepth: nadir,
    nadirTiming: 10,
    recoveryTime: recovery,
    responseArea: -300,
    fhrQuality: 0.95,
    qualityGrade: 'good',
  };
}

describe('fhrAgreement', () => {
  test('empty → zero-filled result', () => {
    const r = fhrAgreement([]);
    expect(r.n).toBe(0);
    expect(r.bias).toBe(0);
  });

  test('identical streams → bias 0, sd 0, r = 1', () => {
    const aligned = Array.from({ length: 50 }, (_, i) => ({
      t: T0 + i,
      fhrA: 140 + i * 0.1,
      fhrB: 140 + i * 0.1,
    }));
    const r = fhrAgreement(aligned);
    expect(r.bias).toBeCloseTo(0, 10);
    expect(r.sd).toBeCloseTo(0, 10);
    expect(r.rmse).toBeCloseTo(0, 10);
    expect(r.pearsonR).toBeCloseTo(1, 6);
  });

  test('constant offset → that offset as bias, sd 0', () => {
    const aligned = Array.from({ length: 40 }, (_, i) => ({
      t: T0 + i,
      fhrA: 140 + i,
      fhrB: 137 + i, // A - B = 3 always
    }));
    const r = fhrAgreement(aligned);
    expect(r.bias).toBeCloseTo(3, 6);
    expect(r.sd).toBeCloseTo(0, 6);
    expect(r.loaLow).toBeCloseTo(3, 6);
    expect(r.loaHigh).toBeCloseTo(3, 6);
  });

  test('white noise → finite sd, LoA straddle bias', () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return ((seed >>> 0) / 0xffffffff) - 0.5;
    };
    const aligned = Array.from({ length: 200 }, (_, i) => ({
      t: T0 + i,
      fhrA: 140 + rand() * 10,
      fhrB: 140 + rand() * 10,
    }));
    const r = fhrAgreement(aligned);
    expect(r.sd).toBeGreaterThan(0);
    expect(r.loaLow).toBeLessThan(r.bias);
    expect(r.loaHigh).toBeGreaterThan(r.bias);
    // Pearson between two independent noisy signals should be near 0.
    expect(Math.abs(r.pearsonR)).toBeLessThan(0.3);
  });
});

describe('pairContractions', () => {
  test('pairs by nearest peak within tolerance', () => {
    const a = [ctx('a0', T0), ctx('a1', T0 + 180_000), ctx('a2', T0 + 360_000)];
    const b = [
      ctx('b0', T0 + 2000), // close to a0
      ctx('b1', T0 + 180_000 - 5000), // close to a1
      ctx('b2', T0 + 360_000 + 8000), // close to a2
    ];
    const pairs = pairContractions(a, b);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]!.a.id).toBe('a0');
    expect(pairs[0]!.b.id).toBe('b0');
  });

  test('drops A-side with no match within tolerance', () => {
    const a = [ctx('a0', T0), ctx('a1', T0 + 180_000)];
    const b = [ctx('b0', T0 + 2000)];
    const pairs = pairContractions(a, b, 10_000);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a.id).toBe('a0');
  });

  test('each B-side used at most once', () => {
    const a = [ctx('a0', T0), ctx('a1', T0 + 500)];
    const b = [ctx('b0', T0 + 100)];
    const pairs = pairContractions(a, b, 10_000);
    expect(pairs).toHaveLength(1);
  });
});

describe('featureAgreement', () => {
  test('identical A and B → zero bias on every feature', () => {
    const a = [ctx('1', T0, -20, 30), ctx('2', T0 + 180_000, -25, 32)];
    const b = [ctx('1', T0, -20, 30), ctx('2', T0 + 180_000, -25, 32)];
    const { byFeature } = featureAgreement(a, b);
    for (const f of byFeature) {
      expect(f.bias).toBeCloseTo(0, 6);
      expect(f.meanAbsDiff).toBeCloseTo(0, 6);
    }
  });

  test('systematic offset on one feature shows as bias', () => {
    const a = [ctx('1', T0, -20, 35), ctx('2', T0 + 180_000, -25, 37)];
    // B has recovery 5s shorter everywhere.
    const b = [ctx('1', T0, -20, 30), ctx('2', T0 + 180_000, -25, 32)];
    const fa = featureAgreement(a, b);
    const rec = fa.byFeature.find((f) => f.feature === 'recoveryTime')!;
    expect(rec.bias).toBeCloseTo(5, 6);
    expect(rec.meanAbsDiff).toBeCloseTo(5, 6);
  });

  test('meanPctDiff is 0 when B is all zero for that feature', () => {
    const a = [ctx('1', T0, -20, 30, 140), ctx('2', T0 + 180_000, -25, 32, 140)];
    const b = [ctx('1', T0, 0, 0, 0), ctx('2', T0 + 180_000, 0, 0, 0)];
    const fa = featureAgreement(a, b);
    const baseline = fa.byFeature.find((f) => f.feature === 'baselineFHR')!;
    expect(baseline.meanPctDiff).toBe(0);
  });
});

describe('statusConcordance', () => {
  test('empty pairs → zeros', () => {
    const r = statusConcordance([]);
    expect(r.n).toBe(0);
    expect(r.accuracy).toBe(0);
  });

  test('perfect agreement → accuracy 1 and κ = 1', () => {
    // Build 10 identical contraction pairs; statusWalk should match.
    const pairs = Array.from({ length: 10 }, (_, i) => {
      const c = ctx(`c${i}`, T0 + i * 180_000, -20, 30 + (i % 3));
      return { a: c, b: { ...c, id: `b${i}` } };
    });
    const r = statusConcordance(pairs);
    expect(r.accuracy).toBeCloseTo(1, 6);
    expect(r.kappa).toBeCloseTo(1, 6);
    expect(r.n).toBe(10);
  });

  test('confusion matrix sums to n', () => {
    const pairs = Array.from({ length: 8 }, (_, i) => {
      const a = ctx(`a${i}`, T0 + i * 180_000, -20, 30);
      const b = ctx(`b${i}`, T0 + i * 180_000, -20, 30);
      return { a, b };
    });
    const r = statusConcordance(pairs);
    let total = 0;
    for (const row of Object.values(r.confusion)) {
      for (const count of Object.values(row)) total += count;
    }
    expect(total).toBe(r.n);
  });
});

describe('extractResponsesFromStream — pipeline reuse', () => {
  test('re-extracts a response from a synthesized stream', () => {
    const peak = T0 + 180_000;
    const params = scenarioParams('normal', 0, 1);
    const samples: FHRSample[] = generateFhrStream(params, peak);
    const det = {
      peakTimestamp: peak,
      method: 'manual' as const,
      confidence: 1,
    };
    const out = extractResponsesFromStream([det], samples, 'test');
    expect(out).toHaveLength(1);
    expect(out[0]!.baselineFHR).toBeCloseTo(140, 3);
  });
});

describe('equivalenceSummary — full pipeline integration', () => {
  test('identical scenarios agree perfectly on sample-level FHR', () => {
    // Two identical simulated streams → perfect FHR agreement, matched
    // contractions identical on every feature.
    const n = 8;
    const contractions = { a: [] as ContractionResponse[], b: [] as ContractionResponse[] };
    const samplesA: FHRSample[] = [];
    const samplesB: FHRSample[] = [];
    for (let k = 0; k < n; k++) {
      const peak = T0 + k * 180_000;
      const params = scenarioParams('normal', k, n);
      const sA = generateFhrStream(params, peak);
      const sB = generateFhrStream(params, peak);
      samplesA.push(...sA);
      samplesB.push(...sB);
      const c = ctx(`a${k}`, peak, -20, 30);
      contractions.a.push(c);
      contractions.b.push({ ...c, id: `b${k}` });
    }
    const aligned = alignStreams(samplesA, samplesB, { targetHz: 2 });
    const sum = equivalenceSummary(aligned.aligned, contractions.a, contractions.b);
    expect(sum.fhr.bias).toBeCloseTo(0, 3);
    expect(sum.fhr.rmse).toBeCloseTo(0, 3);
    expect(sum.counts.matched).toBe(n);
    for (const f of sum.features.byFeature) {
      expect(f.meanAbsDiff).toBeCloseTo(0, 6);
    }
    expect(sum.status.accuracy).toBeCloseTo(1, 6);
  });
});
