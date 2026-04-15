/**
 * Session review — read-only detail view of a past session.
 *
 * Loads history from storage, finds the session by id, and renders:
 *   - StatusLight summary
 *   - StatusTimeline (full status history)
 *   - RecoveryTrendChart
 *   - TorusDisplay of the final trajectory
 *   - ContractionLog (read-only — no delete)
 *
 * No editing — past sessions are immutable.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useSession } from '../../src/state/session-context';
import { StatusLight } from '../../src/display/StatusLight';
import { StatusTimeline } from '../../src/display/StatusTimeline';
import { TorusDisplay } from '../../src/display/TorusDisplay';
import { RecoveryTrendChart } from '../../src/display/RecoveryTrendChart';
import { ContractionLog } from '../../src/display/ContractionLog';
import { computeTrajectory } from '../../src/torus/map-point';
import { computeTrajectoryFeatures } from '../../src/trajectory/features';
import { sessionToCsv } from '../../src/export/csv';
import { exportSessionPdf } from '../../src/export/pdf';
import { statusLabel } from '../../src/alerts/uncertainty';
import type { LaborSession } from '../../src/types';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export default function SessionReviewScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loadHistory } = useSession();
  const [session, setSession] = useState<LaborSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const history = await loadHistory();
      const found = history.find((s) => s.id === id) ?? null;
      if (!cancelled) setSession(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadHistory]);

  const trajectory = useMemo(
    () => (session ? computeTrajectory(session.contractions, 'auto') : []),
    [session],
  );
  const byId = useMemo(() => {
    if (!session) return {};
    const map: Record<string, (typeof session.contractions)[number]> = {};
    for (const c of session.contractions) map[c.id] = c;
    return map;
  }, [session]);

  if (session === undefined) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: 'Session' }} />
        <Text style={styles.emptyText}>Loading…</Text>
      </View>
    );
  }
  if (session === null) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <Text style={styles.emptyText}>Session not found.</Text>
      </View>
    );
  }

  const features = computeTrajectoryFeatures(session.contractions);

  async function exportCsv(): Promise<void> {
    if (!session) return;
    const csv = sessionToCsv(session);
    try {
      await Share.share({ message: csv, title: `session-${session.id}.csv` });
    } catch {
      /* user cancelled */
    }
  }
  async function exportPdf(): Promise<void> {
    if (!session) return;
    try {
      const { uri } = await exportSessionPdf(session);
      await Share.share({ url: uri, title: `session-${session.id}.pdf` });
    } catch {
      /* failed / cancelled */
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: formatDate(session.startTime) }} />

      <View style={styles.topRow}>
        <StatusLight status={session.status} size={56} />
        <View style={styles.topInfo}>
          <Text style={styles.label}>{statusLabel(session.status)}</Text>
          <Text style={styles.meta}>
            {session.contractions.length} contractions ·{' '}
            {Math.round(
              ((session.endTime ?? session.startTime) - session.startTime) /
                60_000,
            )}{' '}
            min
          </Text>
        </View>
      </View>

      <Text style={styles.section}>Status timeline</Text>
      <StatusTimeline
        startTime={session.startTime}
        endTime={session.endTime}
        currentStatus={session.status}
        transitions={session.statusHistory}
      />

      <Text style={styles.section}>Recovery trend</Text>
      <RecoveryTrendChart contractions={session.contractions} status={session.status} />

      <Text style={styles.section}>Torus trajectory</Text>
      <TorusDisplay points={trajectory} contractionsById={byId} />

      <Text style={styles.section}>Summary</Text>
      <View style={styles.summary}>
        <Summary label="Recovery slope" value={`${features.recoveryTrendSlope.toFixed(2)} s/ctx`} />
        <Summary label="Nadir slope" value={`${features.nadirTrendSlope.toFixed(2)} bpm/ctx`} />
        <Summary label="Last-5 recovery" value={`${features.recoveryLast5Mean.toFixed(1)} s`} />
        <Summary label="κ median" value={`${features.kappaMedian.toFixed(2)}`} />
      </View>

      <Text style={styles.section}>Contractions</Text>
      <ContractionLog contractions={session.contractions} />

      <View style={styles.actions}>
        <ActionButton label="Export CSV" onPress={exportCsv} />
        <ActionButton label="Export PDF" onPress={exportPdf} />
      </View>
    </ScrollView>
  );
}

function Summary({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress(): void }): React.ReactElement {
  return (
    <View style={styles.actionBtn} onTouchEnd={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16, gap: 8 },
  empty: { flex: 1, backgroundColor: '#0a0a0f', alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#9a9aa6' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topInfo: { flex: 1 },
  label: { color: '#cfcfd4', fontSize: 14, fontWeight: '600' },
  meta: { color: '#9a9aa6', fontSize: 11, marginTop: 2 },
  section: { color: '#9a9aa6', fontSize: 11, letterSpacing: 0.5, marginTop: 16, textTransform: 'uppercase' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryCell: {
    borderColor: '#1a1a2e',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    minWidth: 140,
  },
  summaryLabel: { color: '#9a9aa6', fontSize: 10, letterSpacing: 0.5 },
  summaryValue: { color: '#cfcfd4', fontSize: 14, fontWeight: '600', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2a2a3b',
    alignItems: 'center',
  },
  actionText: { color: '#cfcfd4', fontWeight: '600' },
});
