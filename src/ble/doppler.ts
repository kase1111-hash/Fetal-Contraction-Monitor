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

import { hrmToSamples, parseHrm, type ParsedHrm } from './parse-hrm';
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
  private disconnectSub: Subscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectStartedAt: number | null = null;
  /** Device we should reconnect to; survives `device` being cleared. */
  private lastDeviceId: string | null = null;
  /**
   * Set while a user-initiated disconnect is in flight. `cancelConnection()`
   * fires the same `onDisconnected` callback as a dropped link, and without
   * this flag the app would silently reconnect 5 s after the user asked it
   * not to.
   */
  private disconnecting = false;

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
    // Drop any subscriptions left over from a previous link before adding new
    // ones — otherwise every reconnect stacks another notification listener
    // and the same beat gets fanned out once per past connection.
    this.clearSubscriptions();
    this.device = device;
    this.lastDeviceId = deviceId;
    this.subscribeToNotifications();
    this.watchForDisconnect();
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.disconnecting = true;
    try {
      this.clearReconnectTimer();
      this.reconnectStartedAt = null;
      this.clearSubscriptions();
      if (this.device) {
        try {
          await this.device.cancelConnection();
        } catch {
          /* ignore — already disconnected */
        }
      }
      this.device = null;
      this.lastDeviceId = null;
      this.setState('disconnected');
    } finally {
      this.disconnecting = false;
    }
  }

  private clearSubscriptions(): void {
    this.notifSub?.remove();
    this.notifSub = null;
    this.disconnectSub?.remove();
    this.disconnectSub = null;
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
   * Expand a notification into samples and fan them out. The oldest-first
   * ordering guaranteed by `hrmToSamples` is what the downstream buffer and
   * extractor rely on — see the note on that function.
   */
  private emitSamplesFromParsed(parsed: ParsedHrm): void {
    for (const sample of hrmToSamples(parsed, Date.now())) {
      this.fanOutSample(sample);
    }
  }

  private fanOutSample(s: FHRSample): void {
    for (const h of this.sampleHandlers) h(s);
  }

  private watchForDisconnect(): void {
    if (!this.device) return;
    this.disconnectSub = this.device.onDisconnected(() => {
      // A user-initiated `disconnect()` also lands here via cancelConnection.
      // Don't fight the user by reconnecting.
      if (this.disconnecting) return;
      this.setState('disconnected');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const deviceId = this.lastDeviceId;
    if (deviceId === null) return;
    if (this.reconnectStartedAt === null) this.reconnectStartedAt = Date.now();
    const elapsed = Date.now() - this.reconnectStartedAt;
    if (elapsed > RECONNECT_CEILING_MS) {
      this.clearReconnectTimer();
      this.reconnectStartedAt = null;
      return;
    }
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.disconnecting) return;
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
