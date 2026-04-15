/**
 * FakeDoppler — a DopplerClient that emits synthetic FHR samples on a timer.
 *
 * Used for:
 *  - Development without hardware
 *  - The Simulation Mode feature (SPEC.md §8) — three labor scenarios
 *  - Unit/integration tests of the extraction + torus pipeline
 *
 * The generator is injected: callers pass a `generator(nowMs) => number` that
 * returns the FHR to emit at the given timestamp. The built-in normalLaborFhr
 * generator produces a mildly variable baseline.
 */

import { makeSample } from './quality-gate';
import type {
  ConnectionState,
  DiscoveredDevice,
  DopplerClient,
} from './doppler-client';
import type { FHRSample } from '../types';

export type FhrGenerator = (timestampMs: number) => number;

/** Simple baseline generator: 140 bpm ±3 sinusoidal variability. */
export const normalLaborFhr: FhrGenerator = (t) => {
  const secs = t / 1000;
  return 140 + 3 * Math.sin(secs * 0.4) + 2 * Math.sin(secs * 1.3);
};

export interface FakeDopplerOptions {
  /** FHR generator — defaults to normalLaborFhr. */
  generator?: FhrGenerator;
  /** Emission rate in Hz. Default 2 Hz (typical for consumer Dopplers). */
  rateHz?: number;
  /** Starting timestamp. Defaults to Date.now(). */
  startMs?: number;
  /** Timing source — injected so tests can drive deterministic time. */
  now?: () => number;
  /** Scheduler — injected for tests. */
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export class FakeDoppler implements DopplerClient {
  private readonly generator: FhrGenerator;
  private readonly rateHz: number;
  private readonly now: () => number;
  private readonly sched: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly unsched: (h: ReturnType<typeof setInterval>) => void;

  private _state: ConnectionState = 'idle';
  private handle: ReturnType<typeof setInterval> | null = null;
  private sampleHandlers: Array<(s: FHRSample) => void> = [];
  private stateHandlers: Array<(s: ConnectionState) => void> = [];

  constructor(opts: FakeDopplerOptions = {}) {
    this.generator = opts.generator ?? normalLaborFhr;
    this.rateHz = opts.rateHz ?? 2;
    this.now = opts.now ?? (() => Date.now());
    this.sched = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.unsched = opts.clearInterval ?? ((h) => clearInterval(h));
  }

  async scan(): Promise<DiscoveredDevice[]> {
    this.setState('scanning');
    const devs: DiscoveredDevice[] = [
      { id: 'fake-doppler-0', name: 'Fake Doppler', rssi: -45 },
    ];
    this.setState('idle');
    return devs;
  }

  async connect(_deviceId: string): Promise<void> {
    this.setState('connecting');
    this.setState('connected');
    const intervalMs = Math.max(1, Math.round(1000 / this.rateHz));
    this.handle = this.sched(() => this.emit(), intervalMs);
  }

  async disconnect(): Promise<void> {
    if (this.handle !== null) {
      this.unsched(this.handle);
      this.handle = null;
    }
    this.setState('disconnected');
  }

  state(): ConnectionState {
    return this._state;
  }

  onSample(handler: (sample: FHRSample) => void): () => void {
    this.sampleHandlers.push(handler);
    return () => {
      this.sampleHandlers = this.sampleHandlers.filter((h) => h !== handler);
    };
  }

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  /** Public so tests can drive emission manually without a scheduler. */
  emit(): void {
    const ts = this.now();
    const fhr = this.generator(ts);
    const sample = makeSample(fhr, ts, 'hr');
    for (const h of this.sampleHandlers) h(sample);
  }

  private setState(s: ConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    for (const h of this.stateHandlers) h(s);
  }
}
