/**
 * Persistence for LaborSession.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §7 (lines 403–412).
 *
 *   7.1 Auto-save: current session every 30 s + after every new contraction.
 *   7.2 Session history: max 50; oldest dropped first.
 *   7.3 Export: handled separately.
 */

import { MAX_SESSION_HISTORY } from '../constants';
import type { KvStore } from './kv';
import type { LaborSession } from '../types';

export const KEY_SESSION_CURRENT = 'session_current';
export const KEY_SESSION_HISTORY = 'session_history';

export class SessionStore {
  constructor(private readonly kv: KvStore) {}

  /** Save the in-progress session. Called on every new contraction + on a 30 s timer. */
  async saveCurrent(session: LaborSession): Promise<void> {
    await this.kv.setItem(KEY_SESSION_CURRENT, JSON.stringify(session));
  }

  /** Hydrate the in-progress session on app start. Returns null if none. */
  async loadCurrent(): Promise<LaborSession | null> {
    const raw = await this.kv.getItem(KEY_SESSION_CURRENT);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as LaborSession;
    } catch {
      // Corrupt blob: drop it so the app can start fresh.
      await this.kv.removeItem(KEY_SESSION_CURRENT);
      return null;
    }
  }

  /** Move the current session into history and clear the current slot. */
  async endSession(session: LaborSession): Promise<void> {
    const history = await this.loadHistory();
    history.unshift(session);
    const trimmed = history.slice(0, MAX_SESSION_HISTORY);
    await this.kv.setItem(KEY_SESSION_HISTORY, JSON.stringify(trimmed));
    await this.kv.removeItem(KEY_SESSION_CURRENT);
  }

  async loadHistory(): Promise<LaborSession[]> {
    const raw = await this.kv.getItem(KEY_SESSION_HISTORY);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as LaborSession[]) : [];
    } catch {
      return [];
    }
  }

  async clearAll(): Promise<void> {
    await this.kv.removeItem(KEY_SESSION_CURRENT);
    await this.kv.removeItem(KEY_SESSION_HISTORY);
  }
}

/**
 * Construct an empty session with a stable starting shape.
 */
export function emptySession(id: string, startTime: number): LaborSession {
  return {
    id,
    startTime,
    endTime: null,
    contractions: [],
    status: 'grey',
    recoveryTrendSlope: null,
    nadirTrendSlope: null,
    personalBaseline: null,
    redPersistenceCount: 0,
    statusHistory: [],
  };
}
