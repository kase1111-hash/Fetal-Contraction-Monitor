/**
 * Torus math — canonical implementations from Paper V (Cardiac Torus series).
 *
 * These four functions are reproduced verbatim from fetal-contraction-monitor-CLAUDE.md
 * §"The Torus Math". They are the ground truth: do not modify without updating the
 * research pipeline and revalidating against CTU-UHB.
 *
 * Reference: fetal-contraction-monitor-CLAUDE.md lines 123–166.
 */

export const TWO_PI = 2 * Math.PI;

/**
 * Map a scalar value to an angle in [0, 2π) via linear scaling between min and max.
 *
 * The caller decides `min`/`max`:
 *   - Alert logic / trajectory features → fixed population bounds
 *     (NADIR_MAP_MIN/MAX, RECOVERY_MAP_MIN/MAX)
 *   - Torus visualization → adaptive 2nd–98th percentile of session data
 *
 * See CLAUDE.md §"Critical Discovery: Fixed vs Adaptive Normalization".
 *
 * @param value Scalar feature value (e.g. nadir depth in bpm, recovery time in seconds).
 * @param min Lower bound of the linear mapping (maps to 0).
 * @param max Upper bound of the linear mapping (maps to 2π).
 * @returns Angle in [0, 2π). Degenerate (max ≈ min) → π.
 */
export function toAngle(value: number, min: number, max: number): number {
  if (max - min < 0.001) return Math.PI;
  return TWO_PI * Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Geodesic distance on the flat torus T² = [0, 2π) × [0, 2π).
 *
 * Each coordinate wraps; the shortest arc is `min(|Δ|, 2π - |Δ|)`. Returns
 * the Euclidean distance of the wrapped coordinate differences.
 *
 * @param a Point [θ₁, θ₂] ∈ T².
 * @param b Point [θ₁, θ₂] ∈ T².
 * @returns Non-negative distance ≤ π√2.
 */
export function geodesicDistance(a: [number, number], b: [number, number]): number {
  let d1 = Math.abs(a[0] - b[0]);
  d1 = Math.min(d1, TWO_PI - d1);
  let d2 = Math.abs(a[1] - b[1]);
  d2 = Math.min(d2, TWO_PI - d2);
  return Math.sqrt(d1 * d1 + d2 * d2);
}

/**
 * Menger curvature of three points on the torus, computed from geodesic side lengths
 * via Heron's formula: κ = 4·Area / (a·b·c). Collinear / degenerate triples return 0.
 *
 * Used to color torus trajectory points and to characterize labor phase shape.
 *
 * @returns Non-negative curvature. 0 indicates collinear or zero-length sides.
 */
export function mengerCurvature(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): number {
  const a = geodesicDistance(p2, p3);
  const b = geodesicDistance(p1, p3);
  const c = geodesicDistance(p1, p2);
  if (a < 1e-8 || b < 1e-8 || c < 1e-8) return 0;
  const s = (a + b + c) / 2;
  const area2 = s * (s - a) * (s - b) * (s - c);
  if (area2 <= 0) return 0;
  return (4 * Math.sqrt(area2)) / (a * b * c);
}

/**
 * Gini coefficient of a set of non-negative values. 0 = perfect equality,
 * → 1 = maximal concentration in a single value. Empty or singleton sets return 0.
 *
 * Used to quantify how concentrated curvature is across a labor trajectory.
 *
 * Formula: G = (2·Σ iᵢ·xᵢ) / (n·Σxᵢ) − (n+1)/n, with xᵢ sorted ascending, iᵢ ∈ [1, n].
 */
export function giniCoefficient(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 2) return 0;
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  let weighted = 0;
  v.forEach((val, i) => {
    weighted += (i + 1) * val;
  });
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}
