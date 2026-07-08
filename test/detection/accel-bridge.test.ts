import {
  ACCEL_UPDATE_INTERVAL_MS,
  toRawAccelSample,
} from '../../src/detection/accel-bridge';
import { AccelDetector } from '../../src/detection/accelerometer';

describe('accel-bridge', () => {
  test('maps expo-sensors reading to the detector sample (z-axis + time)', () => {
    const s = toRawAccelSample({ x: 0.1, y: -0.2, z: 0.98 }, 1_700_000_000_000);
    expect(s).toEqual({ t: 1_700_000_000_000, z: 0.98 });
  });

  test('update interval is fast enough to feed the 4 Hz (250 ms) downsampler', () => {
    expect(ACCEL_UPDATE_INTERVAL_MS).toBeGreaterThan(0);
    // At least one reading per 250 ms downsample bucket.
    expect(ACCEL_UPDATE_INTERVAL_MS).toBeLessThanOrEqual(250);
  });

  test('bridged samples are consumable by AccelDetector without error', () => {
    const det = new AccelDetector();
    // Feed a minute of flat readings via the bridge; should not throw and
    // should produce no spurious detections on a constant signal.
    let emitted = 0;
    for (let i = 0; i < 60_000 / ACCEL_UPDATE_INTERVAL_MS; i++) {
      const t = 1_700_000_000_000 + i * ACCEL_UPDATE_INTERVAL_MS;
      emitted += det.push(toRawAccelSample({ x: 0, y: 0, z: 1 }, t)).length;
    }
    emitted += det.finalize().length;
    expect(emitted).toBe(0);
  });
});
