/**
 * Session Context — wires together:
 *   - session state (sessionReducer)
 *   - FHR buffer (from the Doppler)
 *   - ContractionQueue (delayed extraction)
 *   - SessionStore (auto-save)
 *
 * Reference: CLAUDE.md §"Tech Stack" ("React Context + useReducer. No Redux.")
 * and SPEC.md §7.1 "auto-saves every 30 s and after every new contraction".
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { FhrBuffer } from '../ble/fhr-buffer';
import { AUTO_SAVE_INTERVAL_MS } from '../constants';
import { ContractionQueue } from './contraction-queue';
import { sessionReducer } from './session-reducer';
import { SessionStore, emptySession } from '../storage/session-store';
import { MemoryKvStore } from '../storage/kv';
import type { KvStore } from '../storage/kv';
import type {
  ContractionDetection,
  ContractionResponse,
  FHRSample,
  LaborSession,
} from '../types';

export interface SessionContextValue {
  session: LaborSession | null;
  latestSample: FHRSample | null;
  pendingCount: number;

  startSession(): void;
  endSession(): Promise<void>;
  recordDetection(detection: ContractionDetection): void;
  recordFhrSample(sample: FHRSample): void;
}

const Context = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  /** Override for tests / non-RN environments. Defaults to MemoryKvStore. */
  kv?: KvStore;
  /** Deterministic id generator for tests. */
  newId?: () => string;
  /** Deterministic clock for tests. */
  now?: () => number;
  children: React.ReactNode;
}

export function SessionProvider({
  kv,
  newId,
  now,
  children,
}: SessionProviderProps): React.ReactElement {
  const clock = now ?? (() => Date.now());
  const idGen = newId ?? (() => `sess-${clock()}-${Math.floor(Math.random() * 1e6)}`);

  const store = useMemo(() => new SessionStore(kv ?? new MemoryKvStore()), [kv]);
  const buffer = useRef(new FhrBuffer());
  const queue = useRef(new ContractionQueue());

  const [session, dispatch] = useReducer(sessionReducer, null);
  const [latestSample, setLatestSample] = useState<FHRSample | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Hydrate on mount.
  useEffect(() => {
    (async () => {
      const loaded = await store.loadCurrent();
      if (loaded !== null) {
        dispatch({ type: 'hydrate', session: loaded });
      }
    })();
  }, [store]);

  // 30 s auto-save.
  useEffect(() => {
    if (session === null) return;
    const h = setInterval(() => {
      void store.saveCurrent(session);
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(h);
  }, [session, store]);

  // Drain the extraction queue once per second.
  useEffect(() => {
    const h = setInterval(() => {
      const r = queue.current.tick(clock(), buffer.current.all());
      if (r.extracted.length > 0) {
        for (const resp of r.extracted) {
          dispatch({ type: 'add-contraction', response: resp });
        }
        // Fire-and-forget save — state will update before the next tick.
        // Note: `session` here is from closure and may be stale; the 30s
        // periodic save will catch up.
      }
      setPendingCount(queue.current.size());
    }, 1_000);
    return () => clearInterval(h);
  }, []);

  const startSession = useCallback(() => {
    dispatch({ type: 'start', id: idGen(), at: clock() });
    buffer.current.clear();
    queue.current.clear();
  }, [idGen, clock]);

  const endSession = useCallback(async () => {
    if (session === null) return;
    const ended: LaborSession = { ...session, endTime: clock() };
    await store.endSession(ended);
    dispatch({ type: 'end', at: clock() });
  }, [session, store, clock]);

  const recordDetection = useCallback((d: ContractionDetection) => {
    queue.current.enqueue(d);
    setPendingCount(queue.current.size());
  }, []);

  const recordFhrSample = useCallback((s: FHRSample) => {
    buffer.current.push(s);
    setLatestSample(s);
  }, []);

  // Save-after-add. Use an effect on contraction count so we persist once
  // every time a new contraction lands.
  const count = session?.contractions.length ?? 0;
  useEffect(() => {
    if (session === null) return;
    void store.saveCurrent(session);
  }, [count, session, store]);

  const value: SessionContextValue = {
    session,
    latestSample,
    pendingCount,
    startSession,
    endSession,
    recordDetection,
    recordFhrSample,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(Context);
  if (ctx === null) {
    throw new Error('useSession must be called inside a SessionProvider');
  }
  return ctx;
}
