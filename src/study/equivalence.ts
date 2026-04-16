/**
 * Equivalence metrics between a consumer Doppler recording (A) and a
 * clinical CTG recording (B) of the same labor.
 *
 * This is the core scientific output of Phase 4. All functions are pure —
 * they take data in, return numbers out. No I/O, no UI.
 *
 * Three flavors of agreement are computed:
 *
 *   1. Sample-level FHR agreement (Bland-Altman):
 *        bias = mean(A - B)
 *        sd   = population SD of (A - B)
 *        loa  = [bias - 1.96·sd, bias + 1.96·sd]
 *      Plus Pearson r and RMSE.
 *
 *   2. Per-contraction feature agreement: for each ContractionResponse
 *      matched between the two recordings, compute absolute + percent
 *      differences in baseline, nadirDepth, recoveryTime, responseArea.
 *
 *   3. Alert-status concordance: for each contraction index, compare the
 *      running status from A vs. B. Produce Cohen's κ, overall accuracy,
 *      and a confusion matrix.
 *
 * The output of (1) + (2) + (3) is the full equivalence surface the
 * study report will publish.
 */

import { establishBaseline } from '../alerts/personal-baseline';
import { determineStatus } from '../alerts/status';
import { extractResponse } from '../extraction/extract-response';
import { mean, std } from '../extraction/statistics';
import { computeTrajectoryFeatures } from '../trajectory/features';
import type {
  AlertStatus,
  ContractionDetection,
  ContractionResponse,
  FHRSample,
  PersonalBaseline,
} from '../types';
import type { AlignedPoint } from './align';

// ---------------------------------------------------------------------------
// Sample-level FHR agreement
// ---------------------------------------------------------------------------

export interface FhrAgreement {
  n: number;
  bias: number;
  sd: number;
  /** Bland-Altman 95% limits of agreement. */
  loaLow: number;
  loaHigh: number;
  /** Pearson correlation between the two streams. */
  pearsonR: number;
  /** Root-mean-square error between streams. */
  rmse: number;
}

