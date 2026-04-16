/**
 * Raw-capture buffer for study mode.
 *
 * Normal operation discards raw FHR samples once the response window has
 * closed — only the extracted features persist on ContractionResponse.
 * That's fine for normal app use but insufficient for a
 * consumer-vs-clinical equivalence study, which needs byte-for-byte
 * reproducibility of the input stream.
 *
 * StudyRecorder retains every sample, every raw detection, and every
 * accelerometer reading for a labeled stream (e.g. "consumer-doppler",
 * "clinical-ctg"). The captured data can be exported as CSV, compared
 * against another stream via `src/study/equivalence.ts`, or shipped to
 * an offline analysis pipeline.
 *
 * Phase 4: README roadmap "Consumer-vs-clinical equivalence study".
 */

import type { ContractionDetection, FHRSample } from '../types';

export type StreamLabel = 'consumer-doppler' | 'clinical-ctg' | string;

export interface CapturedStream {
  /** Stream identifier ("consumer-doppler", "clinical-ctg", …). */
  label: StreamLabel;
  /** Unix ms at which capture began. */
  startedAt: number;
  /** Every FHR sample received on this stream, in chronological order. */
  samples: FHRSample[];
  /** Every contraction detection emitted on this stream. */
  detections: ContractionDetection[];
}

export class StudyRecorder {
  private readonly streams = new Map<StreamLabel, CapturedStream>();

  /** Start capturing a stream. If already started, this is a no-op. */
  open(label: StreamLabel, startedAt: number): void {
    if (this.streams.has(label)) return;
    this.streams.set(label, {
      label,
      startedAt,
      samples: [],
      detections: [],
    });
  }

  /** Append an FHR sample. Silently drops if the stream isn't open. */
  sample(label: StreamLabel, s: FHRSample): void {
    const stream = this.streams.get(label);
    if (stream === undefined) return;
    stream.samples.push(s);
  }

  /** Append a detection. */
  detect(label: StreamLabel, d: ContractionDetection): void {
    const stream = this.streams.get(label);
    if (stream === undefined) return;
    stream.detections.push(d);
  }

  /** Snapshot of a single stream, or null if not opened. */
  stream(label: StreamLabel): CapturedStream | null {
    return this.streams.get(label) ?? null;
  }

  /** Snapshot of all captured streams, sorted by label. */
  all(): CapturedStream[] {
    return Array.from(this.streams.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  /** Labels of all currently-open streams, sorted. */
  labels(): StreamLabel[] {
    return Array.from(this.streams.keys()).sort();
  }

  /** Drop all captured data. */
  clear(): void {
    this.streams.clear();
  }
}

/**
 * Serialize a captured stream to two-column FHR CSV suitable for offline
 * analysis and for re-import via importCtgCsv (symmetric roundtrip).
 *
 * Columns: timestamp_ms, fhr_bpm
 * Invalid (quality-gated) samples are emitted too — the downstream reader
 * owns revalidation. Non-finite values are skipped.
 */
export function streamToFhrCsv(stream: CapturedStream): string {
  const rows: string[] = ['timestamp_ms,fhr_bpm'];
  for (const s of stream.samples) {
    if (!Number.isFinite(s.fhr)) continue;
    rows.push(`${s.timestamp},${s.fhr}`);
  }
  return rows.join('\n') + '\n';
}
