import { sessionReducer } from '../../src/state/session-reducer';
import type { ContractionResponse } from '../../src/types';

function ctx(id: string, recovery: number): ContractionResponse {
  return {
    id,
    timestamp: 1,
    contractionPeakTime: 1,
    detectionMethod: 'manual',
    detectionConfidence: 1,
    baselineFHR: 140,
    nadirDepth: -20,
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
    expect(s).not.toBeNull();
    expect(s!.id).toBe('a');
    expect(s!.startTime).toBe(42);
    expect(s!.endTime).toBeNull();
    expect(s!.contractions).toEqual([]);
  });

  test('add-contraction appends and recomputes slopes from 2 contractions on', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    s = sessionReducer(s, { type: 'add-contraction', response: ctx('c1', 30) });
    expect(s!.contractions).toHaveLength(1);
    // Single contraction → slopes stay null.
    expect(s!.recoveryTrendSlope).toBeNull();

    s = sessionReducer(s, { type: 'add-contraction', response: ctx('c2', 32) });
    expect(s!.contractions).toHaveLength(2);
    expect(s!.recoveryTrendSlope).toBeCloseTo(2, 6);
  });

  test('end sets endTime', () => {
    let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    s = sessionReducer(s, { type: 'end', at: 100 });
    expect(s!.endTime).toBe(100);
  });

  test('hydrate replaces state wholesale', () => {
    const s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
    const hydrated = { ...s!, id: 'from-storage' };
    const next = sessionReducer(s, { type: 'hydrate', session: hydrated });
    expect(next!.id).toBe('from-storage');
  });

  test('actions on null state (except start/hydrate) are no-ops', () => {
    expect(sessionReducer(null, { type: 'end', at: 1 })).toBeNull();
    expect(
      sessionReducer(null, {
        type: 'add-contraction',
        response: ctx('x', 30),
      }),
    ).toBeNull();
  });
});
