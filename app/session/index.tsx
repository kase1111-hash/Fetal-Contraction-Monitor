/**
 * Session history list. Shows past (completed) sessions newest-first.
 * Tap a row → /session/[id] for the read-only review screen.
 */

import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { useSession } from '../../src/state/session-context';
import type { AlertStatus, LaborSession } from '../../src/types';

const COLORS: Record<AlertStatus, string> = {
  green: '#3ecf75',
  yellow: '#f2c94c',
  red: '#eb5757',
  grey: '#5a5a66',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDuration(start: number, end: number | null): string {
  const ms = (end ?? Date.now()) - start;
  const mins = Math.round(ms / 60_000);
  return mins >= 60
    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
    : `${mins}m`;
}

export default function SessionHistoryScreen(): React.ReactElement {
  const { loadHistory } = useSession();
  const [history, setHistory] = useState<LaborSession[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const h = await loadHistory();
      if (!cancelled) setHistory(h);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Past sessions' }} />
      {history === null ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : history.length === 0 ? (
        <Text style={styles.empty}>
          No past sessions yet. Completed sessions appear here after you tap
          "End Session".
        </Text>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Link href={`/session/${item.id}`} asChild>
              <Pressable style={styles.row}>
                <View style={[styles.dot, { backgroundColor: COLORS[item.status] }]} />
                <View style={styles.info}>
                  <Text style={styles.title}>{formatDate(item.startTime)}</Text>
                  <Text style={styles.meta}>
                    {item.contractions.length} contractions ·{' '}
                    {formatDuration(item.startTime, item.endTime)}
                  </Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  empty: { color: '#9a9aa6', fontSize: 13, marginTop: 24, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a2e',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  info: { flex: 1 },
  title: { color: '#cfcfd4', fontSize: 14 },
  meta: { color: '#9a9aa6', fontSize: 11, marginTop: 2 },
  chev: { color: '#5a5a66', fontSize: 18 },
});
