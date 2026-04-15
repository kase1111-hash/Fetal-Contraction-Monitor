/**
 * BLE Heart Rate Measurement (characteristic 0x2A37) parser.
 *
 * Reference: SPEC.md §1.1 "Connection flow" step 5 (lines 26–31), plus the
 * Bluetooth SIG HRM spec. Byte layout:
 *
 *   Byte 0 (flags):
 *     bit 0  — HR format: 0 = uint8, 1 = uint16 (little-endian)
 *     bit 1  — Sensor Contact status bit
 *     bit 2  — Sensor Contact support bit
 *     bit 3  — Energy Expended present
 *     bit 4  — RR-Interval present
 *   Bytes 1..:
 *     HR value (1 or 2 bytes depending on bit 0)
 *     [Energy Expended: 2 bytes if bit 3]
 *     [RR intervals: 2 bytes each, 1/1024 s units, packed]
 *
 * RR intervals are preferred when present; SPEC.md §1.1 mandates:
 *   "rr_ms = rr_raw / 1.024"
 */

export interface ParsedHrm {
  /** Beats per minute. */
  hr: number;
  /** Whether HR was encoded as 16-bit (true) or 8-bit (false). */
  hr16: boolean;
  /** Parsed RR intervals in milliseconds, in the order transmitted. Empty if absent. */
  rrMs: number[];
  /** True if the sensor reported no skin contact (flags bits 1–2). */
  sensorNoContact: boolean;
}

/**
 * Parse a single HRM notification. Accepts a Uint8Array (as returned by
 * react-native-ble-plx's base64 → bytes decode, or any BLE transport).
 *
 * Throws on truncated packets so miswired transports surface loudly rather
 * than silently producing 0-bpm readings.
 */
export function parseHrm(bytes: Uint8Array): ParsedHrm {
  if (bytes.length < 2) {
    throw new Error(`HRM notification too short: ${bytes.length} bytes`);
  }
  const flags = bytes[0]!;
  const hr16 = (flags & 0x01) === 0x01;
  const sensorContactSupported = (flags & 0x04) === 0x04;
  const sensorContactDetected = (flags & 0x02) === 0x02;
  const energyPresent = (flags & 0x08) === 0x08;
  const rrPresent = (flags & 0x10) === 0x10;

  let offset = 1;

  // Heart rate
  let hr: number;
  if (hr16) {
    if (bytes.length < offset + 2) throw new Error('HRM packet missing 16-bit HR');
    hr = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2;
  } else {
    hr = bytes[offset]!;
    offset += 1;
  }

  // Skip Energy Expended if present (2 bytes)
  if (energyPresent) {
    if (bytes.length < offset + 2) throw new Error('HRM packet missing energy field');
    offset += 2;
  }

  // RR intervals, 2 bytes each in 1/1024 s units → milliseconds via / 1.024.
  const rrMs: number[] = [];
  if (rrPresent) {
    while (offset + 1 < bytes.length) {
      const raw = bytes[offset]! | (bytes[offset + 1]! << 8);
      rrMs.push(raw / 1.024);
      offset += 2;
    }
  }

  return {
    hr,
    hr16,
    rrMs,
    sensorNoContact: sensorContactSupported && !sensorContactDetected,
  };
}

/**
 * If the notification carried no RR intervals, derive an instantaneous
 * inter-beat interval from HR: `interval_ms = 60000 / hr_bpm`.
 * Quality is lower — see SPEC.md §1.1 "If RR intervals are NOT present".
 */
export function deriveIntervalFromHr(hrBpm: number): number {
  if (hrBpm <= 0) return 0;
  return 60_000 / hrBpm;
}
