/**
 * ContractionLog — scrollable table of contractions, most recent first.
 * Reference: SPEC.md §6.4.
 */

import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { LAST5_RED, LAST5_YELLOW } from '../constants';
import type { ContractionResponse, ResponseQuality } from '../types';

const QUALITY_ICON: Record<ResponseQuality, string> = {
  good: '✓',
  fair: '~',
  poor: '✗',
};

const QUALITY_COLOR: Record<ResponseQuality, string> = {
  good: '#3ecf75',
  fair: '#f2c94c',
  poor: '#eb5757',
};

function recoveryColor(r: number): string {
  if (r >= LAST5_RED) return '#eb5757';
  if (r >= LAST5_YELLOW) return '#f2c94c';
  return '#cfcfd4';
}

function nadirColor(depth: number): string {
  return depth < -25 ? '#eb5757' : '#cfcfd4';
}

export interface ContractionLogProps {
  contractions: readonly ContractionResponse[];
}

export function ContractionLog({ contractions }: ContractionLogProps): React.ReactElement {
  // Render newest first; the incoming array is chronological.
  const data = [...contractions].reverse();

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
          <View style={styles.row}>
            <Text style={[styles.cell, styles.mono, { flex: 0.5 }]}>{displayIndex}</Text>
            <Text style={[styles.cell, styles.mono, { color: nadirColor(item.nadirDepth) }]}>
              {item.nadirDepth.toFixed(0)} bpm
            </Text>
            <Text style={[styles.cell, styles.mono, { color: recoveryColor(item.recoveryTime) }]}>
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
        );
      }}
    />
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
});
