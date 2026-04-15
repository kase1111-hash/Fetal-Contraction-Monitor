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
import { AccelDetector, type RawAccelSample } from '../detection/accelerometer';
import { MERGE_WINDOW_S, applyFhrConfirmation } from '../detection/fusion';
import { AUTO_SAVE_INTERVAL_MS } from '../constants';
import { ContractionQueue } from './contraction-queue';
import { sessionReducer } from './session-reducer';
import { SessionStore } from '../storage/session-store';
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
  /** Feed a raw accelerometer sample into the detection pipeline. */
  recordAccelSample(sample: RawAccelSample): void;

  /** Remove a contraction from the session (user correction). */
  deleteContraction(id: string): void;
  /** Edit a contraction — adjust peak time, quality, etc. */
  updateContraction(id: string, patch: Partial<ContractionResponse>): void;
  /** Insert a manual contraction at a user-chosen time (long-press timeline). */
  insertContractionAt(peakMs: number): void;

  /** Load completed sessions from storage. Returns newest-first. */
  loadHistory(): Promise<LaborSession[]>;
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
  const accelDetector = useRef(new AccelDetector());
  /** Timestamps of recent manual detections, for fusion against accel. */
  const manualPeaks = useRef<number[]>([]);

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

  // Drain the extraction queue once per second. Applies FHR confirmation to
  // accel-sourced responses right after extraction.
  useEffect(() => {
    const h = setInterval(() => {
      const r = queue.current.tick(clock(), buffer.current.all());
      if (r.extracted.length > 0) {
        for (const raw of r.extracted) {
          const resp = raw.detectionMethod === 'accelerometer'
            ? withFhrConfirmation(raw)
            : raw;
          dispatch({ type: 'add-contraction', response: resp, at: clock() });
        }
      }
      setPendingCount(queue.current.size());
    }, 1_000);
    return () => clearInterval(h);
  }, [clock]);

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
    if (d.method === 'manual') {
      manualPeaks.current.push(d.peakTimestamp);
      // Keep only recent peaks (last 10 min).
      manualPeaks.current = manualPeaks.current.filter(
        (t) => t > clock() - 10 * 60 * 1000,
      );
    }
    queue.current.enqueue(d);
    setPendingCount(queue.current.size());
  }, [clock]);

  const recordAccelSample = useCallback((s: RawAccelSample) => {
    const detections = accelDetector.current.push(s);
    for (const d of detections) {
      // Fusion: drop accel detections that fall within MERGE_WINDOW_S of a
      // manual tap (the manual wins at conf=1).
      const mergedWithManual = manualPeaks.current.some(
        (mt) => Math.abs(mt - d.peakTimestamp) / 1000 <= MERGE_WINDOW_S,
      );
      if (mergedWithManual) continue;
      queue.current.enqueue(d);
    }
    if (detections.length > 0) setPendingCount(queue.current.size());
  }, []);

  const recordFhrSample = useCallback((s: FHRSample) => {
    buffer.current.push(s);
    setLatestSample(s);
  }, []);

  const deleteContraction = useCallback((id: string) => {
    dispatch({ type: 'delete-contraction', id, at: clock() });
  }, [clock]);

  const updateContraction = useCallback(
    (id: string, patch: Partial<ContractionResponse>) => {
      dispatch({ type: 'update-contraction', id, patch, at: clock() });
    },
    [clock],
  );

  const loadHistory = useCallback(async () => {
    return store.loadHistory();
  }, [store]);

  const insertContractionAt = useCallback(
    (peakMs: number) => {
      // Manual insert: enqueue as a manual detection at the chosen time.
      // The ContractionQueue will extract it like any other detection.
      queue.current.enqueue({
        peakTimestamp: peakMs,
        method: 'manual',
        confidence: 1,
      });
      setPendingCount(queue.current.size());
    },
    [],
  );

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
    recordAccelSample,
    deleteContraction,
    updateContraction,
    insertContractionAt,
    loadHistory,
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

/**
 * Apply FHR confirmation to an accelerometer-sourced ContractionResponse.
 * Updates `detectionConfidence` in place on a copy — the response keeps its
 * own extracted features unchanged. See detection/fusion.ts.
 */
function withFhrConfirmation(response: ContractionResponse): ContractionResponse {
  const adjusted = applyFhrConfirmation(
    {
      peakTimestamp: response.contractionPeakTime,
      method: 'accelerometer',
      confidence: response.detectionConfidence,
      fhrConfirmed: false,
    },
    response,
  );
  return { ...response, detectionConfidence: adjusted.confidence };
}
