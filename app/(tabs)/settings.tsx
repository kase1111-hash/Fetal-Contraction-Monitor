/**
 * Settings screen — Phase-1 version:
 *   - Doppler pairing (stub: real flow needs a runtime BLE scan UI)
 *   - CSV export of the current session
 *   - Simulation-mode launcher
 *   - About / disclaimer
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { sessionToCsv } from '../../src/export/csv';
import {
  scenarioParams,
  generateFhrStream,
  type ScenarioKind,
} from '../../src/simulation/scenarios';
import { useSession } from '../../src/state/session-context';

export default function SettingsScreen(): React.ReactElement {
  const { session, startSession, recordDetection, recordFhrSample } = useSession();
  const [note, setNote] = useState<string | null>(null);

  async function exportCsv(): Promise<void> {
    if (session === null || session.contractions.length === 0) {
      setNote('No contractions to export yet.');
      return;
    }
    const csv = sessionToCsv(session);
    try {
      await Share.share({ message: csv, title: `session-${session.id}.csv` });
      setNote('Export opened in share sheet.');
    } catch {
      setNote('Export failed.');
    }
  }

  function runSimulation(kind: ScenarioKind): void {
    startSession();
    const n = 15;
    const now = Date.now();
    for (let k = 0; k < n; k++) {
      const peak = now + k * 2_000; // compressed 2 s per contraction
      const params = scenarioParams(kind, k, n);
      const samples = generateFhrStream(params, peak);
      for (const s of samples) recordFhrSample(s);
      recordDetection({ peakTimestamp: peak, method: 'manual', confidence: 1 });
    }
    setNote(`Simulating "${kind}"… watch the Monitor tab.`);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Section title="Doppler">
        <Text style={styles.body}>
          Connect a Bluetooth fetal Doppler from the Monitor screen. BLE pairing
          requires on-device permission; scan support appears there when ready.
        </Text>
      </Section>

      <Section title="Export">
        <Row label="CSV (current session)" onPress={exportCsv} />
      </Section>

      <Section title="Simulation">
        <Row label="Normal labor" onPress={() => runSimulation('normal')} />
        <Row label="Concerning" onPress={() => runSimulation('concerning')} />
        <Row label="Distress" onPress={() => runSimulation('distress')} />
      </Section>

      <Section title="About">
        <Text style={styles.body}>
          Fetal Contraction Monitor · research prototype. All computation is
          local. No data leaves the device unless you explicitly export.
        </Text>
      </Section>

      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
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

function Row({ label, onPress }: { label: string; onPress(): void }): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#9a9aa6',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a2e',
  },
  rowLabel: { color: '#cfcfd4', flex: 1, fontSize: 14 },
  chevron: { color: '#5a5a66', fontSize: 18 },
  body: { color: '#cfcfd4', fontSize: 13, lineHeight: 18 },
  note: {
    color: '#6b8cff',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
