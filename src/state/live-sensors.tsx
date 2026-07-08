/**
 * LiveSensorsProvider — connects real hardware to the session.
 *
 * SessionProvider exposes `recordFhrSample` and `recordAccelSample` but never
 * calls them from a live source; simulation and manual taps are the only feeds
 * in the base build. This provider closes that gap:
 *
 *   - Owns a DopplerClient (real BLE, or FakeDoppler when BLE is unavailable)
 *     and pumps its FHR samples into `recordFhrSample`.
 *   - Optionally subscribes to the phone accelerometer (expo-sensors) and
 *     feeds `recordAccelSample` for automatic contraction detection.
 *
 * It sits *inside* SessionProvider (it calls useSession) and *outside* the
 * screens that drive pairing. All native imports are lazy / injectable so the
 * module stays importable in the node test environment.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  createDopplerClient,
  type CreateDopplerOptions,
  type CreateDopplerResult,
} from '../ble/make-doppler';
import {
  ACCEL_UPDATE_INTERVAL_MS,
  toRawAccelSample,
} from '../detection/accel-bridge';
import { useSession } from './session-context';
import type {
  ConnectionState,
  DiscoveredDevice,
} from '../ble/doppler-client';

export interface LiveSensorsValue {
  /** True when a real BLE transport is active; false when running faked. */
  bleAvailable: boolean;
  /** Current Doppler transport state. */
  connectionState: ConnectionState;
  /** True while a scan is in flight. */
  scanning: boolean;
  /** Devices found by the most recent scan. */
  devices: DiscoveredDevice[];
  /** Device id we are connected (or connecting) to, if any. */
  connectedId: string | null;

  /** Run a scan and populate `devices`. */
  scan(): Promise<void>;
  /** Connect to a discovered device and start streaming FHR. */
  connect(deviceId: string): Promise<void>;
  /** Disconnect the Doppler. */
  disconnect(): Promise<void>;

  /** Whether accelerometer contraction detection is running. */
  accelEnabled: boolean;
  /** Turn accelerometer detection on/off. */
  setAccelEnabled(on: boolean): void;
}

const Context = createContext<LiveSensorsValue | null>(null);

/** Minimal shape of the pieces of expo-sensors' Accelerometer we use. */
interface AccelerometerLike {
  setUpdateInterval(intervalMs: number): void;
  addListener(
    listener: (reading: { x: number; y: number; z: number }) => void,
  ): { remove(): void };
}

export interface LiveSensorsProviderProps {
  /** Override the client factory (tests / dev). */
  createClient?: (opts?: CreateDopplerOptions) => CreateDopplerResult;
  /** Force the fake Doppler transport. */
  forceFake?: boolean;
  /** Inject the accelerometer source (tests). Defaults to expo-sensors. */
  accelerometer?: AccelerometerLike | null;
  /** Injected clock — defaults to Date.now. */
  now?: () => number;
  children: React.ReactNode;
}

export function LiveSensorsProvider({
  createClient = createDopplerClient,
  forceFake,
  accelerometer,
  now,
  children,
}: LiveSensorsProviderProps): React.ReactElement {
  const { recordFhrSample, recordAccelSample } = useSession();

  // Keep the clock in a ref so its identity is stable across the frequent
  // re-renders driven by incoming FHR samples — otherwise the accelerometer
  // effect below would re-subscribe on every render.
  const clockRef = useRef<() => number>(now ?? (() => Date.now()));
  clockRef.current = now ?? clockRef.current;

  // Build the client once and keep it stable across renders.
  const created = useRef<CreateDopplerResult | null>(null);
  if (created.current === null) {
    created.current = createClient({ forceFake });
  }
  const client = created.current.client;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    client.state(),
  );
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [accelEnabled, setAccelEnabledState] = useState(false);

  // Doppler samples → session; transport state → local state.
  useEffect(() => {
    const offSample = client.onSample(recordFhrSample);
    const offState = client.onState(setConnectionState);
    return () => {
      offSample();
      offState();
    };
  }, [client, recordFhrSample]);

  // Disconnect the transport when the provider unmounts.
  useEffect(() => {
    return () => {
      void client.disconnect();
    };
  }, [client]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const found = await client.scan();
      setDevices(found);
    } finally {
      setScanning(false);
    }
  }, [client]);

  const connect = useCallback(
    async (deviceId: string) => {
      await client.connect(deviceId);
      setConnectedId(deviceId);
    },
    [client],
  );

  const disconnect = useCallback(async () => {
    await client.disconnect();
    setConnectedId(null);
  }, [client]);

  const setAccelEnabled = useCallback((on: boolean) => {
    setAccelEnabledState(on);
  }, []);

  // Accelerometer subscription — active only while enabled.
  useEffect(() => {
    if (!accelEnabled) return;

    const accel = accelerometer ?? loadAccelerometer();
    if (accel === null) return; // expo-sensors unavailable — no-op.

    accel.setUpdateInterval(ACCEL_UPDATE_INTERVAL_MS);
    const sub = accel.addListener((reading) => {
      recordAccelSample(toRawAccelSample(reading, clockRef.current()));
    });
    return () => sub.remove();
  }, [accelEnabled, accelerometer, recordAccelSample]);

  const value: LiveSensorsValue = {
    bleAvailable: created.current.isReal,
    connectionState,
    scanning,
    devices,
    connectedId,
    scan,
    connect,
    disconnect,
    accelEnabled,
    setAccelEnabled,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLiveSensors(): LiveSensorsValue {
  const ctx = useContext(Context);
  if (ctx === null) {
    throw new Error('useLiveSensors must be called inside a LiveSensorsProvider');
  }
  return ctx;
}

/**
 * Lazily load expo-sensors' Accelerometer. Returns null when the module isn't
 * available (web / node), so callers degrade to a no-op.
 */
function loadAccelerometer(): AccelerometerLike | null {
  try {
    const mod = require('expo-sensors') as typeof import('expo-sensors');
    return mod.Accelerometer as unknown as AccelerometerLike;
  } catch {
    return null;
  }
}
