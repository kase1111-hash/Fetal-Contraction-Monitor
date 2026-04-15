/**
 * ContractionButton — large manual-detection button with 60 s cooldown.
 * Reference: SPEC.md §2.2.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CTX_MIN_DISTANCE } from '../constants';

export interface ContractionButtonProps {
  onPress(): void;
  /** Override for tests. Defaults to Date.now. */
  now?: () => number;
}

export function ContractionButton({ onPress, now }: ContractionButtonProps): React.ReactElement {
  const clock = now ?? (() => Date.now());
  const lastPressedRef = useRef<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const h = setInterval(() => {
      if (lastPressedRef.current === null) {
        setRemaining(0);
        return;
      }
      const elapsed = (clock() - lastPressedRef.current) / 1000;
      const r = Math.max(0, CTX_MIN_DISTANCE - elapsed);
      setRemaining(r);
      if (r === 0) lastPressedRef.current = null;
    }, 250);
    return () => clearInterval(h);
  }, [clock]);

  const disabled = remaining > 0;

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        lastPressedRef.current = clock();
        setRemaining(CTX_MIN_DISTANCE);
        onPress();
      }}
      style={[styles.btn, disabled && styles.cooldown]}
    >
      <View style={styles.inner}>
        <Text style={styles.label}>{disabled ? 'COOLDOWN' : 'CONTRACTION'}</Text>
        {disabled && <Text style={styles.count}>{Math.ceil(remaining)}s</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 72,
    borderRadius: 12,
    backgroundColor: '#3a5bff',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  cooldown: { backgroundColor: '#2a2a3b' },
  inner: { alignItems: 'center' },
  label: { color: 'white', fontWeight: '700', fontSize: 16, letterSpacing: 1 },
  count: { color: '#9a9aa6', fontSize: 12, marginTop: 4 },
});