export function fhrAgreement(aligned: readonly AlignedPoint[]): FhrAgreement {
  if (aligned.length < 2) {
    return {
      n: aligned.length,
      bias: 0,
      sd: 0,
      loaLow: 0,
      loaHigh: 0,
      pearsonR: 0,
      rmse: 0,
    };
  }
  const diffs = aligned.map((p) => p.fhrA - p.fhrB);
  const bias = mean(diffs);
  const sd = std(diffs);
  const loaLow = bias - 1.96 * sd;
  const loaHigh = bias + 1.96 * sd;

  // Pearson r
  const xs = aligned.map((p) => p.fhrA);
  const ys = aligned.map((p) => p.fhrB);
  const xm = mean(xs);
  const ym = mean(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - xm;
    const dy = ys[i]! - ym;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const pearsonR = denX === 0 || denY === 0 ? 0 : num / Math.sqrt(denX * denY);

  // RMSE
  let sqSum = 0;
  for (const d of diffs) sqSum += d * d;
  const rmse = Math.sqrt(sqSum / diffs.length);

  return {
    n: aligned.length,
    bias,
    sd,
    loaLow,
    loaHigh,
    pearsonR,
    rmse,
  };
}

// ---------------------------------------------------------------------------
// Per-contraction feature agreement
// ---------------------------------------------------------------------------

export interface FeatureDiff {
  feature: 'baselineFHR' | 'nadirDepth' | 'recoveryTime' | 'responseArea';
  n: number;
  meanAbsDiff: number;
  /** Mean signed difference (A - B). */
  bias: number;
  /** Mean absolute percent difference. 0 when all B values are zero. */
  meanPctDiff: number;
}

export interface FeatureAgreement {
  byFeature: FeatureDiff[];
  pairs: Array<{ a: ContractionResponse; b: ContractionResponse }>;
}

/**
 * Pair ContractionResponses between two sessions by nearest peak time
 * within ±peakToleranceMs. Each A-side response is paired with the closest
 * B-side response; unmatched responses are dropped from the analysis
 * (and reported as `unmatched{A,B}` by the caller if needed).
 */
export function pairContractions(
  a: readonly ContractionResponse[],
  b: readonly ContractionResponse[],
  peakToleranceMs = 30_000,
): Array<{ a: ContractionResponse; b: ContractionResponse }> {
  const usedB = new Set<number>();
  const pairs: Array<{ a: ContractionResponse; b: ContractionResponse }> = [];
  for (const ca of a) {
    let bestIdx = -1;
    let bestDt = peakToleranceMs + 1;
    for (let i = 0; i < b.length; i++) {
      if (usedB.has(i)) continue;
      const dt = Math.abs(ca.contractionPeakTime - b[i]!.contractionPeakTime);
      if (dt < bestDt) {
        bestDt = dt;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDt <= peakToleranceMs) {
      usedB.add(bestIdx);
      pairs.push({ a: ca, b: b[bestIdx]! });
    }
  }
  return pairs;
}

function diffStats(diffs: number[], bVals: number[]): Omit<FeatureDiff, 'feature'> {
  if (diffs.length === 0) {
    return { n: 0, meanAbsDiff: 0, bias: 0, meanPctDiff: 0 };
  }
  const abs = diffs.map((d) => Math.abs(d));
  const meanAbsDiff = mean(abs);
  const bias = mean(diffs);
  const pcts: number[] = [];
  for (let i = 0; i < diffs.length; i++) {
    const denom = Math.abs(bVals[i]!);
    if (denom > 1e-9) pcts.push(Math.abs(diffs[i]!) / denom);
  }
  const meanPctDiff = pcts.length === 0 ? 0 : mean(pcts);
  return { n: diffs.length, meanAbsDiff, bias, meanPctDiff };
}

export function featureAgreement(
  a: readonly ContractionResponse[],
  b: readonly ContractionResponse[],
  peakToleranceMs = 30_000,
): FeatureAgreement {
  const pairs = pairContractions(a, b, peakToleranceMs);

  const features: FeatureDiff['feature'][] = [
    'baselineFHR',
    'nadirDepth',
    'recoveryTime',
    'responseArea',
  ];

  const byFeature: FeatureDiff[] = features.map((f) => {
    const diffs = pairs.map((p) => p.a[f] - p.b[f]);
    const bVals = pairs.map((p) => p.b[f]);
    return { feature: f, ...diffStats(diffs, bVals) };
  });

  return { byFeature, pairs };
}

// ---------------------------------------------------------------------------
// Alert-status concordance
// ---------------------------------------------------------------------------

export interface StatusConcordance {
  /** Total paired contractions compared. */
  n: number;
  /** Fraction of indices where A and B produced the same status. */
  accuracy: number;
  /** Cohen's κ — chance-corrected agreement. */
  kappa: number;
  /** 4×4 confusion matrix keyed by [A][B] with counts. */
  confusion: Record<AlertStatus, Record<AlertStatus, number>>;
}

const STATUSES: AlertStatus[] = ['grey', 'green', 'yellow', 'red'];

function emptyConfusion(): StatusConcordance['confusion'] {
  const m: Partial<Record<AlertStatus, Record<AlertStatus, number>>> = {};
  for (const a of STATUSES) {
    const row: Record<AlertStatus, number> = {
      grey: 0,
      green: 0,
      yellow: 0,
      red: 0,
    };
    m[a] = row;
  }
  return m as StatusConcordance['confusion'];
}

/**
 * Walk both contraction lists in parallel and record the alert status that
 * would have been emitted after each contraction if the trajectory + baseline
 * pipeline had been run on that stream alone. Used for status concordance.
 */
function statusWalk(contractions: readonly ContractionResponse[]): AlertStatus[] {
  const out: AlertStatus[] = [];
  let baseline: PersonalBaseline | null = null;
  let redCount = 0;
  const acc: ContractionResponse[] = [];
  for (const c of contractions) {
    acc.push(c);
    if (baseline === null) baseline = establishBaseline(acc);
    const features = computeTrajectoryFeatures(acc);
    const r = determineStatus({
      features,
      baseline,
      recentContractions: acc,
      redPersistenceCount: redCount,
    });
    out.push(r.status);
    redCount = r.redPersistenceCount;
  }
  return out;
}

export function statusConcordance(
  pairs: ReadonlyArray<{ a: ContractionResponse; b: ContractionResponse }>,
): StatusConcordance {
  if (pairs.length === 0) {
    return {
      n: 0,
      accuracy: 0,
      kappa: 0,
      confusion: emptyConfusion(),
    };
  }
  // Walk each side independently.
  const aSeq = statusWalk(pairs.map((p) => p.a));
  const bSeq = statusWalk(pairs.map((p) => p.b));

  const confusion = emptyConfusion();
  let agree = 0;
  for (let i = 0; i < aSeq.length; i++) {
    const a = aSeq[i]!;
    const b = bSeq[i]!;
    confusion[a][b] += 1;
    if (a === b) agree += 1;
  }
  const n = aSeq.length;
  const accuracy = agree / n;

  // Cohen's κ
  const marginalsA: Record<AlertStatus, number> = {
    grey: 0,
    green: 0,
    yellow: 0,
    red: 0,
  };
  const marginalsB: Record<AlertStatus, number> = {
    grey: 0,
    green: 0,
    yellow: 0,
    red: 0,
  };
  for (const a of STATUSES) {
    for (const b of STATUSES) {
      marginalsA[a] += confusion[a][b];
      marginalsB[b] += confusion[a][b];
    }
  }
  let pe = 0;
  for (const s of STATUSES) pe += (marginalsA[s] / n) * (marginalsB[s] / n);
  const kappa = pe === 1 ? 1 : (accuracy - pe) / (1 - pe);

  return { n, accuracy, kappa, confusion };
}

// ---------------------------------------------------------------------------
// Convenience: extract ContractionResponses from an imported FHR stream
// given a list of contraction-peak timestamps.
// ---------------------------------------------------------------------------

/**
 * Re-extract response features for each detection against a given sample
 * stream. This is how we "run" the extracted-feature pipeline on an
 * imported clinical CTG using the detection peaks captured on the
 * consumer side (or vice versa).
 *
 * Rejected extractions are dropped; callers can inspect the return length
 * vs. detection count.
 */
export function extractResponsesFromStream(
  detections: readonly ContractionDetection[],
  samples: readonly FHRSample[],
  idPrefix: string,
): ContractionResponse[] {
  const out: ContractionResponse[] = [];
  detections.forEach((d, i) => {
    const r = extractResponse({
      detection: d,
      samples,
      id: `${idPrefix}-${i}`,
    });
    if (r.ok) out.push(r.response);
  });
  return out;
}

// ---------------------------------------------------------------------------
// One-shot: full equivalence run
// ---------------------------------------------------------------------------

export interface EquivalenceSummary {
  /** Sample-level Bland-Altman / Pearson / RMSE on the aligned FHR series. */
  fhr: FhrAgreement;
  /** Per-feature agreement over matched contractions. */
  features: FeatureAgreement;
  /** Alert-status concordance for matched contractions. */
  status: StatusConcordance;
  /** Total contractions in A, B, and matched pairs. */
  counts: { nA: number; nB: number; matched: number };
}

export function equivalenceSummary(
  aligned: readonly AlignedPoint[],
  a: readonly ContractionResponse[],
  b: readonly ContractionResponse[],
  peakToleranceMs = 30_000,
): EquivalenceSummary {
  const fhr = fhrAgreement(aligned);
  const features = featureAgreement(a, b, peakToleranceMs);
  const status = statusConcordance(features.pairs);
  return {
    fhr,
    features,
    status,
    counts: { nA: a.length, nB: b.length, matched: features.pairs.length },
  };
}
