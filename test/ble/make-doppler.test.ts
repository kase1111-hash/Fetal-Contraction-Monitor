import { createDopplerClient } from '../../src/ble/make-doppler';
import { FakeDoppler } from '../../src/ble/fake-doppler';
import { BleDoppler } from '../../src/ble/doppler';
import type { DopplerClient } from '../../src/ble/doppler-client';

/** Minimal DopplerClient stub for injection. */
function stubClient(): DopplerClient {
  return {
    scan: async () => [],
    connect: async () => undefined,
    disconnect: async () => undefined,
    state: () => 'idle',
    onSample: () => () => undefined,
    onState: () => () => undefined,
  };
}

describe('createDopplerClient', () => {
  test('forceFake returns a fake client without touching the real factory', () => {
    let realCalled = false;
    const { client, isReal } = createDopplerClient({
      forceFake: true,
      realFactory: () => {
        realCalled = true;
        return stubClient();
      },
    });
    expect(isReal).toBe(false);
    expect(realCalled).toBe(false);
    expect(client).toBeInstanceOf(FakeDoppler);
  });

  test('uses the real client when its factory succeeds', () => {
    const real = stubClient();
    const { client, isReal } = createDopplerClient({
      realFactory: () => real,
    });
    expect(isReal).toBe(true);
    expect(client).toBe(real);
  });

  test('falls back to fake when the real factory throws', () => {
    const fake = stubClient();
    let fakeCalled = false;
    const { client, isReal } = createDopplerClient({
      realFactory: () => {
        throw new Error('native module missing');
      },
      fakeFactory: () => {
        fakeCalled = true;
        return fake;
      },
    });
    expect(isReal).toBe(false);
    expect(fakeCalled).toBe(true);
    expect(client).toBe(fake);
  });

  test('default fake client is a usable FakeDoppler', async () => {
    const { client } = createDopplerClient({
      realFactory: () => {
        throw new Error('unavailable');
      },
    });
    const devices = await client.scan();
    expect(devices.length).toBeGreaterThanOrEqual(1);
    expect(client.state()).toBe('idle');
  });
});

describe('createDopplerClient — real default factory', () => {
  // `doppler.ts` now loads under Node (it requires react-native-ble-plx lazily
  // so its state machine can be unit-tested). These guard the consequence:
  // constructing the real client must still fail without the native module, so
  // the app keeps degrading to FakeDoppler instead of booting a dead transport.
  test('falls back to FakeDoppler when native BLE is absent', () => {
    const { client, isReal } = createDopplerClient();
    expect(isReal).toBe(false);
    expect(client).toBeInstanceOf(FakeDoppler);
  });

  test('BleDoppler with no injected manager throws outside the RN runtime', () => {
    expect(() => new BleDoppler()).toThrow();
  });
});
