/**
 * Monitor screen — the main view during labor.
 *
 * Layout (top to bottom, per SPEC.md §6):
 *   1. Status light
 *   2. Stats row: Phase | CTX count | Last nadir | Last recovery
 *   3. Torus display
 *   4. Recovery trend chart
 *   5. Last-contraction info
 *   6. Control bar: Start/Stop + Contraction button
 *
 * Phase 2: haptics on status transitions (SPEC.md §5.2), personal-baseline
 * indicator once established.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { StatusLight } from '../../src/display/StatusLight';
import { TorusDisplay } from '../../src/display/TorusDisplay';
import { RecoveryTrendChart } from '../../src/display/RecoveryTrendChart';
import { ContractionButton } from '../../src/display/ContractionButton';
import { SignalQualityBadge } from '../../src/display/SignalQualityBadge';
import { useSession } from '../../src/state/session-context';
import { computeTrajectory } from '../../src/torus/map-point';
import type { AlertStatus, ContractionResponse } from '../../src/types';

function formatTimeElapsed(startMs: number, nowMs: number): string {
  const mins = Math.floor((nowMs - startMs) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function useStatusHaptics(status: AlertStatus): void {
  const last = useRef<AlertStatus>('grey');
  useEffect(() => {
    if (status === last.current) return;
    last.current = status;
    // Per SPEC.md §5.2:
    //   yellow → single vibration
    //   red    → 3 vibrations
    //   others → none
    if (status === 'yellow') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else if (status === 'red') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Two more pulses for the "3 vibrations" spec behavior.
      setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 180);
      setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 360);
    }
  }, [status]);
}

export default function MonitorScreen(): React.ReactElement {
  const {
    session,
    latestSample,
    pendingCount,
    startSession,
    endSession,
    recordDetection,
  } = useSession();

  const contractions = session?.contractions ?? [];
  const last: ContractionResponse | undefined = contractions[contractions.length - 1];

  const pts = useMemo(() => computeTrajectory(contractions, 'auto'), [contractions]);

  const signalQuality = latestSample
    ? latestSample.valid
      ? 'good'
      : 'poor'
    : 'disconnected';

  const status: AlertStatus = session?.status ?? 'grey';
  useStatusHaptics(status);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <StatusLight status={status} size={72} />
        <View style={styles.topInfo}>
          <Text style={styles.statusLabel}>
            {status === 'grey' && 'Collecting data'}
            {status === 'green' && 'Reassuring'}
            {status === 'yellow' && 'Concerning'}
            {status === 'red' && 'Alert — contact your provider'}
          </Text>
          {session?.personalBaseline && (
            <Text style={styles.baselineInfo}>
              Baseline: recovery {session.personalBaseline.recoveryMean.toFixed(0)}±
              {session.personalBaseline.recoverySd.toFixed(1)} s (frozen)
            </Text>
          )}
        </View>
        <SignalQualityBadge quality={signalQuality} />
      </View>

      <View style={styles.stats}>
        <Stat
          label="Elapsed"
          value={session ? formatTimeElapsed(session.startTime, Date.now()) : '—'}
        />
        <Stat label="CTX" value={String(contractions.length)} />
        <Stat
          label="Nadir"
          value={last ? `${last.nadirDepth.toFixed(0)}` : '—'}
          unit={last ? 'bpm' : ''}
        />
        <Stat
          label="Recov."
          value={last ? `${last.recoveryTime.toFixed(0)}` : '—'}
          unit={last ? 's' : ''}
        />
      </View>

      <View style={styles.torusWrap}>
        <TorusDisplay points={pts} />
        <Text style={styles.axisLabel}>Decel Depth →</Text>
      </View>

      <View style={styles.chartWrap}>
        <Text style={styles.sectionLabel}>Recovery Trend</Text>
        <RecoveryTrendChart contractions={contractions} status={status} />
      </View>

      {last && (
        <View style={styles.lastRow}>
          <Text style={styles.lastLabel}>Last contraction:</Text>
          <Text style={styles.lastValue}>
            nadir {last.nadirDepth.toFixed(0)} bpm, recovery {last.recoveryTime.toFixed(0)} s,
            confidence {(last.detectionConfidence * 100).toFixed(0)}%
          </Text>
        </View>
      )}

      {pendingCount > 0 && (
        <Text style={styles.pending}>
          {pendingCount} contraction{pendingCount === 1 ? '' : 's'} awaiting response window…
        </Text>
      )}

      <View style={styles.controls}>
        {session === null || session.endTime !== null ? (
          <PrimaryButton label="Start Session" onPress={startSession} />
        ) : (
          <>
            <ContractionButton
              onPress={() =>
                recordDetection({
                  peakTimestamp: Date.now(),
                  method: 'manual',
                  confidence: 1,
                })
              }
            />
            <View style={{ height: 12 }} />
            <SecondaryButton label="End Session" onPress={() => void endSession()} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }): React.ReactElement {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress(): void }): React.ReactElement {
  return (
    <View style={[styles.actionBtn, { backgroundColor: '#3a5bff' }]} onTouchEnd={onPress}>
      <Text style={styles.actionLabel}>{label}</Text>
    </View>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress(): void }): React.ReactElement {
  return (
    <View style={[styles.actionBtn, { backgroundColor: '#2a2a3b' }]} onTouchEnd={onPress}>
      <Text style={styles.actionLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16, alignItems: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 12 },
  topInfo: { flex: 1 },
  statusLabel: { color: '#cfcfd4', fontSize: 14, fontWeight: '600' },
  baselineInfo: { color: '#9a9aa6', fontSize: 11, marginTop: 2 },
  stats: { flexDirection: 'row', width: '100%', marginTop: 16, gap: 12 },
  statCell: { flex: 1, alignItems: 'flex-start' },
  statLabel: { color: '#9a9aa6', fontSize: 11, letterSpacing: 0.5 },
  statValue: { color: '#cfcfd4', fontSize: 20, fontWeight: '600', marginTop: 4 },
  statUnit: { color: '#9a9aa6', fontSize: 12, fontWeight: '400' },
  torusWrap: { marginTop: 20, alignItems: 'center' },
  axisLabel: { color: '#5a5a66', fontSize: 10, marginTop: 4 },
  chartWrap: { marginTop: 20, width: '100%' },
  sectionLabel: { color: '#9a9aa6', fontSize: 11, letterSpacing: 0.5, marginBottom: 6 },
  lastRow: { marginTop: 16, width: '100%' },
  lastLabel: { color: '#9a9aa6', fontSize: 11 },
  lastValue: { color: '#cfcfd4', fontSize: 13, marginTop: 2 },
  pending: { color: '#f2c94c', fontSize: 12, marginTop: 12 },
  controls: { marginTop: 20, width: '100%' },
  actionBtn: {
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: { color: 'white', fontWeight: '700', letterSpacing: 1 },
});
