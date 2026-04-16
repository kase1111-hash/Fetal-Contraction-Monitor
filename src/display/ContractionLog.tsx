/**
 * ContractionLog — scrollable table of contractions, most recent first.
 * Reference: SPEC.md §6.4 + §2.4 "User correction" (delete a false positive).
 *
 * Current affordances:
 *   - Tap a row to open a details/edit sheet.
 *   - Long-press a row to delete it (with confirmation).
 *
 * Deferred (see GitHub issues, not inline TODOs):
 *   - Drag to adjust timing on the timeline view.
 *   - Long-press on the timeline to insert a missed contraction.
 *     (insertContractionAt is already wired on the context.)
 */

import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  COLOR_GREEN,
  COLOR_RED,
  COLOR_YELLOW,
  nadirTextColor,
  recoveryTextColor,
} from './colors';
import { FHRResponseCurve } from './FHRResponseCurve';
import type { ContractionResponse, ResponseQuality } from '../types';

const QUALITY_ICON: Record<ResponseQuality, string> = {
  good: '✓',
  fair: '~',
  poor: '✗',
};

const QUALITY_COLOR: Record<ResponseQuality, string> = {
  good: COLOR_GREEN,
  fair: COLOR_YELLOW,
  poor: COLOR_RED,
};

export interface ContractionLogProps {
  contractions: readonly ContractionResponse[];
  onDelete?(id: string): void;
  onSelect?(id: string): void;
}

export function ContractionLog({
  contractions,
  onDelete,
  onSelect,
}: ContractionLogProps): React.ReactElement {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Render newest first; the incoming array is chronological.
  const data = [...contractions].reverse();

  const confirmDelete = (id: string, index: number): void => {
    if (!onDelete) return;
    Alert.alert(
      'Delete contraction?',
      `Remove contraction #${index} from this session?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(id) },
      ],
    );
  };

  return (
    <FlatList
      data={data}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.cell, styles.headerText, { flex: 0.5 }]}>#</Text>
          <Text style={[styles.cell, styles.headerText]}>Nadir</Text>
          <Text style={[styles.cell, styles.headerText]}>Recov.</Text>
          <Text style={[styles.cell, styles.headerText]}>Conf.</Text>
          <Text style={[styles.cell, styles.headerText, { flex: 0.4 }]}>Q</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const displayIndex = contractions.length - index; // 1-based, newest highest
        return (
          <Pressable
            onPress={() => {
              setExpandedId((prev) => (prev === item.id ? null : item.id));
              onSelect?.(item.id);
            }}
            onLongPress={() => confirmDelete(item.id, displayIndex)}
          >
            <View style={styles.row}>
              <Text style={[styles.cell, styles.mono, { flex: 0.5 }]}>{displayIndex}</Text>
              <Text style={[styles.cell, styles.mono, { color: nadirTextColor(item.nadirDepth) }]}>
                {item.nadirDepth.toFixed(0)} bpm
              </Text>
              <Text
                style={[styles.cell, styles.mono, { color: recoveryTextColor(item.recoveryTime) }]}
              >
                {item.recoveryTime.toFixed(0)} s
              </Text>
              <ConfidenceBar value={item.detectionConfidence} />
              <Text
                style={[
                  styles.cell,
                  styles.mono,
                  { flex: 0.4, color: QUALITY_COLOR[item.qualityGrade] },
                ]}
              >
                {QUALITY_ICON[item.qualityGrade]}
              </Text>
            </View>
            {expandedId === item.id && (
              <View style={styles.detail}>
                <DetailRow label="Method" value={item.detectionMethod} />
                <DetailRow label="Baseline FHR" value={`${item.baselineFHR.toFixed(0)} bpm`} />
                <DetailRow label="Nadir timing" value={`${item.nadirTiming.toFixed(1)} s`} />
                <DetailRow label="Response area" value={`${item.responseArea.toFixed(0)} bpm·s`} />
                <DetailRow label="FHR quality" value={`${(item.fhrQuality * 100).toFixed(0)}%`} />
                <FHRResponseCurve contraction={item} />
                <Text style={styles.hint}>Long-press row to delete</Text>
              </View>
            )}
          </Pressable>
        );
      }}
    />
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ConfidenceBar({ value }: { value: number }): React.ReactElement {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={[styles.cell, { flexDirection: 'row', alignItems: 'center' }]}>
      <View style={styles.barOuter}>
        <View style={[styles.barInner, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerText: { color: '#9a9aa6', fontSize: 11, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a2e',
  },
  cell: { flex: 1, paddingHorizontal: 4 },
  mono: { color: '#cfcfd4', fontSize: 13, fontVariant: ['tabular-nums'] },
  barOuter: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a2a3b',
    overflow: 'hidden',
  },
  barInner: { height: 4, backgroundColor: '#6b8cff' },
  detail: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#141420',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a2e',
  },
  detailRow: { flexDirection: 'row', paddingVertical: 2 },
  detailLabel: { color: '#9a9aa6', fontSize: 12, flex: 1 },
  detailValue: { color: '#cfcfd4', fontSize: 12 },
  hint: { color: '#5a5a66', fontSize: 10, marginTop: 4, textAlign: 'center' },
});
