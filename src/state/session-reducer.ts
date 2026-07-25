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

/**
 * The subset of a ContractionResponse a user correction may change.
 *
 * Deliberately excludes every extracted measurement — baselineFHR, nadirDepth,
 * nadirTiming, recoveryTime, responseArea, fhrQuality — and `contractionPeakTime`,
 * the instant they were all measured against. Those come from FHR samples that
 * only live in the 120 s ring buffer: once they age out there is no way to
 * recompute them, so patching the peak time would leave the measurements
 * describing a window that no longer matches the record, with nothing marking
 * them as edited. In a session that gets exported to a provider, a hand-moved
 * value must never be indistinguishable from a measured one.
 *
 * Adjusting a contraction's timing therefore means re-extracting against the
 * live buffer, which is a SessionProvider concern (it owns the buffer), not a
 * reducer one. The drag-to-adjust timeline UI is deferred — see the note in
 * display/ContractionLog.tsx. When it lands it must re-extract, and refuse the
 * edit when the samples have already aged out.
 */
export type ContractionEdit = Partial<
  Pick<ContractionResponse, 'detectionConfidence' | 'qualityGrade'>
>;

export type SessionAction =
  | { type: 'start'; id: string; at: number }
  | { type: 'end'; at: number }
  | { type: 'add-contraction'; response: ContractionResponse; at: number }
  | { type: 'delete-contraction'; id: string; at: number }
  | { type: 'update-contraction'; id: string; patch: ContractionEdit; at: number }
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
      const contractions = state.contractions.map((c) =>
        c.id === action.id ? applyEdit(c, action.patch) : c,
      );
      // No re-sort: `ContractionEdit` cannot move `contractionPeakTime`, so the
      // list stays chronological by construction.
      return recomputeSession({ ...state, contractions }, action.at);
    }
  }
}

/**
 * Apply a user correction, field by field.
 *
 * Enumerated rather than spread so the whitelist holds at runtime too — a
 * caller reaching the reducer through an untyped path (a JS consumer, a cast,
 * a rehydrated action) cannot slip an extracted measurement past the
 * `ContractionEdit` type and silently desynchronise the record.
 */
function applyEdit(
  c: ContractionResponse,
  patch: ContractionEdit,
): ContractionResponse {
  return {
    ...c,
    detectionConfidence:
      patch.detectionConfidence === undefined
        ? c.detectionConfidence
        : clamp01(patch.detectionConfidence),
    qualityGrade: patch.qualityGrade ?? c.qualityGrade,
  };
}

/** Confidence is a 0–1 probability and is rendered as a percentage. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
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
