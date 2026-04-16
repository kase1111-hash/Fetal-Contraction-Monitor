/**
 * CSV export — one row per contraction with all ContractionResponse fields
 * plus the trajectory features computed AT THAT contraction's index.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §7.3 (lines 420–422).
 *
 * No commas in any field are produced by the app (all numeric / enum), so
 * simple comma joining is safe. Strings are still escaped defensively.
 */

import { computeTrajectoryFeatures } from '../trajectory/features';
import type { LaborSession } from '../types';

/** Columns, in output order. */
const COLUMNS = [
  'index',
  'contraction_id',
  'contraction_peak_time_ms',
  'detection_method',
  'detection_confidence',
  'baseline_fhr',
  'nadir_depth',
  'nadir_timing',
  'recovery_time',
  'response_area',
  'fhr_quality',
  'quality_grade',
  'recovery_trend_slope_so_far',
  'nadir_trend_slope_so_far',
  'recovery_last5_mean_so_far',
  'nadir_acceleration_so_far',
  'area_last5_mean_so_far',
  'kappa_median_so_far',
  'kappa_gini_so_far',
] as const;

function escape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '';
  // Avoid scientific notation for typical clinical ranges; 4 decimals is plenty.
  return Math.abs(v) < 1e-4 && v !== 0 ? v.toExponential(4) : v.toFixed(4);
}

/**
 * Generate a CSV string for a session. The trajectory features shown on each
 * row are computed cumulatively — using only contractions up to and including
 * that row — so the file shows how each feature evolved through labor.
 *
 * Complexity note: the cumulative recomputation is O(n²) in contraction count.
 * For typical labor sessions (<=50 contractions) this runs in under 10 ms at
 * export time, so we keep the clear recompute-per-row structure rather than
 * threading running-sum accumulators through computeTrajectoryFeatures. If a
 * future use case involves thousands of contractions (e.g. batch processing
 * of research recordings), switch to a forward-pass with running sums.
 */
export function sessionToCsv(session: LaborSession): string {
  const header = COLUMNS.join(',');
  const rows: string[] = [header];

  for (let i = 0; i < session.contractions.length; i++) {
    const c = session.contractions[i]!;
    const cumulative = session.contractions.slice(0, i + 1);
    const f = computeTrajectoryFeatures(cumulative);

    const cells = [
      i.toString(),
      escape(c.id),
      c.contractionPeakTime.toString(),
      escape(c.detectionMethod),
      fmt(c.detectionConfidence),
      fmt(c.baselineFHR),
      fmt(c.nadirDepth),
      fmt(c.nadirTiming),
      fmt(c.recoveryTime),
      fmt(c.responseArea),
      fmt(c.fhrQuality),
      escape(c.qualityGrade),
      fmt(f.recoveryTrendSlope),
      fmt(f.nadirTrendSlope),
      fmt(f.recoveryLast5Mean),
      fmt(f.nadirAcceleration),
      fmt(f.areaLast5Mean),
      fmt(f.kappaMedian),
      fmt(f.kappaGini),
    ];
    rows.push(cells.join(','));
  }

  return rows.join('\n') + '\n';
}

/** Exposed for tests. */
export const CSV_COLUMNS = COLUMNS;
