/**
 * StatusTimeline — compact visualization of a session's alert history.
 *
 * Reference: SPEC.md §5.2 "Transition messaging ... Log all transitions".
 * Phase 3 adds this to the monitor screen + session review so the user can
 * see when transitions happened and what triggered them.
 *
 * Shows horizontal bars — one per transition — color-coded by the `to`
 * status. Hovering / tapping is out of scope here (the session review
 * screen renders this same component for a static detailed look).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { STATUS_COLORS } from './colors';
import type { AlertStatus, StatusTransition } from '../types';

export interface StatusTimelineProps {
  startTime: number;
  endTime: number | null;
  /** Current status — rendered as the trailing segment. */
  currentStatus: AlertStatus;
  transitions: readonly StatusTransition[];
  /** Width in px for the rendered bar. */
  width?: number;
}

export function StatusTimeline({
  startTime,
  endTime,
  currentStatus,
  transitions,
  width = 320,
}: StatusTimelineProps): React.ReactElement {
  const effectiveEnd = endTime ?? Date.now();
  const span = Math.max(1, effectiveEnd - startTime);

  // Compose segments: [startTime..firstTransition.at] status 'grey',
  // then each segment between transitions, ending at effectiveEnd.
  const segs: Array<{ from: number; to: number; status: AlertStatus }> = [];
  let cursor = startTime;
  let currentSegStatus: AlertStatus = 'grey';
  for (const t of transitions) {
    segs.push({ from: cursor, to: t.at, status: currentSegStatus });
    cursor = t.at;
    currentSegStatus = t.to;
  }
  segs.push({ from: cursor, to: effectiveEnd, status: currentStatus });

  // Filter zero-width segments at start.
  const visible = segs.filter((s) => s.to > s.from);

  return (
    <View style={{ width }}>
      <View style={styles.bar}>
        {visible.map((s, i) => {
          const fracWidth = ((s.to - s.from) / span) * width;
          return (
            <View
              key={`${s.from}-${i}`}
              style={[
                styles.segment,
                {
                  width: Math.max(2, fracWidth),
                  backgroundColor: STATUS_COLORS[s.status],
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.legend}>
        {transitions.length === 0 ? (
          <Text style={styles.empty}>No status transitions yet</Text>
        ) : (
          transitions.slice(-4).map((t) => (
            <Text key={`${t.at}-${t.contractionIndex}`} style={styles.item}>
              <Text style={{ color: STATUS_COLORS[t.from] }}>{t.from.toUpperCase()}</Text>
              {' → '}
              <Text style={{ color: STATUS_COLORS[t.to] }}>{t.to.toUpperCase()}</Text>
              <Text style={styles.meta}>  at ctx #{t.contractionIndex + 1}</Text>
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
  },
  segment: { height: 6 },
  legend: { marginTop: 6 },
  item: { color: '#cfcfd4', fontSize: 11, marginTop: 2 },
  meta: { color: '#5a5a66', fontSize: 10 },
  empty: { color: '#5a5a66', fontSize: 11 },
});
