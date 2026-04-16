/**
 * Clinical CTG importer.
 *
 * Ingests a two-column CSV of `timestamp_ms,fhr_bpm` into `FHRSample[]`,
 * the same type produced by the BLE Doppler pipeline. Samples are passed
 * through the quality gate (FHR_MIN..FHR_MAX) exactly like live samples,
 * so all downstream extraction / trajectory / equivalence code works
 * without knowing the origin.
 *
 * Accepted inputs:
 *   - Header row starting with "timestamp" (case-insensitive) is skipped.
 *   - CR/LF line endings are tolerated.
 *   - Comment lines starting with "#" are skipped.
 *   - Blank lines are skipped.
 *
 * Columns:
 *   timestamp_ms : integer Unix milliseconds (or any monotonic number)
 *   fhr_bpm      : float beats-per-minute
 *
 * The parser is strict about parseability: a non-numeric row raises an
 * error with line number rather than silently dropping the row.
 *
 * This matches the format written by `streamToFhrCsv` in raw-capture.ts,
 * so exporting one session and re-importing it yields the identical
 * sample stream.
 */

import { isFhrValueValid } from '../ble/quality-gate';
import type { FHRSample } from '../types';

export interface ImportResult {
  /** Parsed, quality-gated samples in chronological order. */
  samples: FHRSample[];
  /** Non-fatal skips (blank / comment / header). */
  skipped: number;
  /** Count of samples that failed the FHR_MIN..FHR_MAX gate. */
  invalid: number;
}

export class CtgParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'CtgParseError';
  }
}

/**
 * Parse a CTG CSV. Throws CtgParseError on any non-parseable data row so
 * malformed clinical exports surface loudly rather than producing
 * silently-skewed downstream analysis.
 *
 * Source is specified as 'hr' by default (matches clinical CTG single-value
 * reporting). Callers with RR-interval-derived data can post-process.
 */
export function importCtgCsv(
  csv: string,
  opts: { source?: 'hr' | 'rr' } = {},
): ImportResult {
  const source = opts.source ?? 'hr';
  const samples: FHRSample[] = [];
  let skipped = 0;
  let invalid = 0;

  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (line === '') {
      skipped += 1;
      continue;
    }
    if (line.startsWith('#')) {
      skipped += 1;
      continue;
    }
    // Header row detection: starts with non-numeric "timestamp"
    if (/^timestamp/i.test(line)) {
      skipped += 1;
      continue;
    }

    const parts = line.split(',');
    if (parts.length < 2) {
      throw new CtgParseError(
        `expected 'timestamp_ms,fhr_bpm', got: ${line}`,
        i + 1,
      );
    }
    const tRaw = parts[0]!.trim();
    const fhrRaw = parts[1]!.trim();
    const t = Number(tRaw);
    const fhr = Number(fhrRaw);
    if (!Number.isFinite(t)) {
      throw new CtgParseError(`non-numeric timestamp '${tRaw}'`, i + 1);
    }
    if (!Number.isFinite(fhr)) {
      throw new CtgParseError(`non-numeric fhr '${fhrRaw}'`, i + 1);
    }

    const valid = isFhrValueValid(fhr);
    if (!valid) invalid += 1;
    samples.push({ timestamp: t, fhr, source, valid });
  }

  // Chronological sort — clinical exports are usually sorted but the spec
  // doesn't require it, and downstream assumes sorted.
  samples.sort((a, b) => a.timestamp - b.timestamp);

  return { samples, skipped, invalid };
}
