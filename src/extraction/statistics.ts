/**
 * Small statistics helpers — mean, median, std, percentile — used by
 * extraction, trajectory, and baseline computation.
 *
 * No external libraries (per README §"Tech Stack": "Pure JS/TS").
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Population standard deviation (divisor = N). */
export function std(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / xs.length);
}

/**
 * Linear interpolation percentile (type 7, the NumPy default).
 * `p` is 0–100. Returns 0 on empty input.
 */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0]!;
  const sorted = [...xs].sort((a, b) => a - b);
  const q = Math.max(0, Math.min(100, p)) / 100;
  const h = q * (sorted.length - 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Ordinary least-squares slope of y against a unit-spaced x axis (0, 1, …, n-1).
 * Returns 0 for n < 2.
 */
export function olsSlope(ys: readonly number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    num += dx * (ys[i]! - yMean);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}
