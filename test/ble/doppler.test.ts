/**
 * BleDoppler state-machine tests, driven against a fake transport.
 *
 * This covers the connect / disconnect / reconnect logic that can't be
 * exercised on a simulator: the client is safety-relevant (a Doppler that
 * silently stops streaming, or reconnects after the user disconnected, is a
 * real problem during labor) and previously had no coverage at all.
 */

import { Buffer } from 'buffer';

import { BleDoppler } from '../../src/ble/doppler';
import type {
  BleAdvertisedDeviceLike,
  BleCharacteristicLike,
  BleDeviceLike,
  BleManagerLike,
  BleSubscriptionLike,
} from '../../src/ble/doppler';
import type { ConnectionState } from '../../src/ble/doppler-client';
import type { FHRSample } from '../../src/types';

class FakeSubscription implements BleSubscriptionLike {
  constructor(private readonly onRemove: () => void) {}
  remove(): void {
    this.onRemove();
  }
}

class FakeDevice implements BleDeviceLike {
  name: string | null = 'Fake Doppler';
  rssi: number | null = -50;
  cancelCalls = 0;
  private notifyListeners: Array<
    (e: unknown, c: BleCharacteristicLike | null) => void
  > = [];
  private disconnectListeners: Array<(e: unknown) => void> = [];

  constructor(public id: string) {}

  async discoverAllServicesAndCharacteristics(): Promise<unknown> {
    return this;
  }

  monitorCharacteristicForService(
    _service: string,
    _characteristic: string,
    listener: (e: unknown, c: BleCharacteristicLike | null) => void,
  ): BleSubscriptionLike {
    this.notifyListeners.push(listener);
    return new FakeSubscription(() => {
      this.notifyListeners = this.notifyListeners.filter((l) => l !== listener);
    });
  }

  onDisconnected(listener: (e: unknown) => void): BleSubscriptionLike {
    this.disconnectListeners.push(listener);
    return new FakeSubscription(() => {
      this.disconnectListeners = this.disconnectListeners.filter(
        (l) => l !== listener,
      );
    });
  }

  async cancelConnection(): Promise<unknown> {
    this.cancelCalls += 1;
    // The native layer reports the drop through the same callback a spontaneous
    // disconnect uses.
    this.fireDisconnect();
    return this;
  }

  /** Simulate the link dropping on its own. */
  fireDisconnect(): void {
    for (const l of [...this.disconnectListeners]) l(null);
  }

  /** Simulate an HRM notification carrying `bytes`. */
  notify(bytes: number[]): void {
    const value = Buffer.from(Uint8Array.from(bytes)).toString('base64');
    for (const l of [...this.notifyListeners]) l(null, { value });
  }

  get notifyListenerCount(): number {
    return this.notifyListeners.length;
  }
  get disconnectListenerCount(): number {
    return this.disconnectListeners.length;
  }
}

class FakeManager implements BleManagerLike {
  readonly devices = new Map<string, FakeDevice>();
  readonly connectCalls: string[] = [];
  /** Number of subsequent connectToDevice calls that should reject. */
  failNextConnects = 0;
  stopScanCalls = 0;
  private scanListener:
    | ((e: unknown, d: BleAdvertisedDeviceLike | null) => void)
    | null = null;

  startDeviceScan(
    _uuids: string[] | null,
    _options: unknown,
    listener: (e: unknown, d: BleAdvertisedDeviceLike | null) => void,
  ): void {
    this.scanListener = listener;
  }

  stopDeviceScan(): void {
    this.stopScanCalls += 1;
    this.scanListener = null;
  }

  /** Push an advertisement to the in-flight scan. */
  advertise(d: BleAdvertisedDeviceLike): void {
    this.scanListener?.(null, d);
  }

  async connectToDevice(deviceId: string): Promise<BleDeviceLike> {
    this.connectCalls.push(deviceId);
    if (this.failNextConnects > 0) {
      this.failNextConnects -= 1;
      throw new Error('connect failed');
    }
    return this.device(deviceId);
  }

  /** The persistent fake for an id — reconnects hand back the same object. */
  device(deviceId: string): FakeDevice {
    let d = this.devices.get(deviceId);
    if (d === undefined) {
      d = new FakeDevice(deviceId);
      this.devices.set(deviceId, d);
    }
    return d;
  }
}

/** flags=0x10 (RR present), hr=140, three RR intervals. */
const HRM_THREE_RR = [0x10, 140, 0x90, 0x01, 0xae, 0x01, 0x9a, 0x01];

function collect(client: BleDoppler): {
  samples: FHRSample[];
  states: ConnectionState[];
} {
  const samples: FHRSample[] = [];
  const states: ConnectionState[] = [];
  client.onSample((s) => samples.push(s));
  client.onState((s) => states.push(s));
  return { samples, states };
}

