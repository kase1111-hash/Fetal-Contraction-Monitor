/**
 * Contraction extraction queue.
 *
 * When a contraction is detected, we must wait RESPONSE_WINDOW seconds for the
 * full FHR response to develop before extracting features (SPEC.md §3 "Trigger").
 * This helper holds pending detections and exposes a `tick(nowMs, samples)`
 * method that extracts any detections whose response window has completed.
 */

import { RESPONSE_WINDOW } from '../constants';
import { extractResponse } from '../extraction/extract-response';
import type {
  ContractionDetection,
  ContractionResponse,
  FHRSample,
} from '../types';

export interface QueueTickResult {
  extracted: ContractionResponse[];
  rejected: Array<{ detection: ContractionDetection; reason: string }>;
}

export class ContractionQueue {
  private pending: ContractionDetection[] = [];
  /** Monotonically increasing counter for unique contraction ids. */
  private counter = 0;

  enqueue(detection: ContractionDetection): void {
    this.pending.push(detection);
  }

  size(): number {
    return this.pending.length;
  }

  /** Pending detections, oldest first. */
  peek(): readonly ContractionDetection[] {
    return this.pending;
  }

  /**
   * Process any detections whose response windows have closed.
   * Returns extracted responses + rejections in a single tick.
   */
  tick(nowMs: number, samples: readonly FHRSample[]): QueueTickResult {
    const result: QueueTickResult = { extracted: [], rejected: [] };
    const remaining: ContractionDetection[] = [];
    for (const d of this.pending) {
      const ready = nowMs >= d.peakTimestamp + RESPONSE_WINDOW * 1000;
      if (!ready) {
        remaining.push(d);
        continue;
      }
      const id = this.nextId(d);
      const r = extractResponse({ detection: d, samples, id });
      if (r.ok) {
        result.extracted.push(r.response);
      } else {
        result.rejected.push({ detection: d, reason: r.reason });
      }
    }
    this.pending = remaining;
    return result;
  }

  private nextId(d: ContractionDetection): string {
    this.counter += 1;
    return `ctx-${d.peakTimestamp}-${this.counter}`;
  }

  clear(): void {
    this.pending = [];
    this.counter = 0;
  }
}
