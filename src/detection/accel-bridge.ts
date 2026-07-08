/**
 * Bridge between expo-sensors' Accelerometer and the AccelDetector.
 *
 * `expo-sensors` delivers readings as `{ x, y, z }` in g (gravity units) at a
 * rate set by `Accelerometer.setUpdateInterval`. The detector (accelerometer.ts)
 * consumes `RawAccelSample { t, z }` and downsamples to 4 Hz internally, so we
 * only need to stamp each reading with a capture time and forward the z-axis
 * (perpendicular to the screen — the abdomen-normal axis per SPEC.md §2.1).
 *
 * These helpers are pure so they can be unit-tested without the native module;
 * the subscription itself lives in state/live-sensors.tsx.
 */

import type { RawAccelSample } from './accelerometer';

/**
 * Accelerometer update interval in ms (≈20 Hz). Comfortably below the
 * detector's 250 ms (4 Hz) downsample bucket so every bucket sees several
 * samples, while staying light on battery.
 */
export const ACCEL_UPDATE_INTERVAL_MS = 50;

/** Shape of an expo-sensors Accelerometer reading. */
export interface AccelerometerReading {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert an expo-sensors reading plus its capture time (Unix ms) into the
 * detector's input sample.
 */
export function toRawAccelSample(
  reading: AccelerometerReading,
  t: number,
): RawAccelSample {
  return { t, z: reading.z };
}
