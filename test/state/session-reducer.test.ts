import { sessionReducer, type ContractionEdit } from '../../src/state/session-reducer';
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

  describe('update-contraction', () => {
    function twoContractions(): ReturnType<typeof sessionReducer> {
      let s = sessionReducer(null, { type: 'start', id: 'a', at: 0 });
      s = sessionReducer(s, { type: 'add-contraction', response: ctx('c1', 30), at: 1 });
      s = sessionReducer(s, { type: 'add-contraction', response: ctx('c2', 32), at: 2 });
      return s;
    }

    test('applies an annotation edit to the addressed contraction only', () => {
      let s = twoContractions();
      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'c1',
        patch: { qualityGrade: 'poor', detectionConfidence: 0.4 },
        at: 3,
      });
      const [c1, c2] = s!.contractions;
      expect(c1!.qualityGrade).toBe('poor');
      expect(c1!.detectionConfidence).toBeCloseTo(0.4);
      expect(c2!.qualityGrade).toBe('good');
      expect(c2!.detectionConfidence).toBe(1);
    });

    test('leaves extracted measurements untouched', () => {
      let s = twoContractions();
      const before = { ...s!.contractions[0]! };
      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'c1',
        patch: { qualityGrade: 'fair' },
        at: 3,
      });
      const after = s!.contractions[0]!;
      expect(after.contractionPeakTime).toBe(before.contractionPeakTime);
      expect(after.baselineFHR).toBe(before.baselineFHR);
      expect(after.nadirDepth).toBe(before.nadirDepth);
      expect(after.nadirTiming).toBe(before.nadirTiming);
      expect(after.recoveryTime).toBe(before.recoveryTime);
      expect(after.responseArea).toBe(before.responseArea);
      expect(after.fhrQuality).toBe(before.fhrQuality);
    });

    test('ignores non-editable fields forced through an untyped caller', () => {
      let s = twoContractions();
      const before = { ...s!.contractions[0]! };
      // The ContractionEdit type rejects these at compile time; the reducer
      // must also drop them at runtime, so a cast or a JS caller can't
      // desynchronise a record from the samples it was measured from.
      const smuggled = {
        contractionPeakTime: 999,
        recoveryTime: 1,
        nadirDepth: -99,
        qualityGrade: 'poor',
      } as unknown as ContractionEdit;
      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'c1',
        patch: smuggled,
        at: 3,
      });
      const after = s!.contractions[0]!;
      expect(after.qualityGrade).toBe('poor'); // the allowed field applied
      expect(after.contractionPeakTime).toBe(before.contractionPeakTime);
      expect(after.recoveryTime).toBe(before.recoveryTime);
      expect(after.nadirDepth).toBe(before.nadirDepth);
      // Order is preserved because peak times cannot move.
      expect(s!.contractions.map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    test('clamps detectionConfidence into [0, 1]', () => {
      let s = twoContractions();
      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'c1',
        patch: { detectionConfidence: 5 },
        at: 3,
      });
      expect(s!.contractions[0]!.detectionConfidence).toBe(1);

      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'c1',
        patch: { detectionConfidence: -2 },
        at: 4,
      });
      expect(s!.contractions[0]!.detectionConfidence).toBe(0);

      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'c1',
        patch: { detectionConfidence: Number.NaN },
        at: 5,
      });
      expect(s!.contractions[0]!.detectionConfidence).toBe(0);
    });

    test('an unknown id is a no-op', () => {
      let s = twoContractions();
      const before = s!.contractions.map((c) => c.qualityGrade);
      s = sessionReducer(s, {
        type: 'update-contraction',
        id: 'nope',
        patch: { qualityGrade: 'poor' },
        at: 3,
      });
      expect(s!.contractions.map((c) => c.qualityGrade)).toEqual(before);
    });
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
