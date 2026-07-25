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
