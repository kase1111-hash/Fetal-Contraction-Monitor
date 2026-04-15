/**
 * Session reducer. Pure state transitions — UI-free so it stays testable.
 *
 * Supports Phase 1:
 *   - start/end session
 *   - add a ContractionResponse (re-computes trajectory slopes)
 *   - replace the full session (hydration after cold start)
 *
 * Alert logic, personal baseline, and contraction corrections land in Phase 2.
 */

import { computeTrajectoryFeatures } from '../trajectory/features';
import { emptySession } from '../storage/session-store';
import type { ContractionResponse, LaborSession } from '../types';

export type SessionAction =
  | { type: 'start'; id: string; at: number }
  | { type: 'end'; at: number }
  | { type: 'add-contraction'; response: ContractionResponse }
  | { type: 'hydrate'; session: LaborSession };

export type SessionState = LaborSession | null;

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case 'start':
      return emptySession(action.id, action.at);

    case 'end': {
      if (state === null) return state;
      return { ...state, endTime: action.at };
    }

    case 'hydrate':
      return action.session;

    case 'add-contraction': {
      if (state === null) return state;
      const contractions = [...state.contractions, action.response];
      const features = computeTrajectoryFeatures(contractions);
      return {
        ...state,
        contractions,
        recoveryTrendSlope:
          contractions.length >= 2 ? features.recoveryTrendSlope : null,
        nadirTrendSlope:
          contractions.length >= 2 ? features.nadirTrendSlope : null,
      };
    }
  }
}
