/**
 * TorusDisplay — renders the trajectory of TorusPoints on a square SVG.
 *
 * Reference: SPEC.md §6.1.
 *
 *   - Dark background (#0a0a0f), thin border (#1a1a2e)
 *   - Grid lines at 25%, 50%, 75%
 *   - Polyline connecting consecutive points (low opacity)
 *   - Circles at each point: radius + opacity scale with recency;
 *     color scales with curvature (green low → red high)
 *   - Latest point: animated pulsing white ring
 *   - Tap a point to show its contraction details in a tooltip
 *     (Phase 3, SPEC §6.1 "Interaction")
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect } from 'react-native-svg';
import { TWO_PI } from '../torus/math';
import type { ContractionResponse, TorusPoint } from '../types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface TorusDisplayProps {
  points: readonly TorusPoint[];
  /** Map from contractionId → ContractionResponse for tooltip lookup. */
  contractionsById?: Readonly<Record<string, ContractionResponse>>;
  size?: number;
}

function kappaColor(kappa: number): string {
  const t = Math.min(1, kappa / 2);
  const r = Math.round(62 + (235 - 62) * t);
  const g = Math.round(207 - (207 - 87) * t);
  const b = Math.round(117 - (117 - 87) * t);
  return `rgb(${r},${g},${b})`;
}

export function TorusDisplay({
  points,
  contractionsById,
  size = 280,
}: TorusDisplayProps): React.ReactElement {
  const pad = 10;
  const box = size - 2 * pad;
  const proj = (theta: number) => pad + (theta / TWO_PI) * box;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    selectedId && contractionsById ? contractionsById[selectedId] ?? null : null;

  // Pulsing ring on the latest point.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const polyPoints = points.map((p) => `${proj(p.theta1)},${size - proj(p.theta2)}`).join(' ');
  const latest = points[points.length - 1];

  const pulseR = pulse.interpolate({ inputRange: [0, 1], outputRange: [8, 14] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.2] });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={size} height={size} fill="#0a0a0f" stroke="#1a1a2e" />
        <G>
          {[0.25, 0.5, 0.75].map((f) => (
            <React.Fragment key={f}>
              <Line
                x1={pad + f * box}
                y1={pad}
                x2={pad + f * box}
                y2={size - pad}
                stroke="#1a1a2e"
                strokeWidth={1}
              />
              <Line
                x1={pad}
                y1={pad + f * box}
                x2={size - pad}
                y2={pad + f * box}
                stroke="#1a1a2e"
                strokeWidth={1}
              />
            </React.Fragment>
          ))}
        </G>

        {points.length >= 2 && (
          <Polyline
            points={polyPoints}
            fill="none"
            stroke="#4a4a6b"
            strokeWidth={1}
            opacity={0.6}
          />
        )}

        {points.map((p, i) => {
          const recency = points.length <= 1 ? 1 : i / (points.length - 1);
          const radius = 2 + 4 * recency;
          const opacity = 0.2 + 0.8 * recency;
          const cx = proj(p.theta1);
          const cy = size - proj(p.theta2);
          return (
            <Circle
              key={p.contractionId}
              cx={cx}
              cy={cy}
              r={radius}
              fill={kappaColor(p.kappa)}
              opacity={selectedId === p.contractionId ? 1 : opacity}
              stroke={selectedId === p.contractionId ? '#ffffff' : 'none'}
              strokeWidth={selectedId === p.contractionId ? 1.5 : 0}
            />
          );
        })}

        {latest && (
          <AnimatedCircle
            cx={proj(latest.theta1)}
            cy={size - proj(latest.theta2)}
            r={pulseR}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.5}
            opacity={pulseOpacity}
          />
        )}
      </Svg>

      {/* Invisible pressable hit-testing layer over each point. */}
      {contractionsById && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {points.map((p) => {
            const cx = proj(p.theta1);
            const cy = size - proj(p.theta2);
            const r = 12; // generous tap target
            return (
              <Pressable
                key={p.contractionId}
                onPress={() =>
                  setSelectedId((prev) => (prev === p.contractionId ? null : p.contractionId))
                }
                style={[
                  styles.hit,
                  { left: cx - r, top: cy - r, width: 2 * r, height: 2 * r },
                ]}
              />
            );
          })}
        </View>
      )}

      {selected && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipTitle}>
            Contraction · nadir {selected.nadirDepth.toFixed(0)} bpm · recovery{' '}
            {selected.recoveryTime.toFixed(0)} s
          </Text>
          <Text style={styles.tooltipLine}>
            baseline {selected.baselineFHR.toFixed(0)} bpm · area{' '}
            {selected.responseArea.toFixed(0)} bpm·s · quality {selected.qualityGrade}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute', borderRadius: 999 },
  tooltip: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: '#15151c',
    borderColor: '#3a3a4f',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
  },
  tooltipTitle: { color: '#cfcfd4', fontSize: 11, fontWeight: '600' },
  tooltipLine: { color: '#9a9aa6', fontSize: 10, marginTop: 2 },
});
