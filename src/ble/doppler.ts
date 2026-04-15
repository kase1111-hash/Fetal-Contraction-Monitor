/**
 * Real BLE Doppler client — thin wrapper around react-native-ble-plx.
 *
 * References:
 *  - SPEC.md §1.1 "Doppler Connection" (scan/connect/subscribe flow)
 *  - SPEC.md §1.1 "Reconnection" (5 s retry, 2 min ceiling, no session reset)
 *
 * The wrapper implements DopplerClient so the rest of the app is agnostic to
 * whether it's running against a real device or FakeDoppler.
 *
 * This module only compiles when react-native-ble-plx is installed and the
 * app is running inside the Expo / React Native runtime — it is not imported
 * by unit tests.
 */

import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

import { makeSample } from './quality-gate';
import { parseHrm, deriveIntervalFromHr } from './parse-hrm';
import type {
  ConnectionState,
  DiscoveredDevice,
  DopplerClient,
} from './doppler-client';
import type { FHRSample } from '../types';

const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

/** Reconnection policy from SPEC.md §1.1. */
const RECONNECT_INTERVAL_MS = 5_000;
const RECONNECT_CEILING_MS = 2 * 60 * 1000;

export class BleDoppler implements DopplerClient {
  private readonly manager: BleManager;
  private device: Device | null = null;
  private notifSub: Subscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectStartedAt: number | null = null;

  private _state: ConnectionState = 'idle';
  private sampleHandlers: Array<(s: FHRSample) => void> = [];
  private stateHandlers: Array<(s: ConnectionState) => void> = [];

  constructor(manager?: BleManager) {
    this.manager = manager ?? new BleManager();
  }

  async scan(timeoutMs = 8000): Promise<DiscoveredDevice[]> {
    this.setState('scanning');
    const found = new Map<string, DiscoveredDevice>();
    return new Promise((resolve) => {
      this.manager.startDeviceScan([HEART_RATE_SERVICE_UUID], null, (err, dev) => {
        if (err || !dev) return;
        found.set(dev.id, { id: dev.id, name: dev.name, rssi: dev.rssi });
      });
      setTimeout(() => {
        this.manager.stopDeviceScan();
        this.setState('idle');
        resolve(Array.from(found.values()));
      }, timeoutMs);
    });
  }

  async connect(deviceId: string): Promise<void> {
    this.setState('connecting');
    const device = await this.manager.connectToDevice(deviceId);
    await device.discoverAllServicesAndCharacteristics();
    this.device = device;
    this.subscribeToNotifications();
    this.watchForDisconnect();
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.notifSub?.remove();
    this.notifSub = null;
    if (this.device) {
      try {
        await this.device.cancelConnection();
      } catch {
        /* ignore — already disconnected */
      }
    }
    this.device = null;
    this.setState('disconnected');
  }

  state(): ConnectionState {
    return this._state;
  }

  onSample(handler: (sample: FHRSample) => void): () => void {
    this.sampleHandlers.push(handler);
    return () => {
      this.sampleHandlers = this.sampleHandlers.filter((h) => h !== handler);
    };
  }

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  private subscribeToNotifications(): void {
    if (!this.device) return;
    this.notifSub = this.device.monitorCharacteristicForService(
      HEART_RATE_SERVICE_UUID,
      HEART_RATE_MEASUREMENT_UUID,
      (err, c) => {
        if (err || !c?.value) return;
        // react-native-ble-plx delivers characteristic values as base64.
        const bytes = new Uint8Array(Buffer.from(c.value, 'base64'));
        try {
          const parsed = parseHrm(bytes);
          this.emitSamplesFromParsed(parsed);
        } catch {
          /* Malformed packet — drop silently; will recover on next notify. */
        }
      },
    );
  }

  /**
   * RR intervals are preferred (SPEC.md §1.1). When RR is present, we reconstruct
   * per-beat FHR values sequentially from the notification timestamp backwards.
   * When RR is absent, fall back to the HR field directly.
   */
  private emitSamplesFromParsed(parsed: {
    hr: number;
    rrMs: number[];
  }): void {
    const now = Date.now();
    if (parsed.rrMs.length > 0) {
      // Reconstruct beat-by-beat timestamps: the most recent RR ends at `now`,
      // the preceding one ends `rr_{k}` ms earlier, etc.
      let cursor = now;
      // Iterate newest-first so each sample timestamps at its own beat end.
      for (let i = parsed.rrMs.length - 1; i >= 0; i--) {
        const rr = parsed.rrMs[i]!;
        const bpm = rr > 0 ? 60_000 / rr : parsed.hr;
        const sample = makeSample(bpm, cursor, 'rr');
        this.fanOutSample(sample);
        cursor -= rr;
      }
    } else {
      const interval = deriveIntervalFromHr(parsed.hr);
      void interval; // informational; we stamp at `now`.
      const sample = makeSample(parsed.hr, now, 'hr');
      this.fanOutSample(sample);
    }
  }

  private fanOutSample(s: FHRSample): void {
    for (const h of this.sampleHandlers) h(s);
  }

  private watchForDisconnect(): void {
    if (!this.device) return;
    this.device.onDisconnected(() => {
      this.setState('disconnected');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const deviceId = this.device?.id;
    if (!deviceId) return;
    if (this.reconnectStartedAt === null) this.reconnectStartedAt = Date.now();
    const elapsed = Date.now() - this.reconnectStartedAt;
    if (elapsed > RECONNECT_CEILING_MS) {
      this.clearReconnectTimer();
      this.reconnectStartedAt = null;
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(deviceId);
        this.reconnectStartedAt = null;
      } catch {
        this.scheduleReconnect();
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(s: ConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    for (const h of this.stateHandlers) h(s);
  }
}
