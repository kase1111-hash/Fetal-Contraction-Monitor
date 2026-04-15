/**
 * StatusToast — transient banner shown when the alert status transitions.
 *
 * Reference: SPEC.md §5.2 "Transition messaging":
 *   "When status changes, show a brief toast: 'Status changed: GREEN → YELLOW'
 *    with timestamp."
 *
 * The parent owns the status value; StatusToast fires a 4-second animated
 * banner whenever that value changes. It's a view-only component — the
 * transition is already logged in `LaborSession.statusHistory`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { statusLabel } from '../alerts/uncertainty';
import type { AlertStatus } from '../types';

const COLORS: Record<AlertStatus, string> = {
  green: '#3ecf75',
  yellow: '#f2c94c',
  red: '#eb5757',
  grey: '#5a5a66',
};

/** Messages per target status, per SPEC.md §5.2 table. */
const MESSAGES: Record<AlertStatus, string> = {
  grey: '',
  green: 'Recent recovery times are stable.',
  yellow:
    'Recovery time is trending upward. This may be normal labor progression. If you have concerns, contact your provider.',
  red:
    'The pattern of fetal responses has changed significantly. Please contact your healthcare provider for assessment.',
};

export interface StatusToastProps {
  status: AlertStatus;
  /** Seconds the toast stays visible. Defaults to 4. */
  holdSeconds?: number;
}

export function StatusToast({
  status,
  holdSeconds = 4,
}: StatusToastProps): React.ReactElement | null {
  const [visibleStatus, setVisibleStatus] = useState<AlertStatus | null>(null);
  const [prevStatus, setPrevStatus] = useState<AlertStatus | null>(null);
  const last = useRef<AlertStatus>(status);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status === last.current) return;
    setPrevStatus(last.current);
    last.current = status;
    setVisibleStatus(status);

    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(holdSeconds * 1000),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setVisibleStatus(null);
    });
  }, [status, holdSeconds, opacity]);

  if (visibleStatus === null) return null;

  const color = COLORS[visibleStatus];

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { borderColor: color, opacity }]}
    >
      <Text style={styles.title}>
        <Text style={{ color: COLORS[prevStatus ?? 'grey'] }}>
          {(prevStatus ?? 'grey').toUpperCase()}
        </Text>
        {' → '}
        <Text style={{ color }}>{visibleStatus.toUpperCase()}</Text>
        {'  '}
        <Text style={styles.label}>— {statusLabel(visibleStatus)}</Text>
      </Text>
      {MESSAGES[visibleStatus] !== '' && (
        <Text style={styles.message}>{MESSAGES[visibleStatus]}</Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 36,
    left: 12,
    right: 12,
    backgroundColor: '#15151c',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  title: { color: '#cfcfd4', fontSize: 13, fontWeight: '600' },
  label: { color: '#9a9aa6', fontWeight: '400' },
  message: { color: '#cfcfd4', fontSize: 12, marginTop: 4, lineHeight: 16 },
});
