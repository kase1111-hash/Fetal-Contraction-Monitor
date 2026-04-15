/**
 * SignalQualityBadge — small corner indicator for FHR quality / BLE state.
 * Reference: SPEC.md §6.5.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FHRQuality } from '../types';

const COLORS: Record<FHRQuality, string> = {
  good: '#3ecf75',
  fair: '#f2c94c',
  poor: '#eb5757',
  disconnected: '#5a5a66',
};

export function SignalQualityBadge({ quality }: { quality: FHRQuality }): React.ReactElement {
  const label = quality === 'disconnected' ? 'DISC' : quality.toUpperCase();
  return (
    <View style={[styles.badge, { borderColor: COLORS[quality] }]}>
      <View style={[styles.dot, { backgroundColor: COLORS[quality] }]} />
      <Text style={[styles.text, { color: COLORS[quality] }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
});
