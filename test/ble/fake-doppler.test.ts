import { FakeDoppler } from '../../src/ble/fake-doppler';
import type { FHRSample } from '../../src/types';

describe('FakeDoppler', () => {
  test('scan returns at least one synthetic device', async () => {
    const d = new FakeDoppler();
    const devs = await d.scan();
    expect(devs.length).toBeGreaterThanOrEqual(1);
    expect(devs[0]!.id).toBeTruthy();
  });

  test('connect → state transitions and emit produces samples', async () => {
    // Stub out the scheduler so we drive emission manually.
    const d = new FakeDoppler({
      now: () => 1_700_000_000_000,
      setInterval: (() => 0) as unknown as typeof setInterval,
      clearInterval: (() => undefined) as unknown as typeof clearInterval,
    });

    const states: string[] = [];
    d.onState((s) => states.push(s));
    const samples: FHRSample[] = [];
    d.onSample((s) => samples.push(s));

    await d.connect('fake-doppler-0');
    d.emit();
    d.emit();

    expect(states).toContain('connecting');
    expect(states).toContain('connected');
    expect(samples).toHaveLength(2);
    expect(samples[0]!.valid).toBe(true);
    expect(samples[0]!.fhr).toBeGreaterThan(130);
    expect(samples[0]!.fhr).toBeLessThan(150);
  });

  test('unsubscribe stops delivery', async () => {
    const d = new FakeDoppler({
      setInterval: (() => 0) as unknown as typeof setInterval,
      clearInterval: (() => undefined) as unknown as typeof clearInterval,
    });
    const samples: FHRSample[] = [];
    const unsub = d.onSample((s) => samples.push(s));
    await d.connect('fake-doppler-0');
    d.emit();
    unsub();
    d.emit();
    expect(samples).toHaveLength(1);
  });

  test('disconnect transitions to disconnected', async () => {
    const d = new FakeDoppler({
      setInterval: (() => 0) as unknown as typeof setInterval,
      clearInterval: (() => undefined) as unknown as typeof clearInterval,
    });
    await d.connect('fake-doppler-0');
    await d.disconnect();
    expect(d.state()).toBe('disconnected');
  });
});
