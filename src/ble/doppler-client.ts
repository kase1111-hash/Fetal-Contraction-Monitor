/**
 * Transport-agnostic Doppler client interface.
 *
 * The rest of the app consumes `DopplerClient`. The BLE wrapper and the
 * FakeDoppler implement it. This lets every pipeline stage be tested
 * without hardware — see CODING_GUIDE.md Step 4 "Mock first".
 */

import type { FHRSample } from '../types';

export type ConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected';

export interface DiscoveredDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export interface DopplerClient {
  scan(timeoutMs?: number): Promise<DiscoveredDevice[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;

  /** Current transport state. */
  state(): ConnectionState;

  /** Subscribe to FHR samples. Returns an unsubscribe fn. */
  onSample(handler: (sample: FHRSample) => void): () => void;

  /** Subscribe to connection state changes. Returns an unsubscribe fn. */
  onState(handler: (state: ConnectionState) => void): () => void;
}
