/**
 * Doppler client factory.
 *
 * The app talks to a `DopplerClient` (see doppler-client.ts). At runtime we
 * want the real BLE transport (`BleDoppler`) whenever the native module is
 * present, and a graceful fall back to `FakeDoppler` when it isn't — e.g.
 * running in Expo Go without a custom dev client, on web, or on a device with
 * Bluetooth turned off. Falling back means the rest of the app (scan → connect
 * → torus) still works end to end against synthetic FHR.
 *
 * `BleDoppler` is required lazily inside `defaultRealFactory` so unit tests
 * (node env) never pull in `react-native-ble-plx`.
 */

import { FakeDoppler, normalLaborFhr } from './fake-doppler';
import type { DopplerClient } from './doppler-client';

export interface CreateDopplerOptions {
  /** Force the fake client — used for the in-app "simulation" affordance. */
  forceFake?: boolean;
  /**
   * Factory for the real BLE client. Throws when the transport is
   * unavailable. Injectable for tests; defaults to a lazy `BleDoppler`.
   */
  realFactory?: () => DopplerClient;
  /** Factory for the fake client. Injectable for tests. */
  fakeFactory?: () => DopplerClient;
}

export interface CreateDopplerResult {
  client: DopplerClient;
  /** True when the real BLE transport is in use; false when faked. */
  isReal: boolean;
}

/**
 * Build a DopplerClient. Prefers the real BLE transport, falling back to the
 * fake when construction throws (native module missing / BLE unavailable).
 */
export function createDopplerClient(
  opts: CreateDopplerOptions = {},
): CreateDopplerResult {
  const makeFake =
    opts.fakeFactory ?? (() => new FakeDoppler({ generator: normalLaborFhr }));

  if (opts.forceFake === true) {
    return { client: makeFake(), isReal: false };
  }

  const makeReal = opts.realFactory ?? defaultRealFactory;
  try {
    return { client: makeReal(), isReal: true };
  } catch {
    // Native BLE unavailable — fall back so the app still runs.
    return { client: makeFake(), isReal: false };
  }
}

function defaultRealFactory(): DopplerClient {
  // Lazy require: keeps react-native-ble-plx out of the node test bundle and
  // lets the try/catch above handle a missing native module.
  const { BleDoppler } = require('./doppler') as typeof import('./doppler');
  return new BleDoppler();
}
