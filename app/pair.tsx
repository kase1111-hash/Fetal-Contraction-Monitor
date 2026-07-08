/**
 * Doppler pairing screen (/pair).
 *
 * Scan for BLE fetal Dopplers, connect, and stream FHR into the session. Also
 * hosts the accelerometer contraction-detection toggle. Reached from the
 * Monitor and Settings screens.
 *
 * On Android 12+ a runtime BLUETOOTH_SCAN / BLUETOOTH_CONNECT grant is required
 * before scanning; we request it best-effort and surface the result. iOS and
 * web fall through the try/catch as no-ops.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

import { useLiveSensors } from '../src/state/live-sensors';
import type { DiscoveredDevice } from '../src/ble/doppler-client';

export default function PairScreen(): React.ReactElement {
  const {
    bleAvailable,
    connectionState,
    scanning,
    devices,
    connectedId,
    scan,
    connect,
    disconnect,
    accelEnabled,
    setAccelEnabled,
  } = useLiveSensors();

  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onScan(): Promise<void> {
    setNote(null);
    const granted = await requestBlePermissions();
    if (!granted) {
      setNote('Bluetooth permission denied. Enable it in system settings to scan.');
      return;
    }
    try {
      await scan();
    } catch {
      setNote('Scan failed. Make sure Bluetooth is on.');
    }
  }

  async function onConnect(id: string): Promise<void> {
    setBusyId(id);
    setNote(null);
    try {
      await connect(id);
      setNote('Connected. FHR is now streaming to the Monitor tab.');
    } catch {
      setNote('Could not connect to that device.');
    } finally {
      setBusyId(null);
    }
  }

  async function onDisconnect(): Promise<void> {
    try {
      await disconnect();
      setNote('Disconnected.');
    } catch {
      /* ignore */
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Connect Doppler' }} />

      {!bleAvailable && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            No Bluetooth transport detected — running in simulation mode.
            Scanning returns a synthetic Doppler so you can try the full flow.
          </Text>
        </View>
      )}

      <Section title="Doppler">
        <Text style={styles.state}>Status: {labelForState(connectionState)}</Text>

        {connectedId !== null ? (
          <PrimaryButton label="Disconnect" onPress={() => void onDisconnect()} />
        ) : (
          <PrimaryButton
            label={scanning ? 'Scanning…' : 'Scan for devices'}
            onPress={() => void onScan()}
            disabled={scanning}
          />
        )}

        {scanning && <ActivityIndicator style={{ marginTop: 12 }} color="#6b8cff" />}

        {connectedId === null &&
          devices.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              busy={busyId === d.id}
              onPress={() => void onConnect(d.id)}
            />
          ))}

        {connectedId === null && !scanning && devices.length === 0 && (
          <Text style={styles.hint}>
            Turn on your fetal Doppler, then scan. Devices advertising the
            standard Heart Rate service (0x180D) appear here.
          </Text>
        )}
      </Section>

      <Section title="Contraction detection">
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Accelerometer</Text>
            <Text style={styles.hint}>
              Detect contractions from phone motion. Rest the phone face-up on
              the abdomen. Manual tapping on the Monitor tab always works too.
            </Text>
          </View>
          <Switch
            value={accelEnabled}
            onValueChange={setAccelEnabled}
            trackColor={{ true: '#3a5bff', false: '#2a2a3b' }}
          />
        </View>
      </Section>

      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
  );
}

function DeviceRow({
  device,
  busy,
  onPress,
}: {
  device: DiscoveredDevice;
  busy: boolean;
  onPress(): void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} disabled={busy} style={styles.deviceRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.deviceName}>{device.name ?? 'Unknown device'}</Text>
        <Text style={styles.deviceMeta}>
          {device.id}
          {device.rssi !== null ? ` · ${device.rssi} dBm` : ''}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color="#6b8cff" />
      ) : (
        <Text style={styles.connect}>Connect</Text>
      )}
    </Pressable>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, disabled && styles.btnDisabled]}
    >
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

function labelForState(state: string): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'scanning':
      return 'Scanning…';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Idle';
  }
}

/**
 * Best-effort Android runtime permission request for BLE scanning. Returns true
 * on iOS/web (handled via Info.plist / not required) and when all grants
 * succeed; false when the user denies.
 */
async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const { PermissionsAndroid } = require('react-native') as typeof import('react-native');
    const perms = [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ].filter((p): p is NonNullable<typeof p> => p != null);
    const result = await PermissionsAndroid.requestMultiple(perms);
    return Object.values(result).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED,
    );
  } catch {
    // Older Android without the new permissions, or request unavailable.
    return true;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16 },
  banner: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  bannerText: { color: '#f2c94c', fontSize: 12, lineHeight: 17 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#9a9aa6',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  state: { color: '#cfcfd4', fontSize: 13, marginBottom: 12 },
  btn: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#3a5bff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#2a2a3b' },
  btnLabel: { color: 'white', fontWeight: '700', letterSpacing: 1 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a2e',
  },
  deviceName: { color: '#cfcfd4', fontSize: 15 },
  deviceMeta: { color: '#5a5a66', fontSize: 11, marginTop: 2 },
  connect: { color: '#6b8cff', fontSize: 14, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { color: '#cfcfd4', fontSize: 14 },
  hint: { color: '#5a5a66', fontSize: 12, lineHeight: 17, marginTop: 6 },
  note: {
    color: '#6b8cff',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
});
