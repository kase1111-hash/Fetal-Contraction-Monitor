/**
 * SessionProvider integration tests.
 *
 * These exercise the provider the way the *live app* uses it — no injected
 * clock, FHR arriving continuously from a Doppler — which is the one
 * configuration the pure-function unit tests never cover.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  SessionProvider,
  useSession,
  type SessionContextValue,
} from '../../src/state/session-context';
import { makeSample } from '../../src/ble/quality-gate';
import { MemoryKvStore } from '../../src/storage/kv';
import {
  SessionStore,
  KEY_SESSION_CURRENT,
} from '../../src/storage/session-store';

let api: SessionContextValue;

function Probe(): null {
  api = useSession();
  return null;
}

function mount(kv: MemoryKvStore): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SessionProvider kv={kv}>
        <Probe />
      </SessionProvider>,
    );
  });
  return renderer;
}

/** Advance fake time by `ms`, delivering an FHR sample at the end of the step. */
function step(ms: number, fhr: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
    api.recordFhrSample(makeSample(fhr, Date.now(), 'hr'));
  });
}

describe('SessionProvider — live Doppler stream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('extracts a contraction while FHR streams at 2 Hz', () => {
    const kv = new MemoryKvStore();
    const renderer = mount(kv);

    act(() => api.startSession());

    const t0 = Date.now();
    // 40 s of baseline at 2 Hz (the FakeDoppler's default rate).
    while (Date.now() < t0 + 40_000) step(500, 140);

    const peak = Date.now();
    act(() => {
      api.recordDetection({ peakTimestamp: peak, method: 'manual', confidence: 1 });
    });
    expect(api.pendingCount).toBe(1);

    // 70 s of response — past the 60 s RESPONSE_WINDOW, so the queue must drain.
    while (Date.now() < peak + 70_000) step(500, 140);

    expect(api.session?.contractions).toHaveLength(1);
    expect(api.pendingCount).toBe(0);

    act(() => renderer.unmount());
  });
});

describe('SessionProvider — inserting a missed contraction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('extracts features from the buffer rather than inventing them', () => {
    const renderer = mount(new MemoryKvStore());
    act(() => api.startSession());

    const t0 = Date.now();
    // 40 s of baseline, then a dip, then recovery — all still inside the
    // 120 s ring buffer when we go back and mark the peak.
    const peak = t0 + 40_000;
    while (Date.now() < t0 + 110_000) {
      const dt = (Date.now() - peak) / 1000;
      const dip = dt >= 0 && dt < 20 ? -25 : 0;
      step(500, 140 + dip);
    }

    act(() => api.insertContractionAt(peak));
    expect(api.pendingCount).toBe(1);

    // The response window closed long ago, so the next drain extracts it.
    step(500, 140);
    step(500, 140);

    expect(api.session?.contractions).toHaveLength(1);
    const c = api.session!.contractions[0]!;
    expect(c.contractionPeakTime).toBe(peak);
    expect(c.detectionMethod).toBe('manual');
    // Measured, not fabricated: the dip we fed in is what comes back.
    expect(c.baselineFHR).toBeCloseTo(140, 0);
    expect(c.nadirDepth).toBeLessThan(-20);
    expect(c.recoveryTime).toBeGreaterThan(0);

    act(() => renderer.unmount());
  });

  test('records nothing when the chosen time has aged out of the buffer', () => {
    const renderer = mount(new MemoryKvStore());
    act(() => api.startSession());

    const t0 = Date.now();
    while (Date.now() < t0 + 40_000) step(500, 140);

    // Well outside the 120 s buffer — there are no samples to measure.
    act(() => api.insertContractionAt(t0 - 200_000));
    expect(api.pendingCount).toBe(1);

    step(500, 140);
    step(500, 140);

    expect(api.session?.contractions ?? []).toHaveLength(0);
    expect(api.pendingCount).toBe(0); // dropped, not stuck pending

    act(() => renderer.unmount());
  });
});

describe('SessionProvider — ending a session', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('endSession clears the current-session slot and does not resurrect it', async () => {
    const kv = new MemoryKvStore();
    const renderer = mount(kv);

    act(() => api.startSession());
    // Let the save-after-change effect land.
    await act(async () => {});
    expect(await kv.getItem(KEY_SESSION_CURRENT)).not.toBeNull();

    await act(async () => {
      await api.endSession();
    });
    // Give any trailing effects a chance to write.
    await act(async () => {});

    expect(await kv.getItem(KEY_SESSION_CURRENT)).toBeNull();

    const store = new SessionStore(kv);
    expect(await store.loadHistory()).toHaveLength(1);

    act(() => renderer.unmount());
  });
});