describe('BleDoppler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('scan', () => {
    test('collects advertisements and stops the scan when it times out', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);

      const scanned = client.scan();
      mgr.advertise({ id: 'a', name: 'Doppler A', rssi: -40 });
      mgr.advertise({ id: 'b', name: 'Doppler B', rssi: -70 });
      mgr.advertise({ id: 'a', name: 'Doppler A', rssi: -42 }); // duplicate

      await jest.advanceTimersByTimeAsync(8_000);
      const found = await scanned;

      expect(found.map((d) => d.id)).toEqual(['a', 'b']);
      expect(mgr.stopScanCalls).toBe(1);
      expect(client.state()).toBe('idle');
    });
  });

  describe('connect and streaming', () => {
    test('connects and fans out notification samples oldest-first', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      const { samples, states } = collect(client);

      await client.connect('a');
      expect(client.state()).toBe('connected');
      expect(states).toEqual(['connecting', 'connected']);

      mgr.device('a').notify(HRM_THREE_RR);

      expect(samples).toHaveLength(3);
      const ts = samples.map((s) => s.timestamp);
      expect(ts).toEqual([...ts].sort((x, y) => x - y));
    });

    test('a malformed packet is dropped without killing the subscription', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      const { samples } = collect(client);

      await client.connect('a');
      mgr.device('a').notify([0x00]); // too short — parseHrm throws
      expect(samples).toHaveLength(0);

      mgr.device('a').notify(HRM_THREE_RR);
      expect(samples).toHaveLength(3);
    });
  });

  describe('user-initiated disconnect', () => {
    test('does not reconnect afterwards', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      await client.connect('a');
      expect(mgr.connectCalls).toEqual(['a']);

      await client.disconnect();
      expect(client.state()).toBe('disconnected');
      expect(mgr.device('a').cancelCalls).toBe(1);

      // The reconnect policy would fire at 5 s. It must not.
      await jest.advanceTimersByTimeAsync(60_000);
      expect(mgr.connectCalls).toEqual(['a']);
    });

    test('a late disconnect event from the bridge still does not reconnect', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      await client.connect('a');
      await client.disconnect();

      // Native layers can deliver the disconnect notification after the call
      // that caused it has already returned.
      mgr.device('a').fireDisconnect();

      await jest.advanceTimersByTimeAsync(60_000);
      expect(mgr.connectCalls).toEqual(['a']);
    });

    test('releases both subscriptions', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      await client.connect('a');
      await client.disconnect();

      expect(mgr.device('a').notifyListenerCount).toBe(0);
      expect(mgr.device('a').disconnectListenerCount).toBe(0);
    });
  });

  describe('unexpected disconnect', () => {
    test('reconnects after the retry interval', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      const { states } = collect(client);

      await client.connect('a');
      mgr.device('a').fireDisconnect();
      expect(client.state()).toBe('disconnected');

      await jest.advanceTimersByTimeAsync(5_000);

      expect(mgr.connectCalls).toEqual(['a', 'a']);
      expect(client.state()).toBe('connected');
      expect(states).toContain('disconnected');
    });

    test('does not duplicate samples after reconnecting', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      const { samples } = collect(client);

      await client.connect('a');
      mgr.device('a').fireDisconnect();
      await jest.advanceTimersByTimeAsync(5_000);

      // Exactly one live notification listener — a leaked one would fan every
      // beat out twice.
      expect(mgr.device('a').notifyListenerCount).toBe(1);
      expect(mgr.device('a').disconnectListenerCount).toBe(1);

      mgr.device('a').notify(HRM_THREE_RR);
      expect(samples).toHaveLength(3);
    });

    test('survives several reconnect cycles without stacking listeners', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      const { samples } = collect(client);

      await client.connect('a');
      for (let i = 0; i < 5; i++) {
        mgr.device('a').fireDisconnect();
        await jest.advanceTimersByTimeAsync(5_000);
      }

      expect(mgr.device('a').notifyListenerCount).toBe(1);
      mgr.device('a').notify(HRM_THREE_RR);
      expect(samples).toHaveLength(3);
    });

    test('retries a failing reconnect, then gives up at the 2 min ceiling', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      await client.connect('a');

      mgr.failNextConnects = Number.MAX_SAFE_INTEGER;
      mgr.device('a').fireDisconnect();

      await jest.advanceTimersByTimeAsync(130_000);
      const afterCeiling = mgr.connectCalls.length;
      expect(afterCeiling).toBeGreaterThan(1); // it did retry

      // Past the ceiling nothing more is scheduled.
      await jest.advanceTimersByTimeAsync(120_000);
      expect(mgr.connectCalls).toHaveLength(afterCeiling);
      expect(client.state()).toBe('disconnected');
    });

    test('a reconnect that succeeds after failures resets the retry budget', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      await client.connect('a');

      mgr.failNextConnects = 2;
      mgr.device('a').fireDisconnect();
      await jest.advanceTimersByTimeAsync(20_000);
      expect(client.state()).toBe('connected');

      // A later drop gets a full retry budget again, not the leftover of the
      // previous one.
      mgr.failNextConnects = 0;
      mgr.device('a').fireDisconnect();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(client.state()).toBe('connected');
    });

    test('disconnecting mid-retry cancels the pending reconnect', async () => {
      const mgr = new FakeManager();
      const client = new BleDoppler(mgr);
      await client.connect('a');

      mgr.failNextConnects = Number.MAX_SAFE_INTEGER;
      mgr.device('a').fireDisconnect();
      await jest.advanceTimersByTimeAsync(5_000);
      const duringRetry = mgr.connectCalls.length;

      mgr.failNextConnects = 0;
      await client.disconnect();

      await jest.advanceTimersByTimeAsync(60_000);
      expect(mgr.connectCalls).toHaveLength(duringRetry);
      expect(client.state()).toBe('disconnected');
    });
  });
});
