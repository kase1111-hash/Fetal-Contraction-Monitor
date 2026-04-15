/**
 * Session persistence tests. Covers SPEC.md §10:
 *   "Session auto-saves and survives app restart"
 */

import { MemoryKvStore } from '../../src/storage/kv';
import {
  SessionStore,
  emptySession,
  KEY_SESSION_CURRENT,
  KEY_SESSION_HISTORY,
} from '../../src/storage/session-store';
import type { ContractionResponse, LaborSession } from '../../src/types';

function ctx(id: string): ContractionResponse {
  return {
    id,
    timestamp: 1,
    contractionPeakTime: 2,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: -20,
    nadirTiming: 10,
    recoveryTime: 30,
    responseArea: -300,
    fhrQuality: 0.95,
    qualityGrade: 'good',
  };
}

describe('SessionStore', () => {
  test('saveCurrent + loadCurrent round-trips', async () => {
    const kv = new MemoryKvStore();
    const store = new SessionStore(kv);
    const s = emptySession('abc', 1_700_000_000_000);
    s.contractions.push(ctx('c1'), ctx('c2'));

    await store.saveCurrent(s);
    const loaded = await store.loadCurrent();

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('abc');
    expect(loaded!.contractions).toHaveLength(2);
  });

  test('loadCurrent returns null when nothing stored', async () => {
    const store = new SessionStore(new MemoryKvStore());
    expect(await store.loadCurrent()).toBeNull();
  });

  test('loadCurrent survives cold restart (fresh store, same KV)', async () => {
    const kv = new MemoryKvStore();
    const writer = new SessionStore(kv);
    await writer.saveCurrent(emptySession('xyz', 42));

    // Simulate cold restart: brand-new SessionStore reading the same KV.
    const reader = new SessionStore(kv);
    const loaded = await reader.loadCurrent();
    expect(loaded!.id).toBe('xyz');
    expect(loaded!.startTime).toBe(42);
  });

  test('corrupt JSON in current slot is cleared and returns null', async () => {
    const kv = new MemoryKvStore();
    await kv.setItem(KEY_SESSION_CURRENT, '{this is not json');
    const store = new SessionStore(kv);
    expect(await store.loadCurrent()).toBeNull();
    expect(await kv.getItem(KEY_SESSION_CURRENT)).toBeNull();
  });

  test('endSession moves to history and clears current', async () => {
    const kv = new MemoryKvStore();
    const store = new SessionStore(kv);
    const s = emptySession('a', 1);
    await store.saveCurrent(s);
    await store.endSession(s);

    expect(await store.loadCurrent()).toBeNull();
    const hist = await store.loadHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]!.id).toBe('a');
  });

  test('history is capped at MAX_SESSION_HISTORY, newest first', async () => {
    const kv = new MemoryKvStore();
    const store = new SessionStore(kv);
    for (let i = 0; i < 55; i++) {
      await store.endSession(emptySession(`s${i}`, i));
    }
    const hist = await store.loadHistory();
    expect(hist).toHaveLength(50);
    // Newest first — s54 was the last inserted.
    expect(hist[0]!.id).toBe('s54');
    // s4 should be the oldest retained (s0..s3 evicted).
    expect(hist[hist.length - 1]!.id).toBe('s5');
  });

  test('loadHistory returns [] when nothing stored', async () => {
    const store = new SessionStore(new MemoryKvStore());
    expect(await store.loadHistory()).toEqual([]);
  });

  test('loadHistory tolerates corrupt blob', async () => {
    const kv = new MemoryKvStore();
    await kv.setItem(KEY_SESSION_HISTORY, '!!!');
    const store = new SessionStore(kv);
    expect(await store.loadHistory()).toEqual([]);
  });

  test('clearAll removes both keys', async () => {
    const kv = new MemoryKvStore();
    const store = new SessionStore(kv);
    await store.saveCurrent(emptySession('a', 1));
    await store.endSession(emptySession('b', 2));
    await store.clearAll();
    expect(await kv.getItem(KEY_SESSION_CURRENT)).toBeNull();
    expect(await kv.getItem(KEY_SESSION_HISTORY)).toBeNull();
  });

  test('emptySession has expected initial shape', () => {
    const s: LaborSession = emptySession('id', 7);
    expect(s.id).toBe('id');
    expect(s.startTime).toBe(7);
    expect(s.endTime).toBeNull();
    expect(s.status).toBe('grey');
    expect(s.contractions).toEqual([]);
    expect(s.personalBaseline).toBeNull();
    expect(s.redPersistenceCount).toBe(0);
    expect(s.statusHistory).toEqual([]);
  });
});
