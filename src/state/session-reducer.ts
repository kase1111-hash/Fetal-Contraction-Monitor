/**
 * Session reducer. Pure state transitions — UI-free so it stays testable.
 *
 * Phase 1:
 *   - start/end session
 *   - add a ContractionResponse (re-computes trajectory slopes)
 *   - replace the full session (hydration after cold start)
 *
 * Phase 2:
 *   - establish + freeze personal baseline after MIN_CONTRACTIONS
 *   - determine alert status (grey/green/yellow/red) after each contraction
 *   - track redPersistenceCount + statusHistory transitions
 *   - delete / adjust / insert contractions (user corrections)
 */

import { establishBaseline } from '../alerts/personal-baseline';
import { determineStatus } from '../alerts/status';
import { computeTrajectoryFeatures } from '../trajectory/features';
import { emptySession } from '../storage/session-store';
import type {
  AlertStatus,
  ContractionResponse,
  LaborSession,
} from '../types';

export type SessionAction =
  | { type: 'start'; id: string; at: number }
  | { type: 'end'; at: number }
  | { type: 'add-contraction'; response: ContractionResponse; at: number }
  | { type: 'delete-contraction'; id: string; at: number }
  | { type: 'update-contraction'; id: string; patch: Partial<ContractionResponse>; at: number }
  | { type: 'hydrate'; session: LaborSession };

export type SessionState = LaborSession | null;

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case 'start':
      return emptySession(action.id, action.at);

    case 'end':
      if (state === null) return state;
      return { ...state, endTime: action.at };

    case 'hydrate':
      return action.session;

    case 'add-contraction':
      if (state === null) return state;
      return recomputeSession(
        { ...state, contractions: [...state.contractions, action.response] },
        action.at,
      );

    case 'delete-contraction':
      if (state === null) return state;
      return recomputeSession(
        {
          ...state,
          contractions: state.contractions.filter((c) => c.id !== action.id),
        },
        action.at,
      );

    case 'update-contraction': {
      if (state === null) return state;
      const contractions = state.contractions
        .map((c) => (c.id === action.id ? { ...c, ...action.patch } : c))
        // If contractionPeakTime was adjusted, re-order so the session stays
        // chronological.
        .sort((a, b) => a.contractionPeakTime - b.contractionPeakTime);
      return recomputeSession({ ...state, contractions }, action.at);
    }
  }
}

/**
 * Recompute baseline (if not yet frozen), alert status, trend slopes, and
 * status history for a session whose contraction list just changed.
 *
 * The personal baseline is FROZEN once established (SPEC.md §5.3). The
 * reducer only establishes a baseline if `state.personalBaseline` is null.
 */
function recomputeSession(state: LaborSession, atMs: number): LaborSession {
  const contractions = state.contractions;
  const features = computeTrajectoryFeatures(contractions);

  // Baseline: establish once, never update.
  const personalBaseline =
    state.personalBaseline ?? establishBaseline(contractions);

  // Alert status.
  const result = determineStatus({
    features,
    baseline: personalBaseline,
    recentContractions: contractions,
    redPersistenceCount: state.redPersistenceCount,
  });

  // Status transition log.
  let statusHistory = state.statusHistory;
  if (result.status !== state.status) {
    statusHistory = [
      ...state.statusHistory,
      {
        from: state.status as AlertStatus,
        to: result.status,
        at: atMs,
        contractionIndex: contractions.length - 1,
      },
    ];
  }

  return {
    ...state,
    contractions,
    status: result.status,
    redPersistenceCount: result.redPersistenceCount,
    personalBaseline,
    recoveryTrendSlope: contractions.length >= 2 ? features.recoveryTrendSlope : null,
    nadirTrendSlope: contractions.length >= 2 ? features.nadirTrendSlope : null,
    statusHistory,
  };
}
