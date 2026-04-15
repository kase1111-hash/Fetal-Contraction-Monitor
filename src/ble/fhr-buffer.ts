/**
 * FHR ring buffer — keeps the most recent FHR_BUFFER_SECONDS of samples.
 *
 * Reference: SPEC.md §1.2 "Store the last 120 seconds of FHR samples in a
 * ring buffer for baseline computation and response extraction" (line 57).
 *
 * Design:
 *  - Backed by a plain array; trimmed by timestamp, not by index.
 *    This makes the buffer robust to irregular sample rates (1–4 Hz BLE streams
 *    plus reconnect gaps).
 *  - Emits a `gap` signal when two consecutive pushes are more than
 *    FHR_GAP_THRESHOLD apart, so the connection layer can log reconnection
 *    events without resetting the session.
 */

import { FHR_BUFFER_SECONDS } from '../constants';
import { isGap } from './quality-gate';
import type { FHRSample } from '../types';

export interface FhrBufferEvents {
  /** Fired when a new push is more than FHR_GAP_THRESHOLD seconds after the previous sample. */
  onGap?: (gapSeconds: number, atMs: number) => void;
}

export class FhrBuffer {
  private samples: FHRSample[] = [];
  private readonly events: FhrBufferEvents;

  constructor(events: FhrBufferEvents = {}) {
    this.events = events;
  }

  /** Append a sample and evict anything older than FHR_BUFFER_SECONDS. */
  push(sample: FHRSample): void {
    const prev = this.samples.length > 0 ? this.samples[this.samples.length - 1]! : null;
    if (prev !== null && isGap(prev, sample)) {
      const gapSeconds = (sample.timestamp - prev.timestamp) / 1000;
      this.events.onGap?.(gapSeconds, sample.timestamp);
    }
    this.samples.push(sample);
    this.trim(sample.timestamp);
  }

  /** Evict samples older than (latestTimestamp − FHR_BUFFER_SECONDS). */
  private trim(latestMs: number): void {
    const cutoff = latestMs - FHR_BUFFER_SECONDS * 1000;
    // Linear scan from the start is fine: buffer rarely exceeds a few hundred samples.
    let firstKeep = 0;
    while (firstKeep < this.samples.length && this.samples[firstKeep]!.timestamp < cutoff) {
      firstKeep++;
    }
    if (firstKeep > 0) {
      this.samples = this.samples.slice(firstKeep);
    }
  }

  /** All retained samples, oldest-first. */
  all(): readonly FHRSample[] {
    return this.samples;
  }

  /** Samples whose timestamps fall in [fromMs, toMs]. */
  slice(fromMs: number, toMs: number): FHRSample[] {
    const out: FHRSample[] = [];
    for (const s of this.samples) {
      if (s.timestamp < fromMs) continue;
      if (s.timestamp > toMs) break;
      out.push(s);
    }
    return out;
  }

  /** Most recent valid sample, or null. */
  latestValid(): FHRSample | null {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i]!;
      if (s.valid) return s;
    }
    return null;
  }

  size(): number {
    return this.samples.length;
  }

  clear(): void {
    this.samples = [];
  }
}
