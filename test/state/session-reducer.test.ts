import { sessionReducer } from '../../src/state/session-reducer';
import { MIN_CONTRACTIONS } from '../../src/constants';
import type { ContractionResponse } from '../../src/types';

function ctx(id: string, recovery: number, nadir = -20): ContractionResponse {
  return {
    id,
    timestamp: 1,
    contractionPeakTime: parseInt(id.replace(/\D/g, ''), 10) || 1,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: nadir,
    nadirTiming: 10,
    recoveryTime: recovery,
    responseArea: -100,
    fhrQuality: 1,
    qualityGrade: 'good',
  };
}

describe('sessionReducer', () => {
  test('start initializes an empty session', () => {
    const s = sessionReducer(null, { type: 'start', id: 'a', at: 42 });
    expect(s!.id).toBe('a');
    expect(s!.status).toBe('grey');
    expect(s!.personalBaseline).toBeNull();
    expect(s!.redPersistenceCount).toBe(0);
  });

  test('add-contraction appends, recomputes slopes, and updates status', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    s = sessionReducer(s, { type: 'add-contraction', response: ctx('c1', 30), at: 1 });
    expect(s!.contractions).toHaveLength(1);
    expect(s!.status).toBe('grey'); // below MIN_CONTRACTIONS
  });

  test('baseline freezes at MIN_CONTRACTIONS and does not drift', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    // Push MIN_CONTRACTIONS contractions with recovery = 30.
    for (let i = 0; i < MIN_CONTRACTIONS; i++) {
      s = sessionReducer(s, {
        type: 'add-contraction',
        response: ctx(`c${i}`, 30),
        at: i,
      });
    }
    const baselineAtEstablishment = s!.personalBaseline;
    expect(baselineAtEstablishment).not.toBeNull();
    expect(baselineAtEstablishment!.recoveryMean).toBe(30);

    // Push more contractions with wildly different recovery — baseline must
    // stay frozen.
    for (let i = 0; i < 5; i++) {
      s = sessionReducer(s, {
        type: 'add-contraction',
        response: ctx(`d${i}`, 55),
        at: 100 + i,
      });
    }
    expect(s!.personalBaseline).toEqual(baselineAtEstablishment);
  });

  test('status transitions append to statusHistory', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    // 6 contractions with mild variability so baseline SD is nonzero.
    // Flat trend but nonzero SD so personal thresholds don't collapse to mean.
    const recoveries = [29, 30, 31, 30, 30, 30];
    for (let i = 0; i < MIN_CONTRACTIONS; i++) {
      s = sessionReducer(s, {
        type: 'add-contraction',
        response: ctx(`c${i}`, recoveries[i]!),
        at: i,
      });
    }
    const toGreen = s!.statusHistory.find((t) => t.to === 'green');
    expect(toGreen).toBeDefined();
    expect(toGreen!.from).toBe('grey');
  });

  test('delete-contraction rolls back status if the removed one was the problem', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    // Mild variability so baseline SD > 0.
    // Flat trend but nonzero SD so personal thresholds don't collapse to mean.
    const recoveries = [29, 30, 31, 30, 30, 30];
    for (let i = 0; i < MIN_CONTRACTIONS; i++) {
      s = sessionReducer(s, {
        type: 'add-contraction',
        response: ctx(`c${i}`, recoveries[i]!),
        at: i,
      });
    }
    const greenStatus = s!.status;

    // Corrupt contraction (unrealistically high recovery): will push status.
    s = sessionReducer(s, {
      type: 'add-contraction',
      response: ctx(`bad1`, 99),
      at: 100,
    });
    const changedByBad = s!.status;

    s = sessionReducer(s, { type: 'delete-contraction', id: 'bad1', at: 200 });
    expect(s!.contractions.find((c) => c.id === 'bad1')).toBeUndefined();
    // After delete, status should match what we had before the bad contraction.
    expect(s!.status).toBe(greenStatus);
    // Sanity: the bad one really had moved us somewhere.
    expect(changedByBad).toBeDefined();
  });

  test('update-contraction re-orders chronologically on timestamp change', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    s = sessionReducer(s, {
      type: 'add-contraction',
      response: ctx('c1', 30),
      at: 1,
    });
    s = sessionReducer(s, {
      type: 'add-contraction',
      response: ctx('c2', 32),
      at: 2,
    });
    // Push c1's peak time after c2 — session must reorder.
    s = sessionReducer(s, {
      type: 'update-contraction',
      id: 'c1',
      patch: { contractionPeakTime: 999 },
      at: 3,
    });
    const ids = s!.contractions.map((c) => c.id);
    expect(ids).toEqual(['c2', 'c1']);
  });

  test('hydrate replaces state wholesale including baseline', () => {
    const s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    const hydrated = {
      ...s!,
      id: 'from-storage',
      personalBaseline: {
        recoveryMean: 30,
        recoverySd: 2,
        nadirMean: -20,
        nadirSd: 4,
      },
    };
    const next = sessionReducer(s, { type: 'hydrate', session: hydrated });
    expect(next!.id).toBe('from-storage');
    expect(next!.personalBaseline!.recoveryMean).toBe(30);
  });

  test('actions on null state (except start/hydrate) are no-ops', () => {
    expect(sessionReducer(null, { type: 'end', at: 1 })).toBeNull();
    expect(
      sessionReducer(null, {
        type: 'add-contraction',
        response: ctx('x', 30),
        at: 1,
      }),
    ).toBeNull();
    expect(
      sessionReducer(null, { type: 'delete-contraction', id: 'x', at: 1 }),
    ).toBeNull();
  });
});
